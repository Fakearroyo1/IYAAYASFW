"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, money, date, type Row } from "./shared";
import {
  useRoadmap,
  RoadmapStatus,
  ActionForm,
  CheckField,
  SelectField,
  reasonField,
  cents,
} from "./roadmap-shared";
export default function InventoryAutopilot() {
  const state = useRoadmap({ kind: "inventory" }),
    d = state.data,
    a = state.action,
    [tab, setTab] = useState("planning"),
    [selected, setSelected] = useState<Row[]>([]),
    [name, setName] = useState("Restock run"),
    [edit, setEdit] = useState(""),
    [vendor, setVendor] = useState("all");
  return (
    <section className="road-stack">
      <div>
        <h2>Inventory planning</h2>
        <p className="fine">
          Explainable restock suggestions, shopping runs, and small physical
          counts.
        </p>
      </div>
      <div className="road-tabs">
        {[
          ["planning", "Plan a run"],
          ["runs", "Restock runs"],
          ["counts", "Cycle counts"],
        ].map(([id, title]) => (
          <Button
            key={id}
            variant={tab === id ? "default" : "secondary"}
            onClick={() => setTab(id)}
          >
            {title}
          </Button>
        ))}
      </div>
      <RoadmapStatus state={state} />
      {d ? (
        tab === "planning" ? (
          <>
            <div className="panel road-stack">
              <p className="fine">
                Suggested stock covers lead time plus target days, adds safety
                units, subtracts available stock, and rounds up to a pack.
                Consumption uses net paid/tab quantities from the last 30 days.
                New items may need a manual plan.
              </p>
              <SelectField
                label="Vendor / store"
                value={vendor}
                onChange={setVendor}
                options={
                  [
                    ["all", "All vendors"],
                    ...Array.from(
                      new Set(
                        d.items.map((p: Row) => p.vendor || "Unassigned"),
                      ),
                    ).map((x) => [String(x), String(x)]),
                  ] as [string, string][]
                }
              />
              <div className="road-fields">
                <Field
                  label="Run name"
                  value={name}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setName(e.target.value)
                  }
                />
                <Button
                  disabled={!selected.length || a.busy}
                  onClick={async () => {
                    const r = await a.send({
                      action: "restockCreate",
                      name,
                      items: selected,
                    });
                    if (r) {
                      setSelected([]);
                      setTab("runs");
                    }
                  }}
                >
                  Create run ({selected.length}/20)
                </Button>
              </div>
            </div>
            {d.items
              .filter(
                (p: Row) =>
                  vendor === "all" || (p.vendor || "Unassigned") === vendor,
              )
              .map((p: Row) => {
                const key = p.product_id + ":" + p.option_id,
                  index = selected.findIndex(
                    (i) =>
                      i.productId === p.product_id &&
                      i.optionId === p.option_id,
                  );
                return (
                  <article className="panel road-stack" key={key}>
                    <div className="section-title">
                      <div>
                        <h3>
                          {p.name} {p.option_id ? "· " + p.option_label : ""}
                        </h3>
                        <p className="fine">
                          {p.vendor || "Unassigned vendor"} · {p.category}
                        </p>
                      </div>
                      <span className="status">{p.signal}</span>
                    </div>
                    <div className="road-metrics">
                      <div>
                        <span>Available</span>
                        <strong>{p.available}</strong>
                      </div>
                      <div>
                        <span>Daily use</span>
                        <strong>{p.dailyVelocity.toFixed(1)}</strong>
                      </div>
                      <div>
                        <span>Days remaining</span>
                        <strong>
                          {p.daysLeft == null
                            ? "No recent use"
                            : p.daysLeft.toFixed(1)}
                        </strong>
                      </div>
                      <div>
                        <span>Suggested order</span>
                        <strong>{p.suggested}</strong>
                      </div>
                    </div>
                    <p className="fine">
                      {p.stockoutAt ? (
                        <>
                          Estimated stockout{" "}
                          {new Date(p.stockoutAt).toLocaleDateString()} ·{" "}
                        </>
                      ) : null}
                      {p.lead_days} lead days + {p.target_days} target days ·{" "}
                      {p.safety_units} safety units · packs of {p.pack_size}.
                      Margin before tax{" "}
                      {p.margin == null
                        ? "unknown"
                        : Math.round(p.margin * 100) + "%"}{" "}
                      · {p.buyers} repeat buyers in 30 days · rating{" "}
                      {p.rating ?? "not rated"} · {p.waste_units} lost units
                      counted.
                    </p>
                    <details>
                      <summary>Shrink and count history · last 30 days</summary>
                      <p className="fine">
                        Last count{" "}
                        {p.last_count ? date(p.last_count) : "not yet recorded"}
                        . Observed loss share{" "}
                        {p.shrinkRate == null
                          ? "not enough data"
                          : (p.shrinkRate * 100).toFixed(1) + "%"}{" "}
                        of sold plus counted lost units; this is a sample, not a
                        full inventory audit.
                      </p>
                      {p.shrink.map((s: Row) => (
                        <p key={s.kind}>
                          {s.kind} · {s.lost_units} lost / {s.found_units} found
                          · known loss cost {money(s.known_loss_cost)}
                          {s.unknown_cost_lines ? " · some costs unknown" : ""}
                        </p>
                      ))}
                    </details>
                    <CheckField
                      label="Include in next run"
                      checked={index >= 0}
                      onChange={(checked) => {
                        if (checked && selected.length < 20)
                          setSelected([
                            ...selected,
                            {
                              productId: p.product_id,
                              optionId: p.option_id,
                              qty: p.suggested || 1,
                              reason: "",
                            },
                          ]);
                        else if (!checked)
                          setSelected(selected.filter((_, i) => i !== index));
                      }}
                    />
                    {index >= 0 ? (
                      <div className="road-fields">
                        <Field
                          label="Planned quantity"
                          type="number"
                          min={1}
                          max={10000}
                          value={selected[index].qty}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            setSelected(
                              selected.map((x, i) =>
                                i === index
                                  ? { ...x, qty: Number(e.target.value) }
                                  : x,
                              ),
                            )
                          }
                        />
                        {selected[index].qty !== p.suggested ? (
                          <Field
                            label="Reason for overriding suggestion"
                            value={selected[index].reason}
                            onChange={(
                              e: React.ChangeEvent<HTMLInputElement>,
                            ) =>
                              setSelected(
                                selected.map((x, i) =>
                                  i === index
                                    ? { ...x, reason: e.target.value }
                                    : x,
                                ),
                              )
                            }
                          />
                        ) : null}
                      </div>
                    ) : null}
                    <Button
                      variant="secondary"
                      onClick={() => setEdit(edit === key ? "" : key)}
                    >
                      Planning settings
                    </Button>
                    {edit === key ? (
                      <ActionForm
                        key={p.plan_version}
                        title="Reorder inputs"
                        initial={{
                          vendor: p.vendor,
                          packSize: p.pack_size,
                          leadDays: p.lead_days,
                          targetDays: p.target_days,
                          safetyUnits: p.safety_units,
                          reason: "",
                        }}
                        fields={[
                          {
                            key: "vendor",
                            label: "Store / vendor",
                            optional: true,
                          },
                          {
                            key: "packSize",
                            label: "Units per pack",
                            type: "number",
                            min: 1,
                          },
                          {
                            key: "leadDays",
                            label: "Lead time days",
                            type: "number",
                            min: 0,
                          },
                          {
                            key: "targetDays",
                            label: "Target stock days",
                            type: "number",
                            min: 1,
                          },
                          {
                            key: "safetyUnits",
                            label: "Safety units",
                            type: "number",
                            min: 0,
                          },
                          reasonField,
                        ]}
                        busy={a.busy}
                        submit={(v) =>
                          a.send({
                            action: "inventoryPlan",
                            productId: p.product_id,
                            optionId: p.option_id,
                            version: p.plan_version,
                            ...v,
                            packSize: Number(v.packSize),
                            leadDays: Number(v.leadDays),
                            targetDays: Number(v.targetDays),
                            safetyUnits: Number(v.safetyUnits),
                          })
                        }
                      />
                    ) : null}
                  </article>
                );
              })}
            <section className="panel">
              <h3>Member demand</h3>
              <p className="fine">
                Use votes alongside consumption, margin, and waste when choosing
                a trial.
              </p>
              <ul className="road-list">
                {d.requests.map((r: Row, i: number) => (
                  <li key={i}>
                    {r.title} · {r.votes} net votes · {r.status}
                  </li>
                ))}
              </ul>
            </section>
          </>
        ) : tab === "runs" ? (
          <>
            {d.runs.map((run: Row) => (
              <section key={run.id} className="panel road-stack">
                <div className="section-title">
                  <h3>{run.name}</h3>
                  <span className="status">{run.status}</span>
                </div>
                <p className="fine">
                  Created {date(run.created_at)}
                  {run.received_at
                    ? " · received " + date(run.received_at)
                    : ""}
                </p>
                {d.runItems
                  .filter((i: Row) => i.run_id === run.id)
                  .sort((a: Row, b: Row) => a.vendor.localeCompare(b.vendor))
                  .map((i: Row) =>
                    run.status === "shopping" ? (
                      <ActionForm
                        key={i.id + ":" + run.version}
                        title={
                          i.name + " · " + (i.vendor || "Unassigned vendor")
                        }
                        initial={{
                          qty: i.qty,
                          cost: i.total_cost == null ? "" : i.total_cost / 100,
                          checked: !!i.checked,
                          reason: i.override_reason,
                        }}
                        fields={[
                          {
                            key: "qty",
                            label: "Actual units (zero if unavailable)",
                            type: "number",
                            min: 0,
                          },
                          {
                            key: "cost",
                            label: "Total paid for these units ($)",
                            type: "number",
                            min: 0,
                            step: "0.01",
                            optional: true,
                          },
                          {
                            key: "checked",
                            label: "Shopping complete for this item",
                            type: "checkbox",
                          },
                          {
                            key: "reason",
                            label: "Quantity override reason",
                            optional: i.qty === i.suggested_qty,
                          },
                        ]}
                        label="Save item"
                        busy={a.busy}
                        submit={(v) =>
                          a.send({
                            action: "restockEdit",
                            id: run.id,
                            version: run.version,
                            itemId: i.id,
                            qty: Number(v.qty),
                            totalCost: v.cost === "" ? null : cents(v.cost),
                            checked: v.checked,
                            reason: v.reason,
                          })
                        }
                      />
                    ) : (
                      <p key={i.id}>
                        {i.qty} × {i.name} · {money(i.total_cost)} · {i.vendor}
                      </p>
                    ),
                  )}
                {run.status === "shopping" ? (
                  <>
                    <ActionForm
                      title="Receive this run"
                      initial={{ receipt: "" }}
                      fields={[
                        {
                          key: "receipt",
                          label: "Receipt / reference (optional)",
                          optional: true,
                        },
                      ]}
                      label="Receive all checked stock"
                      busy={a.busy}
                      submit={(v) =>
                        a.send({
                          action: "restockReceive",
                          id: run.id,
                          version: run.version,
                          ...v,
                        })
                      }
                    />
                    <ActionForm
                      title="Cancel an unused run"
                      initial={{ reason: "" }}
                      fields={[reasonField]}
                      label="Cancel run"
                      busy={a.busy}
                      submit={(v) =>
                        a.send({
                          action: "restockCancel",
                          id: run.id,
                          version: run.version,
                          ...v,
                        })
                      }
                    />
                  </>
                ) : null}
              </section>
            ))}
            {!d.runs.length ? (
              <p className="notice">Plan your first restock run.</p>
            ) : null}
          </>
        ) : (
          <>
            <Button
              disabled={a.busy}
              onClick={() => a.send({ action: "countCreate", size: 5 })}
            >
              Start a five-item count
            </Button>
            <p className="fine">
              Items are prioritized by value, consumption, loss, and time since
              the last count. Count while the shelf is quiet. If a sale changes
              stock during a count, cancel it and start a fresh count; the site
              will not overwrite that sale.
            </p>
            {d.sessions.map((s: Row) => (
              <CountSession
                key={s.id + ":" + s.version}
                session={s}
                items={d.counts.filter((c: Row) => c.session_id === s.id)}
                action={a}
              />
            ))}
          </>
        )
      ) : null}
    </section>
  );
}
function CountSession({
  session: s,
  items,
  action: a,
}: {
  session: Row;
  items: Row[];
  action: ReturnType<typeof useRoadmap>["action"];
}) {
  const [values, set] = useState<Row[]>(
    items.map((c) => ({
      ...c,
      actual: c.actual ?? "",
      kind: c.kind || "unexplained",
      reason: c.reason || "",
    })),
  );
  return (
    <section className="panel road-stack">
      <h3>Count · {date(s.created_at)}</h3>
      <p className="fine">{s.status}</p>
      {s.status === "open" ? (
        <>
          <form
            className="road-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void a.send({
                action: "countComplete",
                id: s.id,
                version: s.version,
                items: values.map((c) => ({
                  id: c.id,
                  actual: Number(c.actual),
                  kind: c.kind,
                  reason: c.reason,
                })),
              });
            }}
          >
            {values.map((c, index) => (
              <div className="road-item" key={c.id}>
                <h4>{c.name}</h4>
                <p className="fine">
                  Expected {c.expected} · known unit cost {money(c.cost)}
                </p>
                <div className="road-fields">
                  <Field
                    label="Physical count"
                    type="number"
                    min={0}
                    required
                    value={c.actual}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      set(
                        values.map((x, i) =>
                          i === index ? { ...x, actual: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <SelectField
                    label="Variance category"
                    value={c.kind}
                    onChange={(v) =>
                      set(
                        values.map((x, i) =>
                          i === index ? { ...x, kind: v } : x,
                        ),
                      )
                    }
                    options={[
                      "unexplained",
                      "explained",
                      "waste",
                      "damage",
                    ].map((v) => [v, v[0].toUpperCase() + v.slice(1)])}
                  />
                  <Field
                    label="Variance explanation"
                    required={
                      c.actual !== "" && Number(c.actual) !== c.expected
                    }
                    value={c.reason}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      set(
                        values.map((x, i) =>
                          i === index ? { ...x, reason: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </div>
              </div>
            ))}
            <Button type="submit" disabled={a.busy}>
              Confirm counts and record adjustments
            </Button>
          </form>
          <ActionForm
            title="Cancel this count"
            initial={{ reason: "" }}
            fields={[reasonField]}
            label="Cancel count"
            busy={a.busy}
            submit={(v) =>
              a.send({
                action: "countCancel",
                id: s.id,
                version: s.version,
                ...v,
              })
            }
          />
        </>
      ) : (
        items.map((c) => (
          <p key={c.id}>
            {c.name} · {c.expected} expected → {c.actual ?? "—"} counted ·{" "}
            {c.kind || "cancelled"} · {c.reason}
          </p>
        ))
      )}
    </section>
  );
}
export function MonthClose() {
  const now = new Date();
  now.setUTCMonth(now.getUTCMonth() - 1);
  const [month, setMonth] = useState(now.toISOString().slice(0, 7)),
    [checks, setChecks] = useState<Row>({});
  const state = useRoadmap({ kind: "month", month }),
    d = state.data,
    a = state.action;
  const labels: Row = {
    payments: "Pending payments resolved",
    balances: "Outstanding tabs and credits reviewed",
    counts: "Physical sample counts reviewed",
    shrink: "Shrink and waste reviewed",
    cash: "Cash on hand counted",
    cashapp: "Cash App receipts reconciled",
    adjustments: "Refunds and corrections reviewed",
  };
  return (
    <section className="road-stack">
      <h2>Close the month</h2>
      <Field
        label="Accounting month (UTC)"
        type="month"
        value={month}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          setMonth(e.target.value);
          setChecks({});
        }}
      />
      <RoadmapStatus state={state} />
      {d ? (
        <>
          <div className="panel road-stack">
            <span className="status">{d.period.status}</span>
            <p className="fine">{d.reportBasis}</p>
            <div className="road-metrics">
              <div>
                <span>Net sales</span>
                <strong>{money(d.sales.total)}</strong>
              </div>
              <div>
                <span>Known cost</span>
                <strong>{money(d.sales.known_cost)}</strong>
              </div>
              <div>
                <span>Pending payments</span>
                <strong>{d.pending}</strong>
              </div>
              <div>
                <span>Counted loss</span>
                <strong>{d.counts.lost_units} units</strong>
              </div>
            </div>
            <p className="fine">
              {d.sales.unknown_cost_orders || 0} sales have unknown cost.{" "}
              {d.counts.unknown_loss_cost || 0} loss lines have unknown cost.
              Known loss value {money(d.counts.known_loss_cost)}.
            </p>
            <p>
              Current tabs {money(d.balances.debt)} · current confirmed credit{" "}
              {money(d.balances.credit)}
            </p>
            <h3>Payments</h3>
            {d.payments.map((p: Row) => (
              <p key={p.method + p.status}>
                {p.method} · {p.status}: {money(p.amount)} ({p.count})
              </p>
            ))}
            <h3>Expenses</h3>
            {d.expenses.map((p: Row) => (
              <p key={p.kind}>
                {p.kind}: {money(p.amount)}
              </p>
            ))}
            <p>
              Corrections {money(d.adjustments.total)} · external refunds{" "}
              {money(d.adjustments.refunds)} · returned credit{" "}
              {money(d.adjustments.credits)}
            </p>
          </div>
          {d.period.status === "open" ? (
            <div className="panel road-stack">
              {Object.entries(labels).map(([key, label]) => (
                <CheckField
                  key={key}
                  label={String(label)}
                  checked={!!checks[key]}
                  onChange={(v) => setChecks({ ...checks, [key]: v })}
                />
              ))}
              <ActionForm
                key={month + ":" + d.period.version}
                title="Record reconciliation and lock"
                initial={{ cash: "", cashappReference: "", reason: "" }}
                fields={[
                  {
                    key: "cash",
                    label: "Actual cash on hand ($)",
                    type: "number",
                    min: 0,
                    step: "0.01",
                  },
                  {
                    key: "cashappReference",
                    label: "Cash App reconciliation reference / note",
                  },
                  reasonField,
                ]}
                label="Close month and save immutable report"
                busy={a.busy || !!d.pending}
                submit={(v) =>
                  a.send({
                    action: "monthClose",
                    month,
                    version: d.period.version,
                    revision: d.revision,
                    checklist: checks,
                    cashOnHand: cents(v.cash),
                    cashappReference: v.cashappReference,
                    reason: v.reason,
                  })
                }
              />
            </div>
          ) : (
            <section className="panel road-stack">
              <h3>Saved report</h3>
              <p>
                This snapshot is preserved when a month is reopened and closed
                again.
              </p>
              {d.closedSnapshot ? (
                <>
                  <p>
                    Closed {date(d.closedSnapshot.created_at)} · counted cash{" "}
                    {money(d.closedSnapshot.cash_on_hand)}
                  </p>
                  <p>{d.closedSnapshot.note}</p>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const blob = new Blob(
                          [
                            JSON.stringify(
                              {
                                ...d.closedSnapshot,
                                report: JSON.parse(d.closedSnapshot.report),
                                checklist: JSON.parse(
                                  d.closedSnapshot.checklist,
                                ),
                              },
                              null,
                              2,
                            ),
                          ],
                          { type: "application/json" },
                        ),
                        url = URL.createObjectURL(blob),
                        a = document.createElement("a");
                      a.href = url;
                      a.download = "IYAAYASFW-" + month + "-closed.json";
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    Download closed report
                  </Button>
                </>
              ) : null}
              <ActionForm
                title="Controlled reopening"
                initial={{ reason: "" }}
                fields={[reasonField]}
                label="Reopen month"
                busy={a.busy}
                submit={(v) =>
                  a.send({
                    action: "monthReopen",
                    month,
                    version: d.period.version,
                    ...v,
                  })
                }
              />
            </section>
          )}
          <section className="panel">
            <h3>Period history</h3>
            {d.events.map((e: Row) => (
              <p className="fine" key={e.id}>
                {date(e.created_at)} · {e.kind} · {e.reason}
              </p>
            ))}
          </section>
        </>
      ) : null}
    </section>
  );
}
