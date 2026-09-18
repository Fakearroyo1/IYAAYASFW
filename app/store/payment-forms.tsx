"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  cashAppUrl,
  clearPaymentDraft,
  paymentDraftId,
  paymentReference,
} from "@/lib/cashapp";
import { Field, money, type Row } from "./shared";

export function CashAppHandoff({
  cashtag,
  amount,
  reference,
}: {
  cashtag: string;
  amount: number;
  reference: string;
}) {
  const [message, setMessage] = useState(""),
    [copying, setCopying] = useState(false),
    [manual, setManual] = useState(false),
    url = cashAppUrl(cashtag, amount);
  useEffect(() => {
    setMessage("");
    setManual(false);
  }, [reference, amount, cashtag]);
  if (!url || !reference)
    return (
      <p className="notice">
        Cash App is not available for this amount. Choose another payment method.
      </p>
    );
  async function open() {
    if (copying || !url) return;
    setCopying(true);
    try {
      // Copy while this document still has focus. Browsers that block the
      // subsequent popup get a normal link, with the reference already copied.
      await navigator.clipboard.writeText(reference);
      let tab: Window | null = null;
      try {
        tab = window.open(url, "_blank");
        if (tab) tab.opener = null;
      } catch {}
      setMessage(
        tab
          ? "Reference copied. Paste it into the Cash App payment note, then return here."
          : "Reference copied. Open Cash App below and paste it into the payment note.",
      );
      setManual(!tab);
    } catch {
      setMessage(
        "Your browser could not copy the reference. Select and copy it below, then open Cash App and paste it into the payment note.",
      );
      setManual(true);
    } finally {
      setCopying(false);
    }
  }
  return (
    <div className="cashapp-handoff">
      <Button
        type="button"
        className="full h-auto whitespace-normal py-3 text-center"
        disabled={copying}
        onClick={() => void open()}
      >
        {copying ? "Copying reference…" : "Copy reference & open Cash App"}
      </Button>
      <p className="fine">
        Opens {money(amount)} in Cash App. Paste the copied reference into its
        payment note. Opening Cash App does not record or confirm a payment.
      </p>
      {message ? <p className="notice" role="status">{message}</p> : null}
      {manual ? (
        <>
          <Field label="Payment reference">
            <Input
              readOnly
              value={reference}
              onFocus={(e) => e.currentTarget.select()}
            />
          </Field>
          <Button asChild variant="secondary" className="full">
            <a href={url} target="_blank" rel="noopener noreferrer">
              Open Cash App · {money(amount)}
            </a>
          </Button>
        </>
      ) : null}
    </div>
  );
}
export function PaymentConfirmation({
  payment,
  send,
  busy,
}: {
  payment: Row;
  send: (b: Row) => Promise<unknown>;
  busy: boolean;
}) {
  const [detail, setDetail] = useState<Row | null>(null),
    [amount, setAmount] = useState(String(payment.amount / 100)),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetch(
      "/api/transactions?" + new URLSearchParams({ paymentId: payment.id }),
      { cache: "no-store" },
    )
      .then(async (r) => {
        const j = (await r.json()) as Row;
        if (!r.ok) throw Error(j.error);
        if (active) {
          setDetail(j);
          setAmount(String(j.payment.amount / 100));
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [payment.id]);
  const p = detail?.payment || payment,
    received = Math.round(Number(amount) * 100),
    debt = detail?.member?.debt || 0;
  const creditAdded =
    p.purpose === "settlement"
      ? Math.max(0, received - debt)
      : p.purpose === "topup"
        ? received
        : Math.max(0, received - p.amount);
  const valid =
    detail &&
    p.status === "pending" &&
    Number.isSafeInteger(received) &&
    received > 0 &&
    received <= 50000 &&
    (p.purpose !== "purchase" || received >= p.amount) &&
    (!detail.member ? received === p.amount : true);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        const f = new FormData(e.currentTarget);
        void send({
          action: "verify",
          id: p.id,
          reference: String(f.get("reference") || ""),
          amountReceived: received,
          expectedCredit: creditAdded,
          confirmed: f.has("confirmed"),
        });
      }}
    >
      <fieldset disabled={busy || !detail}>
        <div className="payment-summary">
          <strong>
            {payment.member_name ||
              detail?.member?.name ||
              payment.payer ||
              "Guest"}
          </strong>
          <span>
            {p.purpose === "settlement"
              ? "Tab payment"
              : p.purpose === "topup"
                ? "Credit deposit"
                : "Purchase payment"}
          </span>
          <small>{money(p.amount)} reported / remaining</small>
          <small>Reference: {payment.order_code || p.order_code || paymentReference(p.id)}</small>
        </div>
        <Field label="Amount actually received ($)">
          <Input
            type="number"
            min="0.01"
            max="500"
            step="0.01"
            value={amount}
            required
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        {p.method === "cashapp" ? (
          <Field label="Cash App transaction ID">
            <Input name="reference" required maxLength={100} />
          </Field>
        ) : (
          <p className="fine">
            A unique cash receipt ID will be generated when you confirm.
          </p>
        )}
        {p.purpose === "settlement" && detail ? (
          <dl className="checkout-totals">
            <div>
              <dt>Current tab</dt>
              <dd>{money(debt)}</dd>
            </div>
            <div>
              <dt>Applied to tab</dt>
              <dd>{money(Math.min(received, debt))}</dd>
            </div>
            <div>
              <dt>New account credit</dt>
              <dd>{money(creditAdded)}</dd>
            </div>
          </dl>
        ) : creditAdded > 0 ? (
          <p className="notice">
            The excess {money(creditAdded)} will become confirmed credit on this
            member’s account.
          </p>
        ) : null}
        <label className="toggle">
          <input type="checkbox" name="confirmed" required />
          <span>
            I checked the cash or Cash App transaction and received{" "}
            {money(received)}.
          </span>
        </label>
        <Button type="submit" disabled={!valid}>
          Confirm payment
        </Button>
        {p.status !== "pending" ? (
          <p className="notice">
            This payment has already been reviewed. Refresh the payment list.
          </p>
        ) : null}
      </fieldset>
      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}
      {!detail && !error ? <p role="status">Loading current balance…</p> : null}
    </form>
  );
}
export function TabPayment({
  member,
  pendingAmount,
  settings,
  send,
  busy,
  creditFirst = false,
}: {
  member: Row;
  pendingAmount: number;
  settings: Row;
  send: (b: Row) => Promise<unknown>;
  busy: boolean;
  creditFirst?: boolean;
}) {
  const [method, setMethod] = useState(creditFirst ? "credit" : "cash");
  const draftKey = "supply-tab-payment:" + member.id,
    [draftId, setDraftId] = useState("");
  useEffect(() => {
    if (method === "cashapp") setDraftId(paymentDraftId(draftKey));
  }, [method, draftKey]);
  const limit =
    method === "credit"
      ? Math.min(member.debt, member.credit)
      : Math.max(0, member.debt - pendingAmount);
  const [amount, setAmount] = useState(
    String(
      (creditFirst
        ? Math.min(member.debt, member.credit)
        : Math.max(0, member.debt - pendingAmount)) / 100,
    ),
  );
  const cents = Math.round(Number(amount) * 100),
    valid =
      Number.isSafeInteger(cents) &&
      cents > 0 &&
      cents <= limit &&
      (method !== "cashapp" || settings.cashtag);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (valid && (method !== "cashapp" || draftId)) {
          const result = await send(
            method === "credit"
              ? { action: "creditSettlement", amount: cents }
              : {
                  action: "payment",
                  ...(method === "cashapp" ? { id: draftId } : {}),
                  purpose: "settlement",
                  method,
                  amount: cents,
                },
          );
          if (result) clearPaymentDraft(draftKey, draftId);
        }
      }}
    >
      <fieldset disabled={busy}>
        <Field label="Payment method">
          <NativeSelect
            value={method}
            onChange={(e) => {
              const v = e.target.value;
              setMethod(v);
              setAmount(
                String(
                  (v === "credit"
                    ? Math.min(member.debt, member.credit)
                    : Math.max(0, member.debt - pendingAmount)) / 100,
                ),
              );
            }}
          >
            <option value="cash" disabled={member.debt <= pendingAmount}>
              Cash
            </option>
            <option
              value="cashapp"
              disabled={!settings.cashtag || member.debt <= pendingAmount}
            >
              Cash App
            </option>
            <option
              value="credit"
              disabled={member.credit <= 0 || member.debt <= 0}
            >
              Account credit · {money(member.credit)}
            </option>
          </NativeSelect>
        </Field>
        <Field label="Amount ($)">
          <Input
            type="number"
            min="0.01"
            max={limit / 100}
            step="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <p className="notice">
          {method === "credit"
            ? "This applies confirmed credit to your tab immediately."
            : "Your report will await administrator confirmation. Only report money you have actually paid."}
        </p>
        {method === "cash" ? (
          <p className="fine">{settings.cash_instructions}</p>
        ) : null}
        {method === "cashapp" && valid && draftId ? (
          <>
            <p className="fine">
              Payment reference: <strong>{paymentReference(draftId)}</strong>
            </p>
            <CashAppHandoff
              cashtag={settings.cashtag}
              amount={cents}
              reference={paymentReference(draftId)}
            />
          </>
        ) : null}
        {pendingAmount > 0 ? (
          <p className="fine">
            {money(pendingAmount)} in payment reports is already awaiting
            confirmation. If those payments exceed your remaining tab, the
            administrator can confirm the excess as credit.
          </p>
        ) : null}
        <Button
          type="submit"
          disabled={!valid || (method === "cashapp" && !draftId)}
        >
          {method === "credit"
            ? "Apply " + money(cents) + " credit"
            : "Report " + money(cents) + " paid"}
        </Button>
      </fieldset>
    </form>
  );
}
