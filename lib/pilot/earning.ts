import { type DB, type Row, first, rows, stmt, guard, audit, fail, int } from './core';
import { noteText, operation } from './operation';
export const EARNING_ADMIN_ACTIONS = ['rewardEarningSettings'];
export async function mutateEarning(db: DB, m: Row, b: Row, tokenHash?: string) {
  if (b.action !== 'rewardEarningSettings') fail('Choose a supported spending-rewards action.');
  const op = await operation(db, m, b, true, tokenHash);
  if (op.replayed) return { ok: true, replayed: true };
  await op.commit(earningSettingsStatements(db, b, m.id));
  return { ok: true };
}
const WEEK = 604800000;
// 1970-01-05 was a Monday. The rest of the site uses UTC for accounting windows.
export const earningWeek = (time: number) => Math.floor((time - 345600000) / WEEK) * WEEK + 345600000;
const centsFor = (order: Row) => order.gross_cents > 0
  ? Math.floor(order.eligible_paid_cents * order.merchandise_cents / order.gross_cents) : 0;

/** Add provenance after the caller increases members.credit, within one batch. */
export function rewardCreditGrant(db: DB, memberId: string, cents: number, sourceId: string) {
  int(cents, 1, 1000000);
  return [
    stmt(db, 'INSERT INTO earning_credit_grants(source_id,member_id,cents,created_at) VALUES(?,?,?,?)', sourceId, memberId, cents, Date.now()),
    guard(db, 'EXISTS(SELECT 1 FROM earning_accounts e JOIN members m ON m.id=e.member_id WHERE e.member_id=? AND e.reward_credit_cents+?<=m.credit)', memberId, cents),
    stmt(db, 'UPDATE earning_accounts SET reward_credit_cents=reward_credit_cents+?,version=version+1 WHERE member_id=?', cents, memberId),
  ];
}
export function earningSettingsStatements(db: DB, b: Row, actor: string) {
  const cap = int(b.weeklyCapPoints, 0, 100000), version = int(b.version), reason = noteText(b.reason);
  return [
    guard(db, "EXISTS(SELECT 1 FROM earning_settings WHERE id='main' AND version=?)", version),
    stmt(db, "UPDATE earning_settings SET weekly_cap_points=?,version=version+1 WHERE id='main'", cap),
    audit(db, actor, 'spending_reward_settings', 'main', { weeklyCapPoints: cap, reason, effective: 'next new earning week' }),
  ];
}

/** One prepared financial mutation, committed with its existing atomic batch. */
export class EarningPlan {
  private changedOrders = new Set<string>();
  private changedSources = new Set<string>();
  private newSources = new Set<string>();
  private newPeriods = new Set<string>();
  private changedPeriods = new Set<string>();
  private adjustments: Row[] = [];
  private rewardCredit: number;
  private debt: number;
  private rewardTabCents: number;
  private initialEntitlement: number;
  private initialCarryCents: number;
  readonly prefixes: D1PreparedStatement[];
  private constructor(
    private db: DB, private member: Row, private account: Row, private settings: Row,
    private orderRows: Row[], private sourceRows: Row[], private periods: Row[],
    private frozen: boolean, private operationId: string, private kind: string,
    private now: number,
  ) {
    this.rewardCredit = account.reward_credit_cents;
    this.debt = member.debt;
    this.rewardTabCents = member.debt ? account.reward_tab_cents : 0;
    this.initialEntitlement = this.entitlement();
    this.initialCarryCents = periods.reduce((sum, period) => sum + period.remaining_cents, 0) % 100;
    this.prefixes = [
      guard(db, 'EXISTS(SELECT 1 FROM earning_accounts WHERE member_id=? AND version=?)', member.id, account.version),
      guard(db, 'EXISTS(SELECT 1 FROM members WHERE id=? AND debt=? AND credit=?)', member.id, member.debt, member.credit),
      guard(db, "EXISTS(SELECT 1 FROM earning_settings WHERE id='main' AND version=?)", settings.version),
      guard(db, 'COALESCE((SELECT frozen FROM reward_members WHERE member_id=?),0)=?', member.id, frozen ? 1 : 0),
    ];
    // Admin write-offs carry no spending reward. Reconcile only the new reward
    // allocation bookkeeping; original purchases and financial totals stay put.
    let writeOff = Math.max(0, this.trackedTab() - this.debt);
    for (const order of this.ordered()) {
      const amount = Math.min(writeOff, order.tab_remaining_cents);
      if (!amount) continue;
      order.tab_remaining_cents -= amount;
      order.forgiven_cents += amount;
      this.changedOrders.add(order.order_id);
      this.adjustments.push({ orderId: order.order_id, uncreditedWriteOff: amount });
      writeOff -= amount;
    }
  }
  static async load(db: DB, memberId: string, operationId: string, kind: string, now = Date.now(), targetOrderId: string | null = null) {
    const [member, account, settings, orders, sources, periods, control] = await Promise.all([
      first(db, 'SELECT id,debt,credit FROM members WHERE id=?', memberId),
      first(db, 'SELECT * FROM earning_accounts WHERE member_id=?', memberId),
      first(db, "SELECT * FROM earning_settings WHERE id='main'"),
      rows(db, 'SELECT * FROM earning_orders WHERE member_id=? AND (tab_remaining_cents>0 OR cash_remaining_cents>0 OR order_id=?) ORDER BY created_at,order_id', memberId, targetOrderId),
      targetOrderId ? rows(db, 'SELECT * FROM earning_sources WHERE member_id=? AND order_id=? ORDER BY created_at,id', memberId, targetOrderId) : Promise.resolve([]),
      rows(db, 'SELECT * FROM earning_periods WHERE member_id=? ORDER BY starts_at,id', memberId),
      first(db, 'SELECT frozen FROM reward_members WHERE member_id=?', memberId),
    ]);
    if (!member || !account || !settings) fail('Spending rewards are not initialized for this account.', 409);
    return new EarningPlan(db, member, account, settings, orders, sources, periods, !!control?.frozen, operationId, kind, now);
  }
  private ordered() { return [...this.orderRows].sort((a, b) => a.created_at - b.created_at || a.order_id.localeCompare(b.order_id)); }
  private trackedTab() { return this.orderRows.reduce((sum, order) => sum + order.tab_remaining_cents, 0); }
  private record(order: Row) {
    this.changedOrders.add(order.order_id);
    const target = centsFor(order), delta = target - order.recognized_cents;
    order.recognized_cents = target;
    if (delta > 0 && !this.frozen) {
      const start = earningWeek(this.now), periodId = this.member.id + ':' + start;
      if (!this.periods.some(p => p.id === periodId)) {
        this.periods.push({ id: periodId, member_id: this.member.id, starts_at: start, cap_points: this.settings.weekly_cap_points, remaining_cents: 0 });
        this.newPeriods.add(periodId);
      }
      const id = this.operationId + ':' + order.order_id + ':' + this.newSources.size;
      this.sourceRows.push({ id, order_id: order.order_id, member_id: this.member.id, period_id: periodId, original_cents: delta, remaining_cents: delta, created_at: this.now });
      this.newSources.add(id);
      this.periods.find(p => p.id === periodId)!.remaining_cents += delta;
      this.changedPeriods.add(periodId);
    } else if (delta < 0) {
      let remove = -delta;
      // Reverse the most recent funding sources first; original week caps are
      // retained, so refunding capped spending never removes unearned points.
      for (const source of [...this.sourceRows].reverse().filter(s => s.order_id === order.order_id)) {
        const amount = Math.min(remove, source.remaining_cents);
        if (!amount) continue;
        source.remaining_cents -= amount;
        this.periods.find(p => p.id === source.period_id)!.remaining_cents -= amount;
        this.changedPeriods.add(source.period_id);
        this.changedSources.add(source.id);
        remove -= amount;
        if (!remove) break;
      }
    }
    if (delta) this.adjustments.push({ orderId: order.order_id, eligibleCentsDelta: delta, frozen: this.frozen });
  }
  /** Reward-derived credit is spent first, and is never a new earning source. */
  spendCredit(cents: number) {
    const reward = Math.min(cents, this.rewardCredit);
    this.rewardCredit -= reward;
    return reward;
  }
  /** Capture explicit administrative balance changes immediately, so later
   * manual debt additions cannot resurrect written-off purchases as spending. */
  adjustBalances(debt: number, credit: number) {
    let writeOff = Math.max(0, this.debt - debt);
    writeOff -= Math.min(writeOff, Math.max(0, this.debt - this.trackedTab()));
    for (const order of this.ordered()) {
      const amount = Math.min(writeOff, order.tab_remaining_cents);
      if (!amount) continue;
      order.tab_remaining_cents -= amount;
      order.forgiven_cents += amount;
      this.changedOrders.add(order.order_id);
      this.adjustments.push({ orderId: order.order_id, administrativeWriteOff: amount });
      writeOff -= amount;
    }
    this.debt = debt;
    this.rewardCredit = Math.min(this.rewardCredit, credit);
  }
  purchase(input: { orderId: string; gross: number; merchandise: number; creditUsed: number; rewardCreditUsed: number; tabAdded: number; cashDue: number; cashConfirmed: boolean }) {
    if (this.now < this.settings.starts_at) return;
    if (this.orderRows.some(o => o.order_id === input.orderId)) fail('Purchase spending rewards already recorded.', 409);
    const order: Row = {
      order_id: input.orderId, member_id: this.member.id, created_at: this.now,
      gross_cents: input.gross, merchandise_cents: input.merchandise,
      eligible_paid_cents: input.creditUsed - input.rewardCreditUsed + (input.cashConfirmed ? input.cashDue : 0),
      reward_paid_cents: input.rewardCreditUsed, tab_remaining_cents: input.tabAdded,
      cash_remaining_cents: input.cashConfirmed ? 0 : input.cashDue,
      recognized_cents: 0, forgiven_cents: 0,
    };
    this.orderRows.push(order);
    this.debt += input.tabAdded;
    this.record(order);
  }
  confirmPurchase(orderId: string, cents: number) {
    const order = this.orderRows.find(o => o.order_id === orderId);
    if (!order) return; // Legacy purchase: no historical backfill.
    if (cents !== order.cash_remaining_cents) fail('Purchase funding changed. Refresh the payment review.', 409);
    order.cash_remaining_cents = 0;
    order.eligible_paid_cents += cents;
    this.record(order);
  }
  /** Allocate paid debt FIFO, preserving opening/untracked debt ahead of it. */
  settle(cents: number, rewardCents = 0) {
    if (cents < 0 || cents > this.debt || rewardCents < 0 || rewardCents > cents) fail('Tab funding changed. Refresh before confirming.', 409);
    let amount = cents, reward = rewardCents;
    this.rewardTabCents += rewardCents;
    const legacy = Math.min(amount, Math.max(0, this.debt - this.trackedTab()));
    amount -= legacy;
    reward -= Math.min(reward, legacy);
    for (const order of this.ordered()) {
      const applied = Math.min(amount, order.tab_remaining_cents);
      if (!applied) continue;
      const rewardApplied = Math.min(reward, applied);
      order.tab_remaining_cents -= applied;
      order.reward_paid_cents += rewardApplied;
      order.eligible_paid_cents += applied - rewardApplied;
      amount -= applied;
      reward -= rewardApplied;
      this.record(order);
      if (!amount) break;
    }
    if (amount) fail('Tab allocation changed. Refresh before confirming.', 409);
    this.debt -= cents;
    this.adjustments.push({ settledCents: cents, rewardFundedCents: rewardCents, legacyCents: legacy });
  }
  correct(orderId: string, amounts: { total: number; tax: number; pendingReduced: number; debtReduced: number; toReturn: number }, refundMethod: string) {
    const order = this.orderRows.find(o => o.order_id === orderId);
    if (!order) {
      // A legacy refund can offset current new purchases. The original legacy
      // sale never receives an award; only the newly paid goods can qualify.
      const legacyCancelled = Math.min(amounts.debtReduced, Math.max(0, this.debt - this.trackedTab()));
      this.debt -= legacyCancelled;
      this.settle(amounts.debtReduced - legacyCancelled);
      return;
    }
    const tabCancelled = Math.min(order.tab_remaining_cents, amounts.debtReduced);
    const forgivenCancelled = Math.min(order.forgiven_cents, amounts.total - amounts.pendingReduced - tabCancelled);
    // A written-off amount is not paid funding. The financial correction also
    // treats an offset against another tab as a return, even when toReturn=0.
    // Stop before either path can give the member value for forgiven debt.
    if (forgivenCancelled > 0)
      fail('This purchase includes a prior tab write-off. Review its recorded payments before issuing a refund.', 409);
    const paidReturn = amounts.total - amounts.pendingReduced - tabCancelled - forgivenCancelled;
    const paid = order.eligible_paid_cents + order.reward_paid_cents;
    if (paidReturn < 0 || paidReturn > paid) fail('The recorded purchase funding needs review before a refund.', 409);
    const rewardReturned = paid ? Math.min(order.reward_paid_cents, Math.ceil(paidReturn * order.reward_paid_cents / paid)) : 0;
    const otherDebtSettled = amounts.debtReduced - tabCancelled;
    const rewardToDebt = Math.min(rewardReturned, otherDebtSettled);
    const rewardToCredit = rewardReturned - rewardToDebt;
    if (rewardToCredit > 0 && refundMethod !== 'credit')
      fail('This return includes reward-funded credit. Choose account credit to preserve its funding; reward credit cannot be cashed out.');
    order.gross_cents -= amounts.total;
    order.merchandise_cents -= amounts.total - amounts.tax;
    order.cash_remaining_cents -= amounts.pendingReduced;
    order.tab_remaining_cents -= tabCancelled;
    order.forgiven_cents -= forgivenCancelled;
    order.reward_paid_cents -= rewardReturned;
    order.eligible_paid_cents -= paidReturn - rewardReturned;
    this.debt -= tabCancelled;
    this.record(order);
    this.settle(otherDebtSettled, rewardToDebt);
    if (refundMethod === 'credit') this.rewardCredit += rewardToCredit;
    this.adjustments.push({ orderId, rewardCreditReturned: rewardToCredit, paidReturn });
  }
  private entitlement() {
    let carry = 0, targetPoints = 0;
    for (const period of [...this.periods].sort((a, b) => a.starts_at - b.starts_at || a.id.localeCompare(b.id))) {
      const cents = period.remaining_cents;
      const whole = Math.floor((carry + cents) / 100);
      carry = (carry + cents) % 100;
      targetPoints += period.cap_points > 0 ? Math.min(whole, period.cap_points) : whole;
    }
    return targetPoints;
  }
  finish() {
    const rawTarget = this.entitlement(), rawChange = rawTarget - this.initialEntitlement;
    // A refund from a capped old week can mathematically shift fractional carry
    // into a later week. It must never create a new award. Persist suppression
    // so the next purchase cannot mint that refund-created point either, and
    // release it first if later returns remove the underlying raw entitlement.
    let suppressed = Math.max(0, this.account.refund_carry_suppressed_points + Math.min(0, rawChange));
    if (this.kind === 'purchase_correction' && rawChange > 0) {
      // A historical paid purchase can be refunded directly against a new tab.
      // That genuinely funds new goods and may earn. Suppress only increases
      // beyond what the newly funded merchandise (and prior carry) supports.
      const newlyFunded = this.sourceRows.filter(source => this.newSources.has(source.id))
        .reduce((sum, source) => sum + source.remaining_cents, 0);
      const allowedIncrease = newlyFunded > 0 ? Math.floor((newlyFunded + this.initialCarryCents) / 100) : 0;
      suppressed += Math.max(0, rawChange - allowedIncrease);
    }
    const targetPoints = Math.max(0, rawTarget - suppressed);
    const delta = targetPoints - this.account.awarded_points;
    const statements: D1PreparedStatement[] = [];
    const columns = ['order_id','member_id','created_at','gross_cents','merchandise_cents','eligible_paid_cents','reward_paid_cents','tab_remaining_cents','cash_remaining_cents','recognized_cents','forgiven_cents'];
    for (const order of this.orderRows.filter(o => this.changedOrders.has(o.order_id)))
      statements.push(stmt(this.db, `INSERT INTO earning_orders(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')}) ON CONFLICT(order_id) DO UPDATE SET ${columns.slice(3).map(c => c+'=excluded.'+c).join(',')}`, ...columns.map(c => order[c])));
    for (const period of this.periods.filter(p => this.changedPeriods.has(p.id)))
      statements.push(this.newPeriods.has(period.id)
        ? stmt(this.db, 'INSERT INTO earning_periods(id,member_id,starts_at,cap_points,remaining_cents) VALUES(?,?,?,?,?)', period.id, period.member_id, period.starts_at, period.cap_points, period.remaining_cents)
        : stmt(this.db, 'UPDATE earning_periods SET remaining_cents=? WHERE id=?', period.remaining_cents, period.id));
    for (const source of this.sourceRows) {
      if (this.newSources.has(source.id)) statements.push(stmt(this.db, 'INSERT INTO earning_sources(id,order_id,member_id,period_id,original_cents,remaining_cents,created_at) VALUES(?,?,?,?,?,?,?)', source.id, source.order_id, source.member_id, source.period_id, source.original_cents, source.remaining_cents, source.created_at));
      else if (this.changedSources.has(source.id)) statements.push(stmt(this.db, 'UPDATE earning_sources SET remaining_cents=? WHERE id=?', source.remaining_cents, source.id));
    }
    statements.push(
      guard(this.db, 'EXISTS(SELECT 1 FROM members WHERE id=? AND credit>=?)', this.member.id, this.rewardCredit),
      stmt(this.db, 'UPDATE earning_accounts SET reward_credit_cents=?,awarded_points=?,reward_tab_cents=?,refund_carry_suppressed_points=?,version=version+1 WHERE member_id=?', this.rewardCredit, targetPoints, this.rewardTabCents, suppressed, this.member.id),
      stmt(this.db, 'INSERT INTO earning_operations(id,member_id,kind,detail,points_delta,created_at) VALUES(?,?,?,?,?,?)', this.operationId, this.member.id, this.kind, JSON.stringify(this.adjustments), delta, this.now),
    );
    if (delta) statements.push(stmt(this.db, "INSERT INTO reward_ledger(id,member_id,amount,rule_id,source,actor,note,created_at) VALUES(?,?,?,'spending',?,'system',?,?)", 'spending:'+this.operationId, this.member.id, delta, this.operationId, delta > 0 ? 'Confirmed merchandise spending, excluding tax and reward-funded credit.' : 'Purchase correction: merchandise-spending rewards adjusted.', this.now));
    return statements;
  }
}

export async function earningSummary(db: DB, memberId: string) {
  const [settings, sources, orders, currentPeriod] = await Promise.all([
    first(db, "SELECT * FROM earning_settings WHERE id='main'"),
    first(db, 'SELECT COALESCE(SUM(remaining_cents),0) cents FROM earning_periods WHERE member_id=?', memberId),
    rows(db, 'SELECT * FROM earning_orders WHERE member_id=? AND (tab_remaining_cents>0 OR cash_remaining_cents>0)', memberId),
    first(db, 'SELECT cap_points FROM earning_periods WHERE member_id=? AND starts_at=?', memberId, earningWeek(Date.now())),
  ]);
  if (!settings) fail('Spending rewards are not initialized.', 409);
  const pendingCents = orders.reduce((sum, order) => sum + Math.max(0, centsFor({ ...order, eligible_paid_cents: order.eligible_paid_cents + order.tab_remaining_cents + order.cash_remaining_cents }) - order.recognized_cents), 0);
  return { pendingCents, pendingPoints: Math.floor(pendingCents / 100), remainderCents: (sources?.cents || 0) % 100,
    settings: { rateCents: 100, weeklyCapPoints: settings.weekly_cap_points, currentWeekCapPoints: currentPeriod?.cap_points ?? settings.weekly_cap_points, startsAt: settings.starts_at, version: settings.version } };
}
