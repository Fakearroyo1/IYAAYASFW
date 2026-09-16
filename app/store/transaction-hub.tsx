"use client";
import { useEffect, useState } from "react";
import { Plus, Trash2, ReceiptText, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Field, money, date, type Row } from "./shared";
import { PaymentConfirmation } from "./payment-forms";
const labels: Row = {
  tab: "On tab",
  paid: "Paid",
  pending: "Awaiting payment",
  void: "Voided",
  cash: "Cash",
  cashapp: "Cash App",
  credit: "Account credit",
};
export default function TransactionHub({
  data,
  send,
  busy,
  error,
  retry,
  running,
}: {
  data: Row;
  send: (b: Row) => Promise<any>;
  busy: boolean;
  error: string;
  retry?: () => Promise<any>;
  running: boolean;
}) {
  const [records, setRecords] = useState<Row[]>([]),
    [cursor, setCursor] = useState(""),
    [filter, setFilter] = useState("all"),
    [search, setSearch] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [localError, setLocalError] = useState(""),
    [selected, setSelected] = useState(""),
    [detail, setDetail] = useState<Row | null>(null),
    [entry, setEntry] = useState(false),
    [correcting, setCorrecting] = useState(false),
    [confirming, setConfirming] = useState<Row | null>(null),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(false);
  const query = () =>
    new URLSearchParams({
      dataset: "orders",
      scope: "admin",
      filter,
      search,
      from,
      to,
    });
  async function more() {
    setLoading(true);
    try {
      const q = query();
      q.set("cursor", cursor);
      const r = await fetch("/api/history?" + q, { cache: "no-store" }),
        j = (await r.json()) as Row;
      if (!r.ok) throw Error(j.error);
      setRecords((old) => [...old, ...j.records]);
      setCursor(j.nextCursor || "");
    } catch (e) {
      setLocalError(
        e instanceof Error ? e.message : "Could not load transactions.",
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController(),
      timer = setTimeout(() => {
        setLoading(true);
        setLocalError("");
        fetch("/api/history?" + query(), {
          cache: "no-store",
          signal: controller.signal,
        })
          .then(async (r) => {
            const j = (await r.json()) as Row;
            if (!r.ok) throw Error(j.error);
            setRecords(j.records);
            setCursor(j.nextCursor || "");
          })
          .catch((e) => {
            if (e.name !== "AbortError") setLocalError(e.message);
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [filter, search, from, to, revision, data]);
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let active = true;
    setDetail(null);
    fetch("/api/transactions?" + new URLSearchParams({ id: selected }), {
      cache: "no-store",
    })
      .then(async (r) => {
        const j = (await r.json()) as Row;
        if (!r.ok) throw Error(j.error);
        if (active) setDetail(j);
      })
      .catch((e) => {
        if (active) setLocalError(e.message);
      });
    return () => {
      active = false;
    };
  }, [selected, revision]);
  async function save(b: Row) {
    const ok = await send(b);
    if (ok) {
      setRevision((n) => n + 1);
      setEntry(false);
      setCorrecting(false);
      setConfirming(null);
    }
    return ok;
  }
  return (
    <>
      <section className="panel">
        <div className="section-title">
          <div>
            <h2>Transactions</h2>
            <p className="fine">
              Guest sales, member purchases, payment follow-up, and corrections.
            </p>
          </div>
          <Button disabled={busy} onClick={() => setEntry(true)}>
            <Plus size={17} />
            Record a sale
          </Button>
        </div>
        <div className="admin-filters">
          <Field label="Find a purchase">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Reference or member / guest name"
            />
          </Field>
          <Field label="Show">
            <NativeSelect
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All transactions</option>
              <option value="guest">Guest sales</option>
              <option value="unsettled">Unsettled guest sales</option>
              <option value="corrected">Corrected purchases</option>
              <option value="void">Voided purchases</option>
            </NativeSelect>
          </Field>
          <Field label="From">
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="Through">
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
        </div>
        {localError ? (
          <p className="notice error" role="alert">
            {localError}
          </p>
        ) : null}
        {loading ? (
          <p className="fine" role="status">
            Loading transactions…
          </p>
        ) : null}
        <div className="transaction-list">
          {records.map((o) => (
            <button
              type="button"
              className="transaction-row"
              key={o.id}
              onClick={() => {
                setSelected(o.id);
                setCorrecting(false);
                setConfirming(null);
              }}
            >
              <span className="transaction-icon">
                <ReceiptText size={21} />
              </span>
              <span className="transaction-person">
                <strong>{o.payer}</strong>
                <small>
                  {o.member_id ? "Member" : "Guest"} · {o.code}
                </small>
                <small>{date(o.created_at)}</small>
              </span>
              <span className="transaction-amount">
                <strong>{money(o.status === "void" ? 0 : o.total)}</strong>
                {o.adjusted_total > 0 ? (
                  <small>{money(o.original_total)} originally</small>
                ) : null}
                <span className={"status " + o.status}>{labels[o.status]}</span>
              </span>
            </button>
          ))}
        </div>
        {!loading && !records.length ? (
          <div className="empty">
            <ReceiptText size={30} />
            <h3>No matching transactions.</h3>
            <p>Try a different reference, date, or filter.</p>
          </div>
        ) : null}
        {cursor ? (
          <Button variant="secondary" disabled={loading} onClick={more}>
            Load older transactions
          </Button>
        ) : null}
      </section>
      <Dialog
        open={entry}
        onOpenChange={(o) => {
          if (!running) setEntry(o);
        }}
      >
        <DialogContent className="pilot-dialog transaction-dialog">
          <DialogTitle>Record a sale</DialogTitle>
          <DialogDescription>
            Guest payments are confirmed now. Use the explicit override only
            when payment is outstanding.
          </DialogDescription>
          {retry ? (
            <p className="notice warning">
              Confirmation is pending.{" "}
              <Button
                type="button"
                disabled={running}
                onClick={async () => {
                  if (await retry()) {
                    setEntry(false);
                    setRevision((n) => n + 1);
                  }
                }}
              >
                Retry safely
              </Button>
            </p>
          ) : null}
          <SaleEntry
            products={data.products}
            settings={data.settings}
            send={save}
            busy={busy}
          />
          {error ? (
            <p className="notice error" role="alert">
              {error}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!selected}
        onOpenChange={(o) => {
          if (!o && !running) {
            setSelected("");
            setCorrecting(false);
            setConfirming(null);
          }
        }}
      >
        <DialogContent className="pilot-dialog transaction-dialog">
          <DialogTitle>
            {detail?.order.code || "Review transaction"}
          </DialogTitle>
          <DialogDescription>
            Original records remain available alongside every correction.
          </DialogDescription>
          {retry ? (
            <p className="notice warning">
              Confirmation is pending.{" "}
              <Button
                type="button"
                disabled={running}
                onClick={async () => {
                  if (await retry()) {
                    setConfirming(null);
                    setCorrecting(false);
                    setRevision((n) => n + 1);
                  }
                }}
              >
                Retry safely
              </Button>
            </p>
          ) : null}
          {detail ? (
            <>
              {confirming ? (
                <>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setConfirming(null)}
                  >
                    <ArrowLeft size={16} />
                    Back to transaction
                  </Button>
                  <PaymentConfirmation
                    payment={confirming}
                    send={save}
                    busy={busy}
                  />
                </>
              ) : correcting ? (
                <>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setCorrecting(false)}
                  >
                    <ArrowLeft size={16} />
                    Back to transaction
                  </Button>
                  <CorrectionForm detail={detail} send={save} busy={busy} />
                </>
              ) : (
                <>
                  <div className="transaction-heading">
                    <div>
                      <strong>{detail.order.payer}</strong>
                      <small>
                        {detail.order.member_id
                          ? "Member purchase"
                          : "Guest purchase"}{" "}
                        · {date(detail.order.created_at)}
                      </small>
                    </div>
                    <span className={"status " + detail.order.status}>
                      {labels[detail.order.status]}
                    </span>
                  </div>
                  <dl className="checkout-totals">
                    <div>
                      <dt>Original purchase</dt>
                      <dd>{money(detail.order.original_total)}</dd>
                    </div>
                    <div>
                      <dt>Corrections</dt>
                      <dd>−{money(detail.order.adjusted_total)}</dd>
                    </div>
                    <div className="checkout-pay">
                      <dt>Current sale value</dt>
                      <dd>
                        {money(
                          detail.order.status === "void"
                            ? 0
                            : detail.order.total,
                        )}
                      </dd>
                    </div>
                  </dl>
                  <div className="transaction-items">
                    {detail.items.map((i: Row) => (
                      <div className="checkout-line" key={i.id}>
                        <div>
                          <strong>{i.name}</strong>
                          <small>
                            {i.qty} × {money(i.price)}
                            {i.variant_label ? " · " + i.variant_label : ""}
                          </small>
                          {i.personalization ? (
                            <small>{i.personalization}</small>
                          ) : null}
                          {i.corrected_qty > 0 ? (
                            <small>
                              {i.corrected_qty} reversed · {i.remaining_qty}{" "}
                              remaining
                            </small>
                          ) : null}
                        </div>
                        <strong>{money(i.price * i.remaining_qty)}</strong>
                      </div>
                    ))}
                  </div>
                  {detail.order.status !== "void" && detail.order.total > 0 ? (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => setCorrecting(true)}
                    >
                      Correct or reverse items
                    </Button>
                  ) : null}
                  <section className="transaction-section">
                    <h3>Payment record</h3>
                    {detail.payments.length ? (
                      detail.payments.map((p: Row) => (
                        <div className="transaction-payment" key={p.id}>
                          <div>
                            <strong>
                              {p.purpose === "refund" ? "Refund" : "Payment"} ·{" "}
                              {money(p.amount)}
                            </strong>
                            <small>
                              {labels[p.method]} ·{" "}
                              {p.status === "verified"
                                ? "Confirmed"
                                : p.status === "rejected"
                                  ? "Rejected"
                                  : "Awaiting confirmation"}
                            </small>
                            {p.reference ? <code>{p.reference}</code> : null}
                            {p.verified_name ? (
                              <small>Confirmed by {p.verified_name}</small>
                            ) : null}
                            {p.credit_added > 0 ? (
                              <small>
                                {money(p.credit_added)} added to credit
                              </small>
                            ) : null}
                          </div>
                          {p.status === "pending" && p.amount > 0 ? (
                            <Button
                              variant="secondary"
                              disabled={busy}
                              onClick={() => setConfirming(p)}
                            >
                              Confirm received
                            </Button>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <p className="fine">
                        {detail.order.credit_used > 0
                          ? money(detail.order.credit_used) +
                            " paid from confirmed credit. "
                          : ""}
                        {detail.order.tab_added > 0
                          ? money(detail.order.tab_added) +
                            " added to the member’s tab."
                          : ""}
                      </p>
                    )}
                  </section>
                  <section className="transaction-section">
                    <h3>Corrections & refunds</h3>
                    {detail.adjustments.length ? (
                      detail.adjustments.map((a: Row) => (
                        <div className="transaction-adjustment" key={a.id}>
                          <strong>
                            {money(a.total)} reversed ·{" "}
                            {a.actor_name || a.actor}
                          </strong>
                          <small>{date(a.created_at)}</small>
                          <p>{a.reason}</p>
                          <small>
                            {a.debt_reduced
                              ? money(a.debt_reduced) + " removed from tab. "
                              : ""}
                            {a.credit_returned
                              ? money(a.credit_returned) +
                                " returned as credit. "
                              : ""}
                            {a.external_refund
                              ? money(a.external_refund) +
                                " refunded by " +
                                labels[a.refund_method] +
                                ". "
                              : ""}
                            {a.pending_reduced
                              ? money(a.pending_reduced) +
                                " of unconfirmed payment cancelled."
                              : ""}
                          </small>
                        </div>
                      ))
                    ) : (
                      <p className="fine">No corrections recorded.</p>
                    )}
                  </section>
                </>
              )}
              {error ? (
                <p className="notice error" role="alert">
                  {error}
                </p>
              ) : null}
            </>
          ) : (
            <p role="status">{localError || "Loading transaction…"}</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
function SaleEntry({
  products,
  settings,
  send,
  busy,
}: {
  products: Row[];
  settings: Row;
  send: (b: Row) => Promise<any>;
  busy: boolean;
}) {
  const [mode, setMode] = useState("guest"),
    [memberQuery, setMemberQuery] = useState(""),
    [members, setMembers] = useState<Row[]>([]),
    [member, setMember] = useState<Row | null>(null),
    [rows, setRows] = useState<Row[]>([
      {
        key: "first",
        choice: "",
        qty: "1",
        name: "",
        price: "",
        cost: "",
        tax: "0",
        category: "Snacks",
        personalization: "",
      },
    ]),
    [method, setMethod] = useState("cash"),
    [unsettled, setUnsettled] = useState(false),
    [useCredit, setUseCredit] = useState(false),
    [lookupError, setLookupError] = useState("");
  useEffect(() => {
    if (mode !== "member") return;
    const controller = new AbortController(),
      timer = setTimeout(() => {
        fetch(
          "/api/history?" +
            new URLSearchParams({
              dataset: "members",
              scope: "admin",
              filter: "active",
              search: memberQuery,
            }),
          { cache: "no-store", signal: controller.signal },
        )
          .then(async (r) => {
            const j = (await r.json()) as Row;
            if (!r.ok) throw Error(j.error);
            setMembers(j.records);
          })
          .catch((e) => {
            if (e.name !== "AbortError") setLookupError(e.message);
          });
      }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [mode, memberQuery]);
  const choices: Row[] = products
    .filter((p) => p.active && !p.archived)
    .flatMap((p) =>
      p.variants?.length
        ? p.variants
            .filter((v: Row) => v.active)
            .map((v: Row) => ({
              key: p.id + "|" + v.id,
              p,
              v,
              price: v.price ?? p.price,
            }))
        : [{ key: p.id, p, v: null, price: p.price }],
    )
    .filter((p) => p.price > 0 && p.p.tax_bp !== null);
  const patch = (key: string, change: Row) =>
    setRows((old) => old.map((r) => (r.key === key ? { ...r, ...change } : r)));
  const items = rows.map((r) => {
    const c = choices.find((c) => c.key === r.choice);
    return r.choice === "custom"
      ? {
          custom: true,
          name: r.name,
          category: r.category,
          qty: Number(r.qty),
          price: Math.round(Number(r.price) * 100),
          cost: r.cost === "" ? null : Math.round(Number(r.cost) * 100),
          taxBp: Math.round(Number(r.tax) * 100),
        }
      : c
        ? {
            id: c.p.id,
            qty: Number(r.qty),
            price: c.price,
            variantId: c.v?.id || "",
            personalization: r.personalization,
          }
        : null;
  });
  const selected = items.filter(Boolean) as Row[],
    total = selected.reduce((n, i) => n + i.qty * i.price, 0),
    hasGear = rows.some((r) =>
      r.choice === "custom"
        ? r.category === "Gear"
        : choices.find((c) => c.key === r.choice)?.p.category === "Gear",
    ),
    hasSnacks = rows.some((r) =>
      r.choice === "custom"
        ? r.category !== "Gear"
        : !!r.choice &&
          choices.find((c) => c.key === r.choice)?.p.category !== "Gear",
    );
  const memberMode = mode === "member",
    chosen = memberMode && hasSnacks && !hasGear ? "tab" : method,
    credit =
      memberMode && member
        ? chosen === "credit"
          ? total
          : useCredit
            ? Math.min(total, member.credit)
            : 0
        : 0,
    remainder = total - credit,
    effective = credit === total && credit > 0 ? "credit" : chosen;
  const valid =
    items.every(Boolean) &&
    total > 0 &&
    total <= 50000 &&
    (!memberMode ||
      (!!member &&
        !(hasGear && hasSnacks) &&
        credit <= member.credit &&
        (!(effective === "tab" && remainder > 0) ||
          member.debt + remainder <= member.tab_limit))) &&
    (effective !== "cashapp" || settings.cashtag);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        const f = new FormData(e.currentTarget);
        void send({
          action: memberMode ? "memberOrder" : "guestOrder",
          id: crypto.randomUUID(),
          memberId: member?.id,
          payer: String(f.get("payer") || "Guest"),
          items: selected,
          method: effective,
          creditAmount: credit,
          unsettled: unsettled && ["cash", "cashapp"].includes(effective),
          confirmed: f.has("confirmed"),
          reference: String(f.get("reference") || ""),
          reason: String(f.get("reason") || ""),
        });
      }}
    >
      <fieldset disabled={busy}>
        <Field label="Purchaser">
          <NativeSelect
            value={mode}
            onChange={(e) => {
              setMode(e.target.value);
              setUseCredit(false);
              setUnsettled(false);
            }}
          >
            <option value="guest">Guest · no site account</option>
            <option value="member">
              Existing member · administrator entry
            </option>
          </NativeSelect>
        </Field>
        {memberMode ? (
          <>
            <Field label="Find member">
              <Input
                value={memberQuery}
                onChange={(e) => setMemberQuery(e.target.value)}
                placeholder="Name or approved email"
              />
            </Field>
            <Field label="Member">
              <NativeSelect
                required
                value={member?.id || ""}
                onChange={(e) =>
                  setMember(
                    members.find((m) => m.id === e.target.value) || null,
                  )
                }
              >
                <option value="">Choose a member</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · {m.email}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {lookupError ? <p className="notice error">{lookupError}</p> : null}
            {member ? (
              <p className="fine">
                Tab {money(member.debt)} · Credit {money(member.credit)}
              </p>
            ) : null}
          </>
        ) : (
          <Field
            label={
              unsettled ? "Guest name / identifier" : "Guest name (optional)"
            }
          >
            <Input name="payer" required={unsettled} maxLength={100} />
          </Field>
        )}
        <div className="sale-entry-lines">
          {rows.map((r, index) => {
            const c = choices.find((c) => c.key === r.choice);
            return (
              <div className="sale-entry-line" key={r.key}>
                <div className="section-title">
                  <strong>Item {index + 1}</strong>
                  {rows.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={"Remove sale line " + (index + 1)}
                      onClick={() =>
                        setRows((old) => old.filter((x) => x.key !== r.key))
                      }
                    >
                      <Trash2 size={16} />
                    </Button>
                  ) : null}
                </div>
                <Field label="Product">
                  <NativeSelect
                    value={r.choice}
                    onChange={(e) =>
                      patch(r.key, {
                        choice: e.target.value,
                        personalization: "",
                      })
                    }
                    required
                  >
                    <option value="">Choose a product</option>
                    {choices.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.p.name}
                        {c.v ? " · " + c.v.label : ""} · {money(c.price)}
                      </option>
                    ))}
                    <option value="custom">
                      Custom sale · no stock deduction
                    </option>
                  </NativeSelect>
                </Field>
                {r.choice === "custom" ? (
                  <>
                    <Field label="Description">
                      <Input
                        value={r.name}
                        onChange={(e) => patch(r.key, { name: e.target.value })}
                        required
                        maxLength={100}
                      />
                    </Field>
                    <div className="form-grid">
                      <Field label="Shop">
                        <NativeSelect
                          value={r.category}
                          onChange={(e) =>
                            patch(r.key, { category: e.target.value })
                          }
                        >
                          <option value="Snacks">Snack bar</option>
                          <option value="Gear">Unit gear</option>
                        </NativeSelect>
                      </Field>
                      <Field label="Unit price ($)">
                        <Input
                          type="number"
                          min="0.01"
                          max="1000"
                          step="0.01"
                          value={r.price}
                          required
                          onChange={(e) =>
                            patch(r.key, { price: e.target.value })
                          }
                        />
                      </Field>
                      <Field label="Unit cost ($, optional)">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={r.cost}
                          onChange={(e) =>
                            patch(r.key, { cost: e.target.value })
                          }
                        />
                      </Field>
                      <Field label="Included tax rate (%)">
                        <Input
                          type="number"
                          min="0"
                          max="30"
                          step="0.01"
                          value={r.tax}
                          required
                          onChange={(e) =>
                            patch(r.key, { tax: e.target.value })
                          }
                        />
                      </Field>
                    </div>
                  </>
                ) : null}
                <div className="form-grid">
                  <Field label="Quantity">
                    <Input
                      type="number"
                      min="1"
                      max="30"
                      value={r.qty}
                      required
                      onChange={(e) => patch(r.key, { qty: e.target.value })}
                    />
                  </Field>
                  {c?.p.personalization_label ? (
                    <Field label={c.p.personalization_label}>
                      <Input
                        value={r.personalization}
                        onChange={(e) =>
                          patch(r.key, { personalization: e.target.value })
                        }
                        required={!!c.p.personalization_required}
                        maxLength={c.p.personalization_max}
                      />
                    </Field>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={rows.length >= 30}
          onClick={() =>
            setRows((old) => [
              ...old,
              {
                key: crypto.randomUUID(),
                choice: "",
                qty: "1",
                name: "",
                price: "",
                cost: "",
                tax: "0",
                category: "Snacks",
                personalization: "",
              },
            ])
          }
        >
          <Plus size={16} />
          Add sale line
        </Button>
        {memberMode && hasGear && hasSnacks ? (
          <p className="notice warning">
            Record snack and gear purchases separately for members.
          </p>
        ) : null}
        {memberMode && hasSnacks && !hasGear ? (
          <p className="notice">
            Snack purchases are added to this member’s tab. Available credit can
            be applied below.
          </p>
        ) : (
          <Field label="Payment method">
            <NativeSelect
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              <option value="cash">Cash</option>
              <option value="cashapp" disabled={!settings.cashtag}>
                Cash App
              </option>
              {memberMode ? (
                <option
                  value="credit"
                  disabled={!member || member.credit < total}
                >
                  Account credit
                </option>
              ) : null}
            </NativeSelect>
          </Field>
        )}
        {memberMode && chosen !== "credit" ? (
          <label className="toggle">
            <input
              type="checkbox"
              checked={useCredit}
              disabled={!member?.credit}
              onChange={(e) => setUseCredit(e.target.checked)}
            />
            <span>Use available member credit</span>
          </label>
        ) : null}
        <dl className="checkout-totals">
          <div>
            <dt>Sale total</dt>
            <dd>{money(total)}</dd>
          </div>
          {credit > 0 ? (
            <div>
              <dt>Account credit</dt>
              <dd>−{money(credit)}</dd>
            </div>
          ) : null}
          <div className="checkout-pay">
            <dt>
              {effective === "tab" ? "Added to tab" : "Payment to confirm"}
            </dt>
            <dd>{money(remainder)}</dd>
          </div>
        </dl>
        {["cash", "cashapp"].includes(effective) ? (
          <>
            <label className="toggle">
              <input
                type="checkbox"
                checked={unsettled}
                onChange={(e) => setUnsettled(e.target.checked)}
              />
              <span>Override: leave this sale unsettled</span>
            </label>
            {!unsettled && effective === "cashapp" ? (
              <Field label="Cash App transaction ID">
                <Input name="reference" required maxLength={100} />
              </Field>
            ) : !unsettled ? (
              <p className="fine">
                A cash receipt ID is generated automatically.
              </p>
            ) : null}
            {!unsettled ? (
              <label className="toggle">
                <input name="confirmed" type="checkbox" required />
                <span>I have received the {money(remainder)} payment.</span>
              </label>
            ) : (
              <p className="notice warning">
                This remains an outstanding sale until an administrator confirms
                payment.
              </p>
            )}
          </>
        ) : null}
        <Field
          label={
            unsettled
              ? "Reason for unsettled override"
              : memberMode
                ? "Reason / related correction reference"
                : "Record note (optional)"
          }
        >
          <textarea
            name="reason"
            required={unsettled || memberMode}
            minLength={unsettled || memberMode ? 5 : undefined}
            maxLength={300}
          />
        </Field>
        <Button type="submit" disabled={!valid}>
          Record {memberMode ? "member" : "guest"} sale
        </Button>
      </fieldset>
    </form>
  );
}
function CorrectionForm({
  detail,
  send,
  busy,
}: {
  detail: Row;
  send: (b: Row) => Promise<any>;
  busy: boolean;
}) {
  const [selected, setSelected] = useState<Row>({}),
    [restock, setRestock] = useState<Row>({}),
    [refundMethod, setRefundMethod] = useState(
      detail.member ? "credit" : "cash",
    );
  const items = detail.items.filter((i: Row) => i.remaining_qty > 0),
    selection = items
      .filter((i: Row) => Number(selected[i.id]) > 0)
      .map((i: Row) => ({
        id: i.id,
        qty: Number(selected[i.id]),
        restock: !!restock[i.id],
      }));
  const total = selection.reduce(
      (n: number, s: Row) =>
        n + s.qty * items.find((i: Row) => i.id === s.id).price,
      0,
    ),
    pending =
      detail.payments.find(
        (p: Row) => p.status === "pending" && p.purpose === "purchase",
      )?.amount || 0;
  const pendingReduced = Math.min(total, pending),
    debtReduced = detail.member
      ? Math.min(
          total - pendingReduced,
          Math.max(0, detail.order.tab_added - detail.order.debt_reduced),
          detail.member.debt,
        )
      : 0,
    toReturn = total - pendingReduced - debtReduced;
  const valid =
    selection.length > 0 &&
    selection.every(
      (s: Row) =>
        Number.isInteger(s.qty) &&
        s.qty > 0 &&
        s.qty <= items.find((i: Row) => i.id === s.id).remaining_qty,
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        const f = new FormData(e.currentTarget);
        void send({
          action: "correctTransaction",
          id: detail.order.id,
          revision: detail.order.revision,
          items: selection,
          expectedTotal: total,
          expectedDebtReduction: debtReduced,
          expectedReturn: toReturn,
          refundMethod,
          reference: String(f.get("reference") || ""),
          reason: String(f.get("reason")),
          confirmed: f.has("confirmed"),
        });
      }}
    >
      <fieldset disabled={busy}>
        <p className="fine">
          Reverse the incorrect quantities below. To replace a wrong item or
          price, record a corrected member or guest sale afterward and include
          this purchase reference.
        </p>
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            setSelected(
              Object.fromEntries(
                items.map((i: Row) => [i.id, i.remaining_qty]),
              ),
            )
          }
        >
          Select entire remaining sale
        </Button>
        {items.map((i: Row) => (
          <div className="correction-line" key={i.id}>
            <strong>
              {i.name}
              {i.variant_label ? " · " + i.variant_label : ""}
            </strong>
            <small>
              {i.remaining_qty} available to reverse · {money(i.price)} each
            </small>
            <Field label="Quantity to reverse">
              <Input
                type="number"
                min="0"
                max={i.remaining_qty}
                value={selected[i.id] || 0}
                onChange={(e) =>
                  setSelected((old) => ({ ...old, [i.id]: e.target.value }))
                }
              />
            </Field>
            {!i.custom && !i.preorder ? (
              <label className="toggle">
                <input
                  type="checkbox"
                  disabled={!Number(selected[i.id])}
                  checked={!!restock[i.id]}
                  onChange={(e) =>
                    setRestock((old) => ({ ...old, [i.id]: e.target.checked }))
                  }
                />
                <span>
                  Restore these units to inventory (returned or not taken)
                </span>
              </label>
            ) : (
              <p className="fine">
                No stocked quantity will be restored for this line.
              </p>
            )}
          </div>
        ))}
        <dl className="checkout-totals">
          <div>
            <dt>Sales value reversed</dt>
            <dd>{money(total)}</dd>
          </div>
          {pendingReduced > 0 ? (
            <div>
              <dt>Unconfirmed payment cancelled</dt>
              <dd>{money(pendingReduced)}</dd>
            </div>
          ) : null}
          {debtReduced > 0 ? (
            <div>
              <dt>Removed from current tab</dt>
              <dd>{money(debtReduced)}</dd>
            </div>
          ) : null}
          <div className="checkout-pay">
            <dt>Paid amount to return</dt>
            <dd>{money(toReturn)}</dd>
          </div>
        </dl>
        {detail.order.tab_added > 0 ? (
          <p className="fine">
            For tab purchases, the reversal first reduces the member’s current
            debt. Any remaining value is returned using the method below.
          </p>
        ) : null}
        {toReturn > 0 ? (
          <>
            <Field label="Refund method">
              <NativeSelect
                value={refundMethod}
                onChange={(e) => setRefundMethod(e.target.value)}
              >
                {detail.member ? (
                  <option value="credit">Return as account credit</option>
                ) : null}
                <option value="cash">Cash refund</option>
                <option value="cashapp">Cash App refund</option>
              </NativeSelect>
            </Field>
            {refundMethod === "cashapp" ? (
              <Field label="Cash App refund transaction ID">
                <Input name="reference" required maxLength={100} />
              </Field>
            ) : refundMethod === "cash" ? (
              <p className="fine">
                A cash refund receipt ID will be generated.
              </p>
            ) : null}
          </>
        ) : null}
        <Field label="What happened?">
          <textarea
            name="reason"
            minLength={5}
            maxLength={500}
            required
            placeholder="Describe the error, correction, and any related records."
          />
        </Field>
        <label className="toggle">
          <input type="checkbox" name="confirmed" required />
          <span>
            I reviewed these changes
            {toReturn > 0 && refundMethod !== "credit"
              ? " and have returned the cash / Cash App payment"
              : ""}
            .
          </span>
        </label>
        <Button variant="destructive" type="submit" disabled={!valid}>
          Confirm correction · {money(total)}
        </Button>
      </fieldset>
    </form>
  );
}
