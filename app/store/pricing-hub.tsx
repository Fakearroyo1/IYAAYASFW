"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Field, NumberField, money, date, type Row } from "./shared";
import { CostInputs, useCost } from "./cost-inputs";
import { suggestedPrice, priceMargin, roundPrice } from "@/lib/pilot/pricing";
export default function PricingHub({
  data,
  send,
  busy,
  onGear,
}: {
  data: Row;
  send: (b: Row) => Promise<any>;
  busy: boolean;
  onGear: (id: string) => void;
}) {
  const [id, setId] = useState(data.products[0]?.id || "");
  const p = data.products.find((p: Row) => p.id === id) || data.products[0];
  return (
    <section className="panel pricing-hub">
      <div className="section-title">
        <div>
          <h2>Pricing hub</h2>
          <p className="fine">
            Compare costs and margins. Apply prices when you are ready.
          </p>
        </div>
      </div>
      <Field label="Product">
        <NativeSelect
          value={p?.id || ""}
          onChange={(e) => setId(e.target.value)}
        >
          {data.products.map((p: Row) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.archived ? " · Archived" : ""}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {p?.category === "Gear" ? (
        <div className="notice">
          <p>
            Gear prices, options, and availability are managed together in the
            Gear Manager.
          </p>
          <Button type="button" onClick={() => onGear(p.id)}>
            Open Gear Manager
          </Button>
        </div>
      ) : p ? (
        <PricingProduct
          key={p.id + ":" + p.version}
          p={p}
          data={data}
          send={send}
          busy={busy}
        />
      ) : (
        <p>Add a product in Inventory to begin.</p>
      )}
    </section>
  );
}
function PricingProduct({
  p,
  data,
  send,
  busy,
}: {
  p: Row;
  data: Row;
  send: (b: Row) => Promise<any>;
  busy: boolean;
}) {
  const [variantId, setVariantId] = useState("");
  const variant = p.variants?.find((v: Row) => v.id === variantId);
  return (
    <>
      {p.variants?.length ? (
        <Field label="Price for">
          <NativeSelect
            value={variantId}
            onChange={(e) => setVariantId(e.target.value)}
          >
            <option value="">Base price · inherited by options</option>
            {p.variants.map((v: Row) => (
              <option key={v.id} value={v.id}>
                {v.label}
                {!v.active ? " · Hidden" : ""}
              </option>
            ))}
          </NativeSelect>
        </Field>
      ) : null}
      <Calculator
        key={variantId}
        p={p}
        variant={variant}
        send={send}
        busy={busy}
      />
      <Performance p={p} data={data} />
    </>
  );
}
function Calculator({
  p,
  variant,
  send,
  busy,
}: {
  p: Row;
  variant?: Row;
  send: (b: Row) => Promise<any>;
  busy: boolean;
}) {
  const effectiveCost = variant?.cost ?? p.cost,
    currentPrice = variant?.price ?? p.price,
    cost = useCost(effectiveCost),
    [margin, setMargin] = useState("30"),
    [tax, setTax] = useState(p.tax_bp == null ? "" : String(p.tax_bp / 100)),
    [sale, setSale] = useState(
      currentPrice == null ? "" : String(currentPrice / 100),
    ),
    [updateCost, setUpdateCost] = useState(false),
    [inherit, setInherit] = useState(!!variant && variant.price === null),
    [localMessage, setLocalMessage] = useState("");
  const [purchaseOptions,setPurchaseOptions]=useState<Row[]>([]),[optionId,setOptionId]=useState('');
  useEffect(()=>{let live=true;fetch('/api/workflows?view=catalog',{cache:'no-store'}).then(r=>r.json() as Promise<Row>).then(j=>{const entry=j.items?.find((x:Row)=>x.product_id===p.id&&x.option_id===(variant?.id||''));if(live&&entry){setPurchaseOptions(entry.purchaseOptions);const o=entry.purchaseOptions[0];if(o){setOptionId(o.id);cost.setUnits(String(o.units_per_pack));cost.setPackCost(o.pack_price==null?'':String(o.pack_price/100));}}}).catch(()=>{});return()=>{live=false}},[p.id,variant?.id]);
  const taxValue = Number(tax),
    snack = p.category !== "Gear",
    suggested = cost.valid
      ? suggestedPrice(cost.unitCost, Number(margin), taxValue, snack)
      : null,
    appliedPrice = sale ? roundPrice(Number(sale) * 100, snack) : 0,
    marginAt =
      appliedPrice && cost.valid
        ? priceMargin(appliedPrice, cost.unitCost, taxValue)
        : null;
  async function apply(e: React.FormEvent) {
    e.preventDefault();
    setLocalMessage("");
    if (
      !cost.valid ||
      tax === "" ||
      taxValue < 0 ||
      taxValue > 30 ||
      (!inherit && (!Number.isFinite(appliedPrice) || appliedPrice <= 0))
    ) {
      setLocalMessage("Review the price, tax rate, and calculator inputs.");
      return;
    }
    const ok = await send({
      action: "price",
      id: p.id,
      version: p.version,
      ...(variant
        ? { variantId: variant.id, variantVersion: variant.version }
        : {}),
      price: inherit ? null : appliedPrice,
      ...(!variant ? { taxBp: Math.round(taxValue * 100) } : {}),
      ...(updateCost ? { cost: Math.round(cost.unitCost) } : {}),
    });
    if (ok) setLocalMessage("Price applied to future purchases.");
  }
  return (
    <form onSubmit={apply}>
      <fieldset disabled={busy}>
        <div className="pricing-current">
          <div>
            <small>Current selling price</small>
            <strong>{money(currentPrice)}</strong>
          </div>
          <div>
            <small>Recorded unit cost</small>
            <strong>{money(effectiveCost)}</strong>
          </div>
        </div>
        <details open className="workbench">
          <summary>Cost & margin calculator</summary>
          <p className="fine">
            Try a new supplier quote or restock cost. Calculator changes are
            estimates until you apply them.
          </p>
          <Field label="Recorded purchase option"><NativeSelect value={optionId} onChange={e=>{setOptionId(e.target.value);const o=purchaseOptions.find(o=>o.id===e.target.value);if(o){cost.setUnits(String(o.units_per_pack));cost.setPackCost(o.pack_price==null?'':String(o.pack_price/100))}}}><option value="">Manual estimate</option>{purchaseOptions.map(o=><option key={o.id} value={o.id}>{o.supplier} · {o.units_per_pack} units · {o.price_kind} {o.price_at?date(o.price_at):'date missing'}{o.stale?' · recheck price':''}</option>)}</NativeSelect></Field>
          <CostInputs cost={cost} />
          <div className="form-grid">
            <NumberField
              label="Target gross margin (%)"
              value={margin}
              set={setMargin}
            />
            <Field label="Sales tax included in price (%)">
              <Input
                type="number"
                step="0.01"
                min="0"
                max="30"
                value={tax}
                onChange={(e) => setTax(e.target.value)}
                readOnly={!!variant}
                required
              />
            </Field>
          </div>
          <p className="fine">
            Enter the applicable tax rate, or 0 for a confirmed exempt item.
            Margin is calculated after removing included sales tax.
          </p>
          <div className="price-options">
            {[20, 30, 40].map((target) => {
              const price = cost.valid
                ? suggestedPrice(cost.unitCost, target, taxValue, snack)
                : null;
              return (
                <button
                  type="button"
                  key={target}
                  disabled={!price}
                  onClick={() => {
                    setSale(String((price || 0) / 100));
                    setInherit(false);
                  }}
                >
                  <small>{target}% target margin</small>
                  <strong>{money(price)}</strong>
                  <span>
                    {price
                      ? priceMargin(
                          price,
                          cost.unitCost,
                          taxValue,
                        ).margin.toFixed(1) + "% after rounding"
                      : ""}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="suggested-price">
            <div>
              <small>Your {margin || 0}% target</small>
              <strong>{money(suggested)}</strong>
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={!suggested}
              onClick={() => {
                setSale(String((suggested || 0) / 100));
                setInherit(false);
              }}
            >
              Use suggestion
            </Button>
          </div>
        </details>
        <div className="price-apply">
          <h3>Apply a selling price</h3>
          {variant ? (
            <label className="toggle">
              <input
                type="checkbox"
                checked={inherit}
                onChange={(e) => setInherit(e.target.checked)}
              />
              Use the product’s base price
            </label>
          ) : null}
          {!inherit ? (
            <NumberField
              label="Selling price ($, tax included)"
              value={sale}
              set={setSale}
              min={0.01}
            />
          ) : null}
          <p className="fine">
            {snack ? "Snack prices round up to the next $0.25. " : ""}Existing
            purchases and stock counts are preserved.
          </p>
          {!inherit && marginAt ? (
            <p>
              At <strong>{money(appliedPrice)}</strong>:{" "}
              {money(marginAt.profit)} gross profit per unit ·{" "}
              {marginAt.margin.toFixed(1)}% margin using the calculator cost.
            </p>
          ) : null}
          <label className="toggle">
            <input
              type="checkbox"
              checked={updateCost}
              onChange={(e) => setUpdateCost(e.target.checked)}
            />
            Also set recorded unit cost to {money(cost.unitCost)} for future
            purchases
          </label>
          <p className="fine">
            Leave this unchecked to keep the existing cost. Actual restocking
            belongs in Inventory.
          </p>
          <Button type="submit">
            Apply {inherit ? "base price" : money(appliedPrice)}
          </Button>
          {localMessage ? <p role="status">{localMessage}</p> : null}
        </div>
      </fieldset>
    </form>
  );
}
export function Performance({ p, data }: { p: Row; data: Row }) {
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [info, setInfo] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setInfo(null);
    setError("");
    if (from && to && from > to) {
      setError("Choose an end date on or after the start date.");
      return;
    }
    const q = new URLSearchParams({
      dataset: "performance",
      scope: "admin",
      productId: p.id,
      from,
      to,
    });
    fetch("/api/history?" + q, { signal: controller.signal, cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json()) as Record<string, any>;
        if (!r.ok) throw Error(j.error);
        setInfo(j);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [p.id, p.version, data.updatedAt, from, to]);
  async function more() {
    setBusy(true);
    try {
      const q = new URLSearchParams({
        dataset: "performance",
        scope: "admin",
        productId: p.id,
        from,
        to,
        cursor: info!.nextCursor,
      });
      const r = await fetch("/api/history?" + q, { cache: "no-store" }),
        j = (await r.json()) as Record<string, any>;
      if (!r.ok) throw Error(j.error);
      setInfo((old) => ({ ...old,...j,receipts:old!.receipts,receiptCursor:old!.receiptCursor,events: [...old!.events, ...j.events] }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "History could not load.");
    } finally {
      setBusy(false);
    }
  }
  const stats = info?.stats || {
      units: 0,
      sales: 0,
      tax: 0,
      knownCost: 0,
      unknownUnits: 0,
      paidSales: 0,
      profit: null,
    },
    events = info?.events || [],
    costs = info?.restockSpending || 0,
    last = info?.latestRestock;
  return (
    <section className="item-performance">
      <h3>Item performance</h3>
      <div className="form-grid">
        <Field
          label="From (UTC)"
          type="date"
          value={from}
          onChange={(e: any) => setFrom(e.target.value)}
        />
        <Field
          label="Through (UTC)"
          type="date"
          value={to}
          onChange={(e: any) => setTo(e.target.value)}
        />
      </div>
      {from && to && from > to ? (
        <p role="alert">Choose an end date on or after the start date.</p>
      ) : null}
      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : !info ? (
        <p role="status">Loading complete item totals…</p>
      ) : null}
      <div className="stats compact-stats" aria-busy={!info}>
        <div className="stat">
          <small>Units sold</small>
          <b>{stats.units}</b>
        </div>
        <div className="stat">
          <small>Recorded sales</small>
          <b>{money(stats.sales)}</b>
        </div>
        <div className="stat">
          <small>Known cost of sold items</small>
          <b>{money(stats.knownCost)}</b>
        </div>
        <div className="stat">
          <small>Gross profit · known-cost sales</small>
          <b>{money(stats.knownProfit)}</b>
        </div>
      </div>
      <dl className="numbers">
        <div>
          <dt>Paid-order sales</dt>
          <dd>{money(stats.paidSales)}</dd>
        </div>
        <div>
          <dt>Included sales tax</dt>
          <dd>{money(stats.tax)}</dd>
        </div>
        <div>
          <dt>Recorded restock spending</dt>
          <dd>{money(costs)}</dd>
        </div>
        <div>
          <dt>Most recent purchased unit cost</dt>
          <dd>
            {last?.qty ? money(last.amount / last.qty) : "No recorded restock"}
          </dd>
        </div>
      </dl>
      <p className="fine">
        Sales include unpaid purchases and preorders; voided orders are
        excluded. Profit uses recorded sale cost and audited evidence corrections, and excludes payment fees
        and overhead. Restock spending is shown separately, not deducted a
        second time.
        {stats.unknownUnits
          ? " " +
            stats.unknownUnits +
            " sold units have unknown costs; gross profit cannot be determined."
          : ""}{" "}
        Dates cover all options for this product.
      </p>
      <p className="fine">Cost coverage: {stats.units?Math.round((stats.units-stats.unknownUnits)/stats.units*100)+'% of units':'No sales in this period'}. Unknown cost remains unknown until evidence is recorded in Money → Missing sale costs.</p>
      <h3>Purchase receipts</h3>{info?.receipts?.map((r:Row)=><div className="history-entry" key={r.id}><div><strong>{r.reference}</strong><small>{date(r.created_at)} · {r.supplier||'Historical supplier not recorded'}</small><span>{r.packs==null?'Pack details not recorded':r.packs+' packs × '+r.units_per_pack+' units'} · {r.received_qty} units received</span></div><span>{money(r.total_cost)}</span></div>)}{info?.receiptCursor&&<Button disabled={busy} variant="secondary" onClick={async()=>{setBusy(true);try{const q=new URLSearchParams({dataset:'receipts',scope:'admin',productId:p.id,from,to,cursor:info.receiptCursor});const response=await fetch('/api/history?'+q,{cache:'no-store'}),j=await response.json() as Row;if(!response.ok)throw Error(j.error);setInfo(old=>({...old,receipts:[...old!.receipts,...j.records],receiptCursor:j.nextCursor}))}catch(e){setError((e as Error).message)}finally{setBusy(false)}}}>Load older receipts</Button>}
      <h3>Price & stock changes</h3>
      {events.length ? (
        events.map((e: Row) => {
          const d = JSON.parse(e.detail);
          return (
            <div className="history-entry" key={e.id}>
              <div>
                <strong>
                  {e.kind === "stock_received"
                    ? "Stock received"
                    : e.kind === "price_updated"
                      ? "Price applied"
                      : "Product edited"}
                </strong>
                <small>
                  {date(e.created_at)}
                  {d.variant ? " · " + d.variant : ""}
                </small>
              </div>
              <span>
                {e.kind === "stock_received"
                  ? d.qty + " units · " + money(d.amount)
                  : d.after?.price !== undefined
                    ? money(d.before?.price) + " → " + money(d.after.price)
                    : "Details updated"}
              </span>
            </div>
          );
        })
      ) : (
        <p className="fine">No changes recorded in this period.</p>
      )}
      {info?.nextCursor ? (
        <Button variant="outline" disabled={busy} onClick={more}>
          Load older changes
        </Button>
      ) : null}
    </section>
  );
}
