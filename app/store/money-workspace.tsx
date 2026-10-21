"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, NumberField, money, date, type Row } from "./shared";
import {
  useWorkflow,
  useDraft,
  WorkflowStatus,
  Select,
  Check,
  cents,
  localTime,
} from "./workflow-shared";

export function FundsSummary({ data: d }: { data: Row }) {
  return (
    <div className="wf-stack">
      <div className="wf-metrics">
        <div>
          <span>Recorded funds</span>
          <strong>{money(d.funds)}</strong>
          <small>
            {d.complete
              ? "From the account checks below"
              : "Check every active account"}
          </small>
        </div>
        <div>
          <span>Committed</span>
          <strong>{money(d.held)}</strong>
          <small>Recorded obligations</small>
        </div>
        <div>
          <span>Available for activities</span>
          <strong>{money(d.available)}</strong>
          <small>Funds minus commitments</small>
        </div>
        <div>
          <span>After selected run</span>
          <strong>{money(d.projected)}</strong>
          <small>{d.plan?.name || "Select a restock plan"}</small>
        </div>
      </div>
      <p className="fine">
        {d.commitmentBasis}{" "}
        {d.plan && d.plan.total === null
          ? "The selected run needs complete quantities, prices and charges."
          : ""}
      </p>
      <details>
        <summary>Account basis and receivables</summary>
        {d.accounts
          .filter((a: Row) => a.active)
          .map((a: Row) => (
            <p key={a.id}>
              <strong>
                {a.name}: {money(a.balance)}
              </strong>{" "}
              ·{" "}
              {a.observation_id
                ? a.basis + " · checked " + date(a.observed_at)
                : "No balance check recorded"}
              {a.recorded_change !== null
                ? " · recorded change since check " + money(a.recorded_change)
                : ""}
              {a.uncertain_movements ? " · receipt timing needs review" : ""}
              {a.unclassified_expenses
                ? " · unclassified expenses need review"
                : ""}
            </p>
          ))}
        <p>
          Outstanding tabs: {money(d.tabs)}. This is money owed to the activity,
          not funds already on hand.
        </p>
        <p>
          Member credit: {money(d.credits.total)} · at least{" "}
          {money(d.credits.cashBackedMinimum)} backed by confirmed cash receipts
          · reward-backed {money(d.credits.reward)} · source not established{" "}
          {money(d.credits.otherSourceNotEstablished)}. Reward credit does not
          create cash. Review prepaid obligations separately.
        </p>
        {d.plan && (
          <p>
            Selected run: {money(d.plan.total)} · already committed{" "}
            {money(d.plan.alreadyCommitted)} · remaining forecast deduction{" "}
            {money(d.plan.remainingDeduction)}.
          </p>
        )}
      </details>
    </div>
  );
}
export function MoneyOverview({
  memberId,
  onOpen,
}: {
  memberId: string;
  onOpen: () => void;
}) {
  const s = useWorkflow("view=money", memberId + ":overview-money");
  return (
    <section className="panel wf-stack">
      <div className="section-title">
        <h2>Activity funds</h2>
        <Button variant="secondary" onClick={onOpen}>
          Open Money
        </Button>
      </div>
      <WorkflowStatus state={s} />
      {s.data ? <FundsSummary data={s.data} /> : <p>Loading account checks…</p>}
    </section>
  );
}
export default function MoneyWorkspace({
  memberId,
  onPayments,
  onMonth,
}: {
  memberId: string;
  onPayments: () => void;
  onMonth: () => void;
}) {
  const [q, setQ] = useState({
      from: "",
      to: "",
      kind: "observations",
      account: "",
      cursor: "",
    }),
    [older, setOlder] = useState<Row[]>([]),
    state = useWorkflow(
      "view=money&" + new URLSearchParams(q),
      memberId + ":money",
    ),
    d = state.data,
    [mode, setMode] = useState("");
  const filter = (key: string, value: string) => {
    setQ((x) => ({ ...x, [key]: value, cursor: "" }));
    setOlder([]);
  };
  return (
    <section className="wf-stack">
      <div>
        <h2>Money</h2>
        <p className="fine">
          Check activity funds, account for obligations, and see what remains
          for the next run.
        </p>
      </div>
      <WorkflowStatus state={state} />
      {d && (
        <>
          <div className="panel wf-stack">
            <FundsSummary data={d} />
            <div className="wf-toolbar">
              <Button onClick={() => setMode(mode === "check" ? "" : "check")}>
                Check balances
              </Button>
              <Button variant="secondary" onClick={onPayments}>
                Confirm member payments
              </Button>
              <Button variant="secondary" onClick={onMonth}>
                Month close
              </Button>
              <Select
                label="Record activity"
                value={mode === "check" ? "" : mode}
                onChange={setMode}
                options={[
                  ["", "Choose an action"],
                  ["expense", "Activity expense"],
                  ["transfer", "Transfer between accounts"],
                  ["commitment", "Set aside a commitment"],
                  ["adjustment", "Correct an account balance"],
                  ["account", "Add an activity account"],
                ]}
              />
            </div>
          </div>
          {mode === "check" ? (
            <BalanceCheck
              key={d.accounts.map((a: Row) => a.observation_id).join(":")}
              scope={memberId}
              d={d}
              state={state}
            />
          ) : mode ? (
            <MoneyAction
              key={mode}
              mode={mode}
              d={d}
              state={state}
              scope={memberId}
            />
          ) : null}
          <div className="panel wf-stack">
            <h3>Recorded commitments</h3>
            {!d.reimbursements.length && !d.commitments.length && (
              <p>
                No unpaid reimbursements or other commitments recorded. Review
                any unrecorded obligations before using the available amount.
              </p>
            )}
            {d.reimbursements.map((r: Row) => (
              <Reimbursement
                key={r.receipt_id + ":" + r.remaining}
                value={r}
                accounts={d.accounts}
                state={state}
              />
            ))}
            {d.commitments.map((c: Row) => (
              <div key={c.id} className="wf-row">
                <strong>
                  {c.label} · {money(c.amount)}
                </strong>
                <span>
                  {c.kind} · obligation reference {c.group_key}
                </span>
                <details>
                  <summary>Review or release</summary>
                  <p>
                    Releasing this commitment does not record a payment. Record
                    its actual expense separately if applicable.
                  </p>
                  <Button
                    variant="secondary"
                    disabled={state.busy}
                    onClick={() =>
                      state.send({
                        action: "moneyCommitment",
                        id: c.id,
                        version: c.version,
                        label: c.label,
                        amount: c.amount,
                        kind: c.kind,
                        groupKey: c.group_key,
                        runId: c.run_id,
                        status: "cancelled",
                      })
                    }
                  >
                    Release commitment
                  </Button>
                </details>
              </div>
            ))}
          </div>
          <div className="panel wf-stack">
            <h3>Money history & reports</h3>
            <div className="wf-fields">
              <Select
                label="Records"
                value={q.kind}
                onChange={(v) => filter("kind", v)}
                options={[
                  ["observations", "Balance checks"],
                  ["movements", "Account movements"],
                ]}
              />
              <Select
                label="Account"
                value={q.account}
                onChange={(v) => filter("account", v)}
                options={[
                  ["", "All accounts"],
                  ...d.accounts.map((a: Row) => [a.id, a.name]),
                ]}
              />
              <Field
                label="From (UTC)"
                type="date"
                value={q.from}
                onChange={(e: any) => filter("from", e.target.value)}
              />
              <Field
                label="Through (UTC)"
                type="date"
                value={q.to}
                onChange={(e: any) => filter("to", e.target.value)}
              />
            </div>
            <details>
              <summary>Full-period movement totals</summary>
              {d.period.map((p: Row) => (
                <p key={p.account_id + ":" + p.category}>
                  {d.accounts.find((a: Row) => a.id === p.account_id)?.name} ·{" "}
                  {p.category} · in {money(p.inflow)} · out {money(p.outflow)}
                </p>
              ))}
              <p className="fine">
                Transfers appear on both accounts. They are excluded from sales
                and expenses.
              </p>
            </details>
            <div className="wf-list">
              {[...older, ...d.history.records].map((h: Row) => (
                <article key={h.id} className="wf-row">
                  <strong>
                    {d.accounts.find((a: Row) => a.id === h.account_id)?.name} ·{" "}
                    {money(h.amount)}
                  </strong>
                  <span>
                    {q.kind === "movements" ? h.category : "Balance check"} ·{" "}
                    {date(h.observed_at || h.effective_at)}
                  </span>
                  <small>
                    Recorded {date(h.created_at)} · by {h.actor}
                    {h.reviewer ? " · reviewed by " + h.reviewer : ""}
                  </small>
                  {h.expected != null && (
                    <span>
                      Expected {money(h.expected)} · difference{" "}
                      {money(h.difference)}
                    </span>
                  )}
                  <p>{h.note || h.reference}</p>
                  {h.source_type === "legacy-cashcount" && (
                    <small>
                      Imported from the original cash-count audit; source
                      retained.
                    </small>
                  )}
                </article>
              ))}
            </div>
            {d.history.nextCursor && (
              <Button
                variant="secondary"
                onClick={() => {
                  setOlder((x) => [...x, ...d.history.records]);
                  setQ((x) => ({ ...x, cursor: d.history.nextCursor }));
                }}
              >
                Load older records
              </Button>
            )}
            <a
              href={
                "/api/export?" +
                new URLSearchParams({
                  dataset:
                    q.kind === "movements" ? "moneyMovements" : "moneyChecks",
                  from: q.from,
                  to: q.to,
                })
              }
            >
              Download all records for these dates (CSV; integer cents and UTC
              timestamps)
            </a>
          </div>
          <section className="panel wf-stack">
            <h3>Activity assets &amp; annual reporting</h3>
            <p>
              Holding accounts {money(d.funds)} + tabs receivable{" "}
              {money(d.tabs)} + investments {money(d.investments)} ={" "}
              {money(d.activityAssets)}.
            </p>
            <p className="fine">{d.assetBasis}</p>
            <p>
              Inventory: known value {money(d.inventory.known_value)} ·{" "}
              {d.inventory.unknown_units || 0} units with unknown cost.
              Inventory is separate from funds and the asset total above.
            </p>
            <p>
              For an annual income/expenditure record, choose January 1–December
              31 in Money history and export account movements. Keep transfers,
              reimbursements, and balance corrections separate from income and
              expenses. Missing observations remain gaps; no rolling average is
              inferred.
            </p>
          </section>
          <details className="panel">
            <summary>Missing sale costs · {d.missingCostCount} lines</summary>
            <p>
              Known-cost results remain available. Supply historical evidence to
              repair an unknown line; closed periods must be reopened first.
            </p>
            {d.missingCosts.map((i: Row) => (
              <CostRepair key={i.id} item={i} state={state} />
            ))}
            {d.missingCostCount > d.missingCosts.length && (
              <Button variant="secondary" onClick={() => state.load()}>
                Refresh the next items after saving corrections
              </Button>
            )}
          </details>
        </>
      )}
    </section>
  );
}
function BalanceCheck({
  scope,
  d,
  state,
}: {
  scope: string;
  d: Row;
  state: ReturnType<typeof useWorkflow>;
}) {
  const initial = {
      reviewer: "",
      accounts: Object.fromEntries(
        d.accounts
          .filter((a: Row) => a.active)
          .map((a: Row) => [
            a.id,
            {
              amount: "",
              time: localTime(),
              note: "",
              complete: false,
              included: [],
              previousId: a.observation_id || null,
            },
          ]),
      ),
    },
    [draft, setDraft, clear] = useDraft<Row>(scope + ":balance-check", initial),
    update = (id: string, k: string, v: unknown) =>
      setDraft((x) => ({
        ...x,
        accounts: { ...x.accounts, [id]: { ...x.accounts[id], [k]: v } },
      }));
  return (
    <form
      className="panel wf-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const result = await state.send({
          action: "moneyCheck",
          reviewer: draft.reviewer,
          accounts: Object.entries(draft.accounts)
            .filter(([, x]) => (x as Row).amount !== "")
            .map(([id, value]) => {
              const x = value as Row;
              return {
                account: id,
                amount: cents(x.amount),
                observedAt: Date.parse(x.time),
                note: x.note,
                ledgerComplete: x.complete,
                includedPayments: x.included,
                previousId: x.previousId,
              };
            }),
        });
        if (result) clear();
      }}
    >
      <h3>Check balances</h3>
      <p>
        Count cash or check the actual provider balance. Leave any account you
        did not check blank. This does not confirm a member payment or change
        member balances.
      </p>
      <fieldset disabled={state.busy || !!state.pending}>
        {d.accounts
          .filter((a: Row) => a.active)
          .map((a: Row) => {
            const x = draft.accounts[a.id];
            return x ? (
              <div className="wf-row" key={a.id}>
                <h4>{a.name}</h4>
                <p>
                  Last check: {money(a.checked_amount)}
                  {a.observed_at ? " · " + date(a.observed_at) : ""}
                </p>
                {x.previousId !== (a.observation_id || null) && (
                  <p className="notice warning">
                    A newer check was saved. Review it, then{" "}
                    <button
                      type="button"
                      onClick={() =>
                        update(a.id, "previousId", a.observation_id || null)
                      }
                    >
                      base this check on that record
                    </button>
                    .
                  </p>
                )}
                <div className="wf-fields">
                  <NumberField
                    label="Observed amount ($, blank if unchecked)"
                    value={x.amount}
                    set={(v) => update(a.id, "amount", v)}
                  />
                  <Field
                    label="Observed at (local time)"
                    type="datetime-local"
                    value={x.time}
                    onChange={(e: any) => update(a.id, "time", e.target.value)}
                  />
                </div>
                <Field
                  label="Notes / reason for any difference"
                  value={x.note}
                  onChange={(e: any) => update(a.id, "note", e.target.value)}
                />
                <Check
                  label="All activity after this check will be recorded in this account ledger"
                  checked={x.complete}
                  onChange={(v) => update(a.id, "complete", v)}
                />
                <p className="fine">
                  If unchecked, reports show the last checked amount rather than
                  estimate a current balance.
                </p>
                {d.pending.some((p: Row) => p.method === a.id) && (
                  <details>
                    <summary>
                      Unconfirmed reports already included in this observed
                      balance
                    </summary>
                    <p>
                      Select only money you can identify as already present.
                      These reports still need normal confirmation.
                    </p>
                    {d.pending
                      .filter((p: Row) => p.method === a.id)
                      .map((p: Row) => (
                        <Check
                          key={p.id}
                          label={
                            (p.name || "Guest") +
                            " · " +
                            money(p.amount) +
                            " · " +
                            date(p.created_at)
                          }
                          checked={x.included.includes(p.id)}
                          onChange={(v) =>
                            update(
                              a.id,
                              "included",
                              v
                                ? [...x.included, p.id]
                                : x.included.filter(
                                    (id: string) => id !== p.id,
                                  ),
                            )
                          }
                        />
                      ))}
                  </details>
                )}
              </div>
            ) : null;
          })}
        <Field
          label="Second checker (optional)"
          value={draft.reviewer}
          onChange={(e: any) =>
            setDraft((x) => ({ ...x, reviewer: e.target.value }))
          }
        />
        <Button type="submit">Save balance checks</Button>
      </fieldset>
    </form>
  );
}
function MoneyAction({
  mode,
  d,
  state,
  scope,
}: {
  mode: string;
  d: Row;
  state: ReturnType<typeof useWorkflow>;
  scope: string;
}) {
  const [x, setX, clear] = useDraft<Row>(scope + ":money:" + mode, {
      account: "",
      to: "",
      amount: "",
      reason: "",
      time: localTime(),
      kind: mode === "commitment" ? "other" : "morale",
      group: "",
      run: "",
      name: "",
    }),
    set = (k: string, v: string) => setX((x) => ({ ...x, [k]: v })),
    options: [string, string][] = [
      ["", "Select an account"],
      ...d.accounts
        .filter((a: Row) => a.active)
        .map((a: Row): [string, string] => [a.id, a.name]),
    ];
  return (
    <form
      className="panel wf-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const common = {
            amount: cents(x.amount),
            effectiveAt: Date.parse(x.time),
          },
          body =
            mode === "transfer"
              ? {
                  action: "moneyTransfer",
                  from: x.account,
                  to: x.to,
                  reference: x.reason,
                  ...common,
                }
              : mode === "commitment"
                ? {
                    action: "moneyCommitment",
                    label: x.reason,
                    kind: x.kind,
                    groupKey: x.group,
                    runId: x.run || null,
                    status: "open",
                    ...common,
                  }
                : mode === "account"
                  ? {
                      action: "moneyAccount",
                      name: x.name,
                      kind: x.accountKind || "holding",
                    }
                  : mode === "adjustment"
                    ? {
                        action: "moneyAdjustment",
                        account: x.account,
                        reason: x.reason,
                        ...common,
                      }
                    : {
                        action: "moneyExpense",
                        account: x.account,
                        kind: x.kind,
                        reason: x.reason,
                        ...common,
                      };
        if (await state.send(body)) clear();
      }}
    >
      <h3>
        {
          (
            {
              expense: "Activity expense",
              transfer: "Transfer funds",
              commitment: "Record a commitment",
              adjustment: "Account correction",
              account: "Add activity account",
            } as Row
          )[mode]
        }
      </h3>
      <fieldset disabled={state.busy || !!state.pending}>
        {mode === "account" ? (
          <>
            <Field
              label="Account name"
              required
              value={x.name}
              onChange={(e: any) => set("name", e.target.value)}
            />
            <Select
              label="Account type"
              value={x.accountKind || "holding"}
              onChange={(v) => set("accountKind", v)}
              options={[
                ["holding", "Cash holding account"],
                ["investment", "Investment · separate from spendable funds"],
              ]}
            />
          </>
        ) : (
          <>
            {mode !== "commitment" && (
              <Select
                label={
                  mode === "transfer"
                    ? "From account"
                    : "Actual activity account"
                }
                required
                value={x.account}
                onChange={(v) => set("account", v)}
                options={options}
              />
            )}
            <NumberField
              label={
                mode === "adjustment"
                  ? "Signed correction ($, negative to subtract)"
                  : "Amount ($)"
              }
              value={x.amount}
              min={mode === "adjustment" ? -1000000 : 0}
              set={(v) => set("amount", v)}
            />
            {mode === "transfer" && (
              <Select
                label="To account"
                required
                value={x.to}
                onChange={(v) => set("to", v)}
                options={options}
              />
            )}
            <Field
              label={
                mode === "commitment"
                  ? "Obligation description"
                  : "Reference / reason"
              }
              required
              value={x.reason}
              onChange={(e: any) => set("reason", e.target.value)}
            />
            {mode === "commitment" ? (
              <>
                <Select
                  label="Commitment category"
                  value={x.kind}
                  onChange={(v) => set("kind", v)}
                  options={[
                    ["prepaid", "Prepaid member funds"],
                    ["tax", "Taxes payable"],
                    ["refund", "Refund owed"],
                    ["supplier", "Unpaid supplier purchase"],
                    ["other", "Other obligation"],
                  ]}
                />
                <Field
                  label="Unique obligation reference"
                  required
                  value={x.group}
                  onChange={(e: any) => set("group", e.target.value)}
                />
                <Select
                  label="Related restock plan (optional)"
                  value={x.run}
                  onChange={(v) => set("run", v)}
                  options={[
                    ["", "No restock plan"],
                    ...d.openRuns.map((r: Row) => [r.id, r.name]),
                  ]}
                />
                <p className="fine">
                  Use one reference for one obligation. Do not add a
                  reimbursement already listed above or the same obligation
                  under another category.
                </p>
              </>
            ) : (
              <Field
                label="Effective at (local time)"
                type="datetime-local"
                required
                value={x.time}
                onChange={(e: any) => set("time", e.target.value)}
              />
            )}{" "}
            {mode === "expense" && (
              <Select
                label="Expense type"
                value={x.kind}
                onChange={(v) => set("kind", v)}
                options={[
                  ["morale", "Morale activity"],
                  ["fee", "Fee"],
                  ["tax", "Tax"],
                  ["other", "Other"],
                ]}
              />
            )}
          </>
        )}
        <Button type="submit">
          Save {mode === "transfer" ? "transfer" : "record"}
        </Button>
      </fieldset>
    </form>
  );
}
function Reimbursement({
  value: r,
  accounts,
  state,
}: {
  value: Row;
  accounts: Row[];
  state: ReturnType<typeof useWorkflow>;
}) {
  const [amount, setAmount] = useState(String(r.remaining / 100)),
    [account, setAccount] = useState(""),
    [reference, setReference] = useState("");
  return (
    <div className="wf-row">
      <strong>
        {r.purchaser} · {money(r.remaining)} to reimburse
      </strong>
      <details>
        <summary>Record reimbursement payment</summary>
        <form
          className="wf-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void state.send({
              action: "moneySettle",
              receiptId: r.receipt_id,
              amount: cents(amount),
              account,
              reference,
              effectiveAt: Date.now(),
            });
          }}
        >
          <p>
            The original purchase expense is already recorded. This payment
            settles the payable.
          </p>
          <NumberField label="Amount paid ($)" value={amount} set={setAmount} />
          <Select
            label="Activity account used"
            required
            value={account}
            onChange={setAccount}
            options={[
              ["", "Select account"],
              ...accounts.filter((a) => a.active).map((a) => [a.id, a.name]),
            ]}
          />
          <Field
            label="Payment reference"
            required
            value={reference}
            onChange={(e: any) => setReference(e.target.value)}
          />
          <Button disabled={state.busy || !!state.pending}>
            Record payment
          </Button>
        </form>
      </details>
    </div>
  );
}
function CostRepair({
  item: i,
  state,
}: {
  item: Row;
  state: ReturnType<typeof useWorkflow>;
}) {
  const [cost, setCost] = useState(""),
    [evidence, setEvidence] = useState("");
  return (
    <details className="wf-row">
      <summary>
        {i.name} · {i.code} · {date(i.created_at)}
      </summary>
      <form
        className="wf-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void state.send({
            action: "saleCostCorrect",
            itemId: i.id,
            cost: cents(cost),
            evidence,
          });
        }}
      >
        <NumberField
          label="Historical cost per unit ($)"
          value={cost}
          set={setCost}
        />
        <Field
          label="Receipt or other evidence for that sale"
          required
          value={evidence}
          onChange={(e: any) => setEvidence(e.target.value)}
        />
        <Button disabled={state.busy || !!state.pending || !cost}>
          Record audited correction
        </Button>
      </form>
    </details>
  );
}
