"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, money, date, type Row } from "./shared";
import { campaignStatus } from "@/lib/guest/campaign-status";
import './admin-experience.css';
import {
  useRoadmap,
  RoadmapStatus,
  ActionForm,
  CheckField,
  SelectField,
  reasonField,
  localDate,
  cents,
} from "./roadmap-shared";
export function GearDelivery({ productId }: { productId: string }) {
  const state = useRoadmap({ kind: "guest" }),
    d = state.data;
  return (
    <section className="panel road-stack">
      <h2>Guest delivery options</h2>
      <p className="fine">
        These rates are used by guest campaigns. Member gear remains
        pickup-only.
      </p>
      <RoadmapStatus state={state} />
      {d?.catalog
        .filter((p: Row) => p.product_id === productId)
        .map((p: Row) => {
          const old = d.deliveries.find(
            (x: Row) =>
              x.product_id === productId && x.option_id === p.option_id,
          ) || {
            version: -1,
            pickup: 1,
            shipping: 0,
            first_charge: 0,
            additional_charge: 0,
          };
          return (
            <ActionForm
              key={p.option_id + ":" + old.version}
              title={p.option_label}
              initial={{
                pickup: !!old.pickup,
                shipping: !!old.shipping,
                first: old.first_charge / 100,
                additional: old.additional_charge / 100,
              }}
              fields={[
                { key: "pickup", label: "Allow free pickup", type: "checkbox" },
                {
                  key: "shipping",
                  label: "Allow US shipping",
                  type: "checkbox",
                },
                {
                  key: "first",
                  label: "First item shipping ($)",
                  type: "number",
                  min: 0,
                  step: "0.01",
                },
                {
                  key: "additional",
                  label: "Each additional item ($)",
                  type: "number",
                  min: 0,
                  step: "0.01",
                },
              ]}
              submit={(v) =>
                state.action.send({
                  action: "gearDelivery",
                  productId,
                  optionId: p.option_id,
                  version: old.version,
                  pickup: v.pickup,
                  shipping: v.shipping,
                  firstCharge: cents(v.first),
                  additionalCharge: cents(v.additional),
                })
              }
              busy={state.action.busy}
            />
          );
        })}
    </section>
  );
}
export default function GuestManager({
  onProduct,
  onPayments,
  onTransactions,
  onPickups,
  initialOrderId = "",
}: {
  onProduct: (id: string) => void;
  onPayments: () => void;
  onTransactions: () => void;
  onPickups: () => void;
  initialOrderId?: string;
}) {
  const [tab, setTab] = useState(initialOrderId ? "orders" : "campaigns"),
    [editing, setEditing] = useState<Row | null>(null),
    [code, setCode] = useState(""),
    [offset, setOffset] = useState(0),
    [orderId, setOrderId] = useState(initialOrderId),
    [focusedOrderId, setFocusedOrderId] = useState(initialOrderId);
  const state = useRoadmap({
      kind: "guest",
      offset: String(offset),
      ...(orderId ? { orderId } : {}),
      ...(focusedOrderId ? { targetOrderId: focusedOrderId } : {}),
    }),
    d = state.data,
    a = state.action;
  return (
    <section className="road-stack">
      <div className="section-title">
        <div>
          <h2>Guest gear</h2>
          <p className="fine">
            Campaign access, delivery, and fulfillment at gear.iyaayasfw.com.
          </p>
        </div>
        <a
          className="text-link"
          href="https://gear.iyaayasfw.com"
          target="_blank"
          rel="noreferrer"
        >
          Open storefront
        </a>
      </div>
      <RoadmapStatus state={state} />
      {d ? (
        <>
          <div className="road-tabs">
            {["campaigns", "orders"].map((t) => (
              <Button
                key={t}
                variant={tab === t ? "default" : "secondary"}
                onClick={() => setTab(t)}
              >
                {t === "campaigns" ? "Campaigns" : "Orders & fulfillment"}
              </Button>
            ))}
          </div>
          {tab === "campaigns" ? (
            <>
              <div className="panel">
                <p className="notice">
                  Guest ordering is {d.settings.enabled ? "enabled" : "closed"}.
                  A campaign also needs an active date window and a current
                  code.
                </p>
                <ActionForm
                  key={d.settings.version}
                  title="Store availability"
                  initial={{ enabled: !!d.settings.enabled, reason: "" }}
                  fields={[
                    {
                      key: "enabled",
                      label: "Enable guest ordering",
                      type: "checkbox",
                    },
                    { ...reasonField, label: "Note (optional)", optional: true },
                  ]}
                  busy={a.busy}
                  submit={(v) =>
                    a.send({
                      action: "guestSettings",
                      version: d.settings.version,
                      ...v,
                    })
                  }
                />
              </div>
              <Button
                onClick={() =>
                  setEditing({
                    starts_at: Date.now(),
                    ends_at: Date.now() + 30 * 86400000,
                    reservation_hours: 24,
                    items: [],
                  })
                }
              >
                Create campaign
              </Button>
              {d.campaigns.map((c: Row) => (
                <article className="panel road-stack" key={c.id}>
                  <div className="section-title">
                    <div>
                      <h3>{c.name}</h3>
                      <p className="fine">
                        {date(c.starts_at)}{" "}
                        to {date(c.ends_at)}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setEditing({
                          ...c,
                          items: d.items.filter(
                            (i: Row) => i.campaign_id === c.id,
                          ),
                        })
                      }
                    >
                      Edit campaign
                    </Button>
                  </div>
                  <CampaignAvailability campaign={c} orderingEnabled={!!d.settings.enabled} />
                  <p>{c.description}</p>
                  <p className="fine">
                    Code {c.code_configured ? "configured" : "not configured"} ·
                    reservations {c.reservation_hours} hours
                  </p>
                  <CampaignAccess key={c.id + ":" + c.version} campaign={c} action={a} onCode={setCode}/>
                </article>
              ))}
              {code ? (
                <div className="notice success">
                  <strong>New campaign code—copy it now</strong>
                  <p className="road-code">{code}</p>
                  <p>
                    The code is shown once. Previous codes and sessions no
                    longer work.
                  </p>
                  <Button variant="secondary" onClick={() => setCode("")}>
                    Hide code
                  </Button>
                </div>
              ) : null}
              {editing ? (
                <CampaignEditor
                  deliveries={d.deliveries}
                  key={editing.id || "new"}
                  value={editing}
                  catalog={d.catalog}
                  action={a}
                  close={(newCode?: string) => { setEditing(null); if (newCode) setCode(newCode); }}
                  onProduct={onProduct}
                />
              ) : null}
            </>
          ) : (
            <>
              {focusedOrderId ? <div className="notice"><p>Showing the guest order selected in Needs attention.</p><Button variant="secondary" onClick={() => { setFocusedOrderId(""); setOrderId(""); setOffset(0); }}>Show all guest orders</Button></div> : null}
              <div className="inline-actions">
                <Button onClick={onPayments}>Confirm payments</Button>
                <Button variant="secondary" onClick={onTransactions}>
                  Correct / refund a sale
                </Button>
                <Button variant="secondary" onClick={onPickups}>
                  Receive preorder items
                </Button>
              </div>
              <p className="fine">
                Fulfillment stays locked until payment is confirmed. Confirm
                preorder stock in Pickups before fulfillment.
              </p>
              {d.orders.map((o: Row) => (
                <article className="panel road-stack" key={o.order_id}>
                  <div className="section-title">
                    <div>
                      <h3>
                        {o.code} · {o.payer}
                      </h3>
                      <p className="fine">
                        {o.campaign_name} · {money(o.total)} ·{" "}
                        {o.payment_status.replaceAll("_", " ")}
                      </p>
                    </div>
                    <span className="status">
                      {o.state.replaceAll("_", " ")}
                    </span>
                  </div>
                  <p>{o.email}</p>
                  {o.address ? (
                    <address>
                      {Object.values(JSON.parse(o.address))
                        .filter(Boolean)
                        .join(", ")}
                    </address>
                  ) : (
                    <p>Unit pickup</p>
                  )}
                  <Button
                    variant="secondary"
                    onClick={() => setOrderId(o.order_id)}
                  >
                    View items & timeline
                  </Button>
                  {orderId === o.order_id && d.detail ? (
                    <>
                      <ul className="road-list">
                        {d.detail.items.map((i: Row) => (
                          <li key={i.id}>
                            {i.remaining_qty} × {i.name} {i.variant_label}{" "}
                            {i.personalization}
                          </li>
                        ))}
                      </ul>
                      {d.detail.events.map((e: Row) => (
                        <p className="fine" key={e.id}>
                          {date(e.created_at)} · {e.note}
                        </p>
                      ))}
                    </>
                  ) : null}
                  {o.payment_status === "paid" && nextState(o) ? (
                    <ActionForm
                      key={o.order_id + ":" + o.version}
                      title="Next fulfillment step"
                      initial={{
                        state: nextState(o),
                        carrier: o.carrier,
                        tracking: o.tracking,
                        reason: "",
                      }}
                      fields={[
                        ...(nextState(o) === "shipped"
                          ? [
                              { key: "carrier", label: "Carrier" },
                              { key: "tracking", label: "Tracking reference" },
                            ]
                          : []),
                        { ...reasonField, label: "Fulfillment note (optional)", optional: true },
                      ]}
                      label={"Mark " + nextState(o).replaceAll("_", " ")}
                      busy={a.busy}
                      submit={(v) =>
                        a.send({
                          action: "guestFulfill",
                          id: o.order_id,
                          version: o.version,
                          ...v,
                        })
                      }
                    />
                  ) : null}
                  {o.payment_status === "pending" ? (
                    <ActionForm
                      key={o.order_id + ":extend:" + o.version}
                      title="Reservation"
                      initial={{
                        expires: localDate(o.reservation_expires),
                        reason: "",
                      }}
                      fields={[
                        {
                          key: "expires",
                          label: "Extend until",
                          type: "datetime-local",
                        },
                        reasonField,
                      ]}
                      label="Extend reservation"
                      busy={a.busy}
                      submit={(v) =>
                        a.send({
                          action: "guestExtend",
                          id: o.order_id,
                          version: o.version,
                          expiresAt: new Date(v.expires).getTime(),
                          reason: v.reason,
                        })
                      }
                    />
                  ) : null}
                </article>
              ))}
              {!d.orders.length ? (
                <p className="notice">{focusedOrderId ? "The selected guest order is no longer available." : "No guest orders yet."}</p>
              ) : null}
              <div className="inline-actions">
                <Button
                  variant="secondary"
                  disabled={!offset}
                  onClick={() => setOffset(Math.max(0, offset - 50))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  disabled={!d.more}
                  onClick={() => setOffset(offset + 50)}
                >
                  Next
                </Button>
              </div>
            </>
          )}
        </>
      ) : null}
    </section>
  );
}
export function CampaignAvailability({campaign, orderingEnabled}: {campaign: Row; orderingEnabled: boolean}) {
  const status = campaignStatus(campaign, orderingEnabled);
  return <div><span className="status">{status.label}</span><p className="fine">{status.reason}</p></div>;
}
function CodeFields({mode,code,onMode,onCode}:{mode:string;code:string;onMode:(v:string)=>void;onCode:(v:string)=>void}) {
  return <div className="road-stack"><SelectField label="Campaign code" value={mode} onChange={onMode} options={[["random","Generate an easy-to-read code"],["custom","Use my own phrase or code"]]}/>{mode==='custom'?<Field label="Your phrase or code" value={code} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>onCode(e.target.value)} minLength={8} maxLength={64} required autoComplete="off"/>:null}<p className="fine">Codes ignore capitalization, spaces, and hyphens. Custom codes need at least 8 letters or numbers. Share this campaign code only with your intended shoppers.</p></div>;
}
function CampaignAccess({campaign:c,action:a,onCode}:{campaign:Row;action:ReturnType<typeof useRoadmap>["action"];onCode:(v:string)=>void}) {
  const [mode,setMode]=useState('random'),[code,setCode]=useState(''),[revoke,setRevoke]=useState(false),[note,setNote]=useState('');
  return <details className="road-item"><summary>{c.code_configured?'Change campaign code':'Issue campaign code'}</summary><form className="road-stack" onSubmit={async e=>{e.preventDefault();const r=await a.send({action:'guestCode',id:c.id,version:c.version,revoke,codeMode:mode,customCode:code,reason:note});if(r)onCode(r.code||'');}}><fieldset disabled={a.busy||!!a.pending} className="road-stack"><CheckField label="Revoke access without a replacement code" checked={revoke} onChange={setRevoke}/>{!revoke?<CodeFields mode={mode} code={code} onMode={setMode} onCode={setCode}/>:null}<Field label={revoke?'Reason for revoking access':'Note (optional)'} value={note} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>setNote(e.target.value)} required={revoke} minLength={revoke?5:undefined} maxLength={1000}/><p className="fine">Replacing or revoking the code signs out existing campaign sessions. Saved order receipt access is preserved.</p><Button type="submit">{revoke?'Revoke campaign access':c.code_configured?'Replace campaign code':'Issue code'}</Button></fieldset></form></details>;
}
function nextState(o: Row) {
  return (
    (
      {
        paid: o.delivery === "shipping" ? "packing" : "ready_for_pickup",
        packing: "shipped",
        shipped: "completed",
        ready_for_pickup: "picked_up",
        picked_up: "completed",
      } as Row
    )[o.state] || ""
  );
}
function CampaignEditor({
  value,
  catalog,
  deliveries,
  action,
  close,
  onProduct,
}: {
  value: Row;
  catalog: Row[];
  deliveries: Row[];
  action: ReturnType<typeof useRoadmap>["action"];
  close: (code?: string) => void;
  onProduct: (id: string) => void;
}) {
  const [v, set] = useState<Row>({
    ...value,
    codeMode: 'random',
    customCode: '',
    starts: localDate(value.starts_at),
    ends: localDate(value.ends_at),
    cap: value.shipping_cap == null ? "" : value.shipping_cap / 100,
    free:
      value.free_shipping_threshold == null
        ? ""
        : value.free_shipping_threshold / 100,
    tax: (value.shipping_tax_bp || 0) / 100,
  });
  const [items, setItems] = useState<Row[]>(
    value.items.map((i: Row) => ({
      productId: i.product_id,
      optionId: i.option_id,
      limit: i.quantity_limit,
    })),
  );
  return (
    <form
      className="panel road-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await action.send({
          action: "guestCampaign",
          id: v.id,
          version: v.version,
          name: v.name || "",
          description: v.description || "",
          startsAt: new Date(v.starts).getTime(),
          endsAt: new Date(v.ends).getTime(),
          active: !!v.active,
          reservationHours: Number(v.reservation_hours),
          shippingCap: v.cap === "" ? null : cents(v.cap),
          freeShippingThreshold: v.free === "" ? null : cents(v.free),
          shippingTaxBp: Math.round(Number(v.tax) * 100),
          pickupNote: v.pickup_note || "",
          ...(!v.id ? { codeMode: v.codeMode, customCode: v.customCode } : {}),
          items,
        });
        if (r) close(r.code);
      }}
    >
      <h2>{v.id ? "Edit" : "New"} campaign</h2>
      <div className="road-fields">
        {[
          ["name", "Campaign name", "text"],
          ["description", "Description", "text"],
          ["starts", "Opens", "datetime-local"],
          ["ends", "Closes", "datetime-local"],
          ["reservation_hours", "Reservation hours (1–72)", "number"],
          ["pickup_note", "Pickup instructions", "text"],
          ["cap", "Maximum shipping charge ($, optional)", "number"],
          ["free", "Free shipping threshold ($, optional)", "number"],
          ["tax", "Shipping tax included (%)", "number"],
        ].map(([key, label, type]) => (
          <Field
            key={key}
            label={label}
            type={type}
            value={v[key] ?? ""}
            step={type === "number" ? "0.01" : undefined}
            required={["name", "starts", "ends", "reservation_hours"].includes(
              key,
            )}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              set({ ...v, [key]: e.target.value })
            }
          />
        ))}
      </div>
      <CheckField
        label="Campaign active"
        checked={!!v.active}
        onChange={(x) => set({ ...v, active: x })}
      />
      {!v.id ? <CodeFields mode={v.codeMode} code={v.customCode} onMode={x=>set({...v,codeMode:x})} onCode={x=>set({...v,customCode:x})}/> : null}
      <h3>Gear options and campaign limits</h3>
      <p className="fine">
        Limits include all nonvoid orders in this campaign. Product stock
        remains shared with the member shop.
      </p>
      {catalog.map((p) => {
        const index = items.findIndex(
          (i) => i.productId === p.product_id && i.optionId === p.option_id,
        );
        return (
          <div className="road-item" key={p.product_id + ":" + p.option_id}>
            <CheckField
              label={
                p.name + " · " + p.option_label + " · " + money(p.option_price)
              }
              checked={index >= 0}
              onChange={(checked) =>
                setItems(
                  checked
                    ? [
                        ...items,
                        {
                          productId: p.product_id,
                          optionId: p.option_id,
                          limit: 100,
                        },
                      ]
                    : items.filter((_, i) => i !== index),
                )
              }
            />
            {index >= 0 ? (
              <Field
                label="Campaign quantity limit"
                type="number"
                min={1}
                max={10000}
                value={items[index].limit}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setItems(
                    items.map((x, i) =>
                      i === index ? { ...x, limit: Number(e.target.value) } : x,
                    ),
                  )
                }
              />
            ) : null}
            <Button
              variant="ghost"
              type="button"
              onClick={() => onProduct(p.product_id)}
            >
              Product & delivery settings
            </Button>
          </div>
        );
      })}
      <ShippingPreview
        catalog={catalog.filter((p) =>
          items.some(
            (i) => i.productId === p.product_id && i.optionId === p.option_id,
          ),
        )}
        deliveries={deliveries}
        cap={v.cap}
        free={v.free}
      />
      <div className="inline-actions">
        <Button type="submit" disabled={action.busy}>
          Save campaign
        </Button>
        <Button type="button" variant="secondary" onClick={() => close()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ShippingPreview({
  catalog,
  deliveries,
  cap,
  free,
}: {
  catalog: Row[];
  deliveries: Row[];
  cap: unknown;
  free: unknown;
}) {
  const [quantities, set] = useState<Record<string, number>>({});
  const lines = catalog
      .map<Row>((p) => ({
        ...p,
        ...(deliveries.find(
          (d) => d.product_id === p.product_id && d.option_id === p.option_id,
        ) || { shipping: 0, first_charge: 0, additional_charge: 0 }),
        key: p.product_id + ":" + p.option_id,
        qty: quantities[p.product_id + ":" + p.option_id] || 0,
      }))
      .filter((p) => p.qty > 0),
    subtotal = lines.reduce((n, p) => n + (p.option_price || 0) * p.qty, 0),
    first = [...lines].sort(
      (a, b) => b.first_charge - a.first_charge || a.key.localeCompare(b.key),
    )[0];
  let shipping = first
    ? first.first_charge +
      lines.reduce((n, p) => n + p.additional_charge * p.qty, 0) -
      first.additional_charge
    : 0;
  if (cap !== "") shipping = Math.min(shipping, cents(cap));
  if (free !== "" && subtotal >= cents(free)) shipping = 0;
  return (
    <details className="road-item">
      <summary>Preview a shipping total</summary>
      <p className="fine">
        Uses saved product rates and the campaign limits above. The highest
        first-item charge is used once; remaining units use their
        additional-item rates. Pickup is free.
      </p>
      <div className="road-fields">
        {catalog.map((p) => (
          <Field
            key={p.product_id + ":" + p.option_id}
            label={p.name + " · " + p.option_label + " quantity"}
            type="number"
            min={0}
            max={30}
            value={quantities[p.product_id + ":" + p.option_id] || 0}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              set({
                ...quantities,
                [p.product_id + ":" + p.option_id]: Math.min(
                  30,
                  Math.max(0, Math.trunc(Number(e.target.value) || 0)),
                ),
              })
            }
          />
        ))}
      </div>
      {lines.some((p) => !p.shipping) ? (
        <p className="notice">
          Enable shipping for every selected option in Product & delivery
          settings.
        </p>
      ) : (
        <p>
          Items {money(subtotal)} · shipping {money(shipping)} · order total{" "}
          {money(subtotal + shipping)} (configured tax included)
        </p>
      )}
    </details>
  );
}
