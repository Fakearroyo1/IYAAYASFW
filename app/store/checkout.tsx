"use client";
import { useState } from "react";
import { ShoppingBag, Wallet, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cartValid } from "@/lib/pilot/cart";
import { money, type Row } from "./shared";
export default function Checkout({
  lines,
  member,
  settings,
  preferredShop,
  busy,
  send,
}: {
  lines: Row[];
  member: Row;
  settings: Row;
  preferredShop: string;
  busy: boolean;
  send: (b: Row) => Promise<unknown>;
}) {
  const availableShops = ["snacks", "gear"].filter((s) =>
    lines.some((p) => (p.category === "Gear") === (s === "gear")),
  );
  const [shop, setShop] = useState(
    availableShops.includes(preferredShop)
      ? preferredShop
      : availableShops[0] || "snacks",
  );
  const [method, setMethod] = useState("cash"),
    [useCredit, setUseCredit] = useState(false);
  const selected = lines.filter(
      (p) => (p.category === "Gear") === (shop === "gear"),
    ),
    total = selected.reduce((n, p) => n + p.price * p.qty, 0);
  const chosen = shop === "snacks" ? "tab" : method,
    credit =
      chosen === "credit"
        ? total
        : useCredit
          ? Math.min(member.credit, total)
          : 0;
  const remainder = total - credit,
    effectiveMethod = remainder === 0 && credit > 0 ? "credit" : chosen,
    projected = member.debt + (effectiveMethod === "tab" ? remainder : 0);
  const exceeds =
    effectiveMethod === "tab" && remainder > 0 && projected > member.tab_limit;
  const valid =
    settings.enabled &&
    cartValid(selected) &&
    credit <= member.credit &&
    !exceeds &&
    (chosen !== "cashapp" || settings.cashtag);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        void send({
          action: "order",
          method: effectiveMethod,
          creditAmount: credit,
          items: selected.map((p) => ({
            id: p.id,
            qty: p.qty,
            price: p.price,
            variantId: p.variantId,
            personalization: p.personalization,
            cartKey: p.key,
          })),
        });
      }}
    >
      <fieldset disabled={busy}>
        {availableShops.length > 1 ? (
          <div
            className="checkout-shops"
            role="group"
            aria-label="Choose which shop to check out"
          >
            {availableShops.map((s) => (
              <Button
                type="button"
                key={s}
                variant={shop === s ? "default" : "secondary"}
                aria-pressed={shop === s}
                onClick={() => {
                  setShop(s);
                  setUseCredit(false);
                  setMethod("cash");
                }}
              >
                {s === "snacks" ? "Snack bar" : "Unit gear"}
              </Button>
            ))}
            <p className="fine">
              Each shop checks out separately. Your other items stay in your
              bag.
            </p>
          </div>
        ) : null}
        <div className="checkout-lines">
          {selected.map((p) => (
            <div className="checkout-line" key={p.key}>
              <div>
                <strong>{p.name}</strong>
                <small>
                  {p.qty} × {money(p.price)}
                  {p.variantLabel ? " · " + p.variantLabel : ""}
                </small>
                {p.personalization ? <small>{p.personalization}</small> : null}
              </div>
              <strong>{money(p.price * p.qty)}</strong>
            </div>
          ))}
        </div>
        {shop === "snacks" ? (
          <div className="payment-choice selected">
            <Wallet size={22} />
            <div>
              <strong>Add to my tab</strong>
              <p>
                Keep a running balance. Pay with cash or Cash App from My
                account.
              </p>
            </div>
            <Check size={18} />
          </div>
        ) : (
          <fieldset className="payment-options">
            <legend>How are you paying?</legend>
            {[
              ["cash", "Cash", "Place your payment in the cash box."],
              [
                "cashapp",
                "Cash App",
                "Send the payment after recording your order.",
              ],
              [
                "credit",
                "Account credit",
                money(member.credit) + " available.",
              ],
            ].map(([v, label, hint]) => (
              <label
                className={"payment-choice " + (method === v ? "selected" : "")}
                key={v}
              >
                <input
                  type="radio"
                  name="gear-method"
                  value={v}
                  checked={method === v}
                  onChange={() => setMethod(v)}
                  disabled={
                    (v === "credit" && member.credit < total) ||
                    (v === "cashapp" && !settings.cashtag)
                  }
                />
                <span>
                  <strong>{label}</strong>
                  <small>{hint}</small>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <div className="credit-control">
          <div>
            <strong>Available credit</strong>
            <span>{money(member.credit)}</span>
          </div>
          {chosen !== "credit" ? (
            <label className="toggle">
              <input
                type="checkbox"
                checked={useCredit}
                disabled={member.credit <= 0}
                onChange={(e) => setUseCredit(e.target.checked)}
              />
              <span>Use my credit for this purchase</span>
            </label>
          ) : null}
          <p className="fine">
            Credit is confirmed by an administrator. Your existing tab does not
            prevent you from spending it.
          </p>
        </div>
        <dl className="checkout-totals">
          <div>
            <dt>Purchase total</dt>
            <dd>{money(total)}</dd>
          </div>
          {credit > 0 ? (
            <div>
              <dt>Credit used</dt>
              <dd>−{money(credit)}</dd>
            </div>
          ) : null}
          <div className="checkout-pay">
            <dt>
              {effectiveMethod === "tab"
                ? "Added to your tab"
                : effectiveMethod === "credit"
                  ? "Due after credit"
                  : chosen === "cashapp"
                    ? "Pay with Cash App"
                    : "Pay in cash"}
            </dt>
            <dd>{money(remainder)}</dd>
          </div>
          {shop === "snacks" ? (
            <div>
              <dt>Tab after this purchase</dt>
              <dd>{money(projected)}</dd>
            </div>
          ) : null}
        </dl>
        {exceeds ? (
          <p className="notice error" role="alert">
            This would exceed your {money(member.tab_limit)} tab limit. Use
            available credit, reduce the purchase, or settle your tab first.
          </p>
        ) : shop === "snacks" && projected >= settings.tabReminder ? (
          <p className="notice warning">
            Your tab has reached {money(settings.tabReminder)}. Plan to settle
            it soon; additional tab purchases stop at {money(member.tab_limit)}.
          </p>
        ) : null}
        {shop === "gear" && remainder > 0 ? (
          <p className="notice">
            Your cash or Cash App payment will await administrator confirmation.
            Preorders must be paid before the supplier order, and pickups
            require confirmed payment.
          </p>
        ) : null}
        <Button type="submit" className="full" disabled={!valid}>
          <ShoppingBag size={17} />
          {effectiveMethod === "tab"
            ? "Add " + money(remainder) + " to tab"
            : effectiveMethod === "credit"
              ? "Use " + money(credit) + " credit"
              : "Record order · " + money(remainder) + " due"}
        </Button>
      </fieldset>
    </form>
  );
}
