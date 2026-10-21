"use client";
import { useEffect, useState } from "react";
import { secureFetch } from "@/lib/identity/client";
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
import { estimateRun } from "@/lib/pilot/purchase-math";
import InventoryAutopilot from "./inventory-autopilot";

export default function RestockWorkspace({
  memberId,
  initialProduct,
}: {
  memberId: string;
  initialProduct?: string;
}) {
  const [tab, setTab] = useState("plan"),
    [run, setRun] = useState("");
  useEffect(() => {
    const id = new URL(location.href).searchParams.get("run");
    if (id) {
      setRun(id);
      setTab("run");
    }
  }, []);
  const open = (id: string) => {
    setRun(id);
    setTab("run");
    const url = new URL(location.href);
    url.searchParams.set("run", id);
    history.replaceState(null, "", url);
  };
  return (
    <section className="wf-stack">
      <div>
        <h2>Restock</h2>
        <p className="fine">
          Plan the trip, record what you buy, then put it on the shelf.
        </p>
      </div>
      <nav className="wf-toolbar" aria-label="Restock sections">
        {[
          ["plan", "Plan a run"],
          ["history", "Runs & receipts"],
          ["counts", "Stock counts"],
        ].map(([id, label]) => (
          <Button
            key={id}
            variant={tab === id ? "default" : "secondary"}
            onClick={() => setTab(id)}
          >
            {label}
          </Button>
        ))}
        {run && (
          <Button
            variant={tab === "run" ? "default" : "secondary"}
            onClick={() => setTab("run")}
          >
            Open run
          </Button>
        )}
      </nav>
      {tab === "plan" ? (
        <Plan memberId={memberId} initialProduct={initialProduct} open={open} />
      ) : tab === "run" ? (
        <Run key={run} id={run} memberId={memberId} />
      ) : tab === "history" ? (
        <Runs memberId={memberId} open={open} />
      ) : (
        <InventoryAutopilot initialTab="counts" />
      )}
    </section>
  );
}
function Estimate({ estimate }: { estimate: Row }) {
  return (
    <div className="wf-row" aria-live="polite">
      <strong>
        {estimate.total === null
          ? "Known merchandise subtotal: " + money(estimate.knownSubtotal)
          : "Estimated purchase: " + money(estimate.total)}
      </strong>
      <span>{estimate.units} individual units · selected quantities only</span>
      {estimate.items - estimate.priced > 0 && (
        <span>
          {estimate.items - estimate.priced} item(s) need a matching pack price.
          A complete total is unavailable.
        </span>
      )}
      {estimate.stale > 0 && (
        <span>
          {estimate.stale} price(s) are older than the freshness threshold.
          Recheck before buying.
        </span>
      )}
      {estimate.charges === null && (
        <span>Before tax, delivery and other shared charges.</span>
      )}
    </div>
  );
}
function Plan({
  memberId,
  initialProduct,
  open,
}: {
  memberId: string;
  initialProduct?: string;
  open: (id: string) => void;
}) {
  const state = useWorkflow("view=catalog", memberId + ":plan"),
    d = state.data;
  const [draft, setDraft, clear] = useDraft<Row>(memberId + ":plan", {
      name: "Restock run",
      items: {},
      charges: "",
      discount: "0",
    }),
    [search, setSearch] = useState(""),
    [supplier, setSupplier] = useState("");
  const set = (key: string, value: unknown) =>
    setDraft((x) => ({ ...x, [key]: value }));
  const pick = (p: Row, on: boolean) => {
    const k = p.product_id + ":" + p.option_id,
      o = p.purchaseOptions[0];
    setDraft((x) => {
      const items = { ...x.items };
      if (on)
        items[k] = {
          productId: p.product_id,
          variantId: p.option_id,
          purchaseOptionId: o?.id || "",
          packs: String(
            Math.max(
              1,
              Math.ceil(
                (p.suggested || 1) / (o?.units_per_pack || p.pack_size || 1),
              ),
            ),
          ),
          unitsPerPack: String(o?.units_per_pack || p.pack_size || 1),
          packPrice: o?.pack_price == null ? "" : String(o.pack_price / 100),
          supplier: o?.supplier || p.vendor || "",
          priceAt: o?.price_at || null,
          priceKind: o?.price_kind || "missing",
        };
      else delete items[k];
      return { ...x, items };
    });
  };
  const update = (key: string, values: Row) =>
    setDraft((x) => ({
      ...x,
      items: { ...x.items, [key]: { ...x.items[key], ...values } },
    }));
  const selected = Object.values(draft.items) as Row[],
    estimate = estimateRun(
      selected.map((x) => ({
        state: "needed",
        planned_packs: Number(x.packs),
        planned_pack_units: Number(x.unitsPerPack),
        planned_pack_price: cents(x.packPrice),
        price_at: x.priceAt,
      })) as any,
      cents(draft.charges),
      cents(draft.discount) || 0,
      d?.settings.price_fresh_days || 30,
    );
  const items =
    d?.items.filter(
      (p: Row) =>
        (!initialProduct || p.product_id === initialProduct) &&
        (p.name + " " + p.variant_label)
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (!supplier ||
          p.purchaseOptions.some((o: Row) => o.supplier === supplier) ||
          p.vendor === supplier),
    ) || [];
  return (
    <>
      <WorkflowStatus state={state} />
      {d && <ForecastSettings state={state} settings={d.settings} />}
      <div className="panel wf-stack">
        <div className="wf-fields">
          <Field
            label="Run name"
            value={draft.name}
            onChange={(e: any) => set("name", e.target.value)}
          />
          <Field
            label="Find an item"
            value={search}
            onChange={(e: any) => setSearch(e.target.value)}
          />
          <Select
            label="Supplier"
            value={supplier}
            onChange={setSupplier}
            options={[
              ["", "All suppliers"],
              ...Array.from(
                new Set<string>(
                  d?.items
                    .flatMap((p: Row) =>
                      p.purchaseOptions.map((o: Row) => o.supplier),
                    )
                    .filter(Boolean) || [],
                ),
              ).map((s): [string, string] => [s, s]),
            ]}
          />
        </div>
        <p className="fine">
          Suggestions use available stock, incoming purchases, and recorded
          demand. Choose the packs you actually intend to buy.
        </p>
        <div className="wf-list">
          {items.map((p: Row) => {
            const k = p.product_id + ":" + p.option_id,
              x = draft.items[k];
            return (
              <article key={k} className="wf-row">
                <div className="wf-row-head">
                  <div>
                    <h3>
                      {p.name}
                      {p.variant_label ? " · " + p.variant_label : ""}
                    </h3>
                    <p>
                      {p.stock} on hand · {p.available} available · {p.incoming}{" "}
                      incoming
                    </p>
                    <small>
                      {p.suggested} units suggested · {p.demandBasis}
                    </small>
                  </div>
                  <Check
                    label="Add to run"
                    checked={!!x}
                    onChange={(v) => pick(p, v)}
                  />
                </div>
                {x && (
                  <>
                    <Select
                      label="Purchase option"
                      value={x.purchaseOptionId}
                      onChange={(id) => {
                        const o = p.purchaseOptions.find(
                          (o: Row) => o.id === id,
                        );
                        update(
                          k,
                          o
                            ? {
                                purchaseOptionId: id,
                                unitsPerPack: String(o.units_per_pack),
                                packPrice:
                                  o.pack_price == null
                                    ? ""
                                    : String(o.pack_price / 100),
                                supplier: o.supplier,
                                priceAt: o.price_at,
                                priceKind: o.price_kind,
                              }
                            : {
                                purchaseOptionId: "",
                                packPrice: "",
                                priceAt: null,
                                priceKind: "missing",
                              },
                        );
                      }}
                      options={[
                        ["", "Enter a quote"],
                        ...p.purchaseOptions.map((o: Row) => [
                          o.id,
                          `${o.supplier} · ${o.units_per_pack} units · ${money(o.pack_price)}`,
                        ]),
                      ]}
                    />
                    <div className="wf-fields">
                      <NumberField
                        label="Packs"
                        value={x.packs}
                        min={1}
                        step="1"
                        set={(v) => update(k, { packs: v })}
                      />
                      <NumberField
                        label="Units per pack"
                        value={x.unitsPerPack}
                        min={1}
                        step="1"
                        set={(v) =>
                          update(k, {
                            unitsPerPack: v,
                            packPrice: "",
                            priceAt: null,
                            priceKind: "missing",
                          })
                        }
                      />
                      <NumberField
                        label="Price per pack ($)"
                        value={x.packPrice}
                        set={(v) =>
                          update(k, {
                            packPrice: v,
                            priceAt: Date.now(),
                            priceKind: "quote",
                          })
                        }
                      />
                      <Field
                        label="Supplier"
                        value={x.supplier}
                        onChange={(e: any) =>
                          update(k, {
                            supplier: e.target.value,
                            packPrice: "",
                            priceAt: null,
                            priceKind: "missing",
                          })
                        }
                      />
                    </div>
                    <small>
                      {x.priceKind === "missing"
                        ? "Price needed"
                        : x.priceKind + " · " + date(x.priceAt)}{" "}
                      · {Number(x.packs) * Number(x.unitsPerPack)} units
                    </small>
                  </>
                )}
              </article>
            );
          })}
        </div>
        {d && !items.length && <p>No matching stocked items.</p>}
        <details>
          <summary>Estimated shared charges and discount</summary>
          <div className="wf-fields">
            <NumberField
              label="Tax / delivery / fees ($, blank if unknown)"
              value={draft.charges}
              set={(v) => set("charges", v)}
            />
            <NumberField
              label="Shared discount ($)"
              value={draft.discount}
              set={(v) => set("discount", v)}
            />
          </div>
        </details>
        <Estimate estimate={estimate} />
        <div className="wf-sticky wf-toolbar">
          <strong>{selected.length} selected</strong>
          <Button
            disabled={state.busy || !!state.pending || !selected.length}
            onClick={async () => {
              const r = await state.send({
                action: "runCreate",
                name: draft.name,
                charges: cents(draft.charges),
                discount: cents(draft.discount) || 0,
                items: selected.map((x) => ({
                  ...x,
                  packs: Number(x.packs),
                  unitsPerPack: Number(x.unitsPerPack),
                  packPrice:
                    x.priceKind === "quote" ? cents(x.packPrice) : undefined,
                })),
              });
              if (r) {
                clear();
                open(r.id);
              }
            }}
          >
            Save plan
          </Button>
          <span className="fine">Draft saved in this tab.</span>
        </div>
      </div>
    </>
  );
}
function Runs({
  memberId,
  open,
}: {
  memberId: string;
  open: (id: string) => void;
}) {
  const [filter, setFilter] = useState({
      search: "",
      status: "",
      from: "",
      to: "",
    }),
    [cursor, setCursor] = useState(""),
    [prior, setPrior] = useState<Row[]>([]),
    state = useWorkflow(
      "view=runs&" + new URLSearchParams({ ...filter, cursor }),
      memberId + ":history",
    );
  const update = (key: string, v: string) => {
    setFilter((x) => ({ ...x, [key]: v }));
    setCursor("");
    setPrior([]);
  };
  return (
    <div className="panel wf-stack">
      <h3>Runs & receipts</h3>
      <div className="wf-fields">
        <Field
          label="Find name or supplier"
          value={filter.search}
          onChange={(e: any) => update("search", e.target.value)}
        />
        <Select
          label="Status"
          value={filter.status}
          onChange={(v) => update("status", v)}
          options={[
            ["", "All stages"],
            ...[
              "planning",
              "shopping",
              "purchased",
              "completed",
              "cancelled",
            ].map((v): [string, string] => [v, v]),
          ]}
        />
        <Field
          label="From (UTC)"
          type="date"
          value={filter.from}
          onChange={(e: any) => update("from", e.target.value)}
        />
        <Field
          label="Through (UTC)"
          type="date"
          value={filter.to}
          onChange={(e: any) => update("to", e.target.value)}
        />
      </div>
      <WorkflowStatus state={state} />
      <div className="wf-list">
        {[...prior, ...(state.data?.records || [])].map((r: Row) => (
          <button
            type="button"
            className="wf-row"
            key={r.id}
            onClick={() => open(r.id)}
          >
            <strong>{r.name}</strong>
            <span>
              {r.stage} · {date(r.created_at)} · {money(r.total)}
            </span>
            <small>
              {r.suppliers || "Supplier not recorded"}
              {r.legacy ? " · historical run" : ""}
            </small>
          </button>
        ))}
      </div>
      {state.data?.nextCursor && (
        <Button
          variant="secondary"
          onClick={() => {
            setPrior((x) => [...x, ...state.data!.records]);
            setCursor(state.data!.nextCursor);
          }}
        >
          Load older runs
        </Button>
      )}
      <a
        href={
          "/api/export?dataset=restockRuns&" +
          new URLSearchParams({ from: filter.from, to: filter.to })
        }
      >
        Export all matching runs
      </a>
      <a
        href={
          "/api/export?dataset=receipts&" +
          new URLSearchParams({ from: filter.from, to: filter.to })
        }
      >
        Export receipt lines for these dates
      </a>
      <a
        href={
          "/api/export?dataset=runItems&" +
          new URLSearchParams({ from: filter.from, to: filter.to })
        }
      >
        Export complete planned and actual run items
      </a>
    </div>
  );
}
function Run({ id, memberId }: { id: string; memberId: string }) {
  const state = useWorkflow(
      "view=run&id=" + encodeURIComponent(id),
      memberId + ":run:" + id,
    ),
    d = state.data,
    [add, setAdd] = useState(false),
    catalog = useWorkflow("view=catalog", memberId + ":catalog"),
    moneyState = useWorkflow("view=money", memberId + ":restock-funds"),
    [addId, setAddId] = useState("");
  if (!d)
    return (
      <>
        <WorkflowStatus state={state} />
        <p>Loading run…</p>
      </>
    );
  const r = d.run,
    open = !["completed", "cancelled"].includes(r.stage),
    funds = moneyState.data,
    remaining = (l: Row) =>
      l.qty -
      l.received_qty -
      (d.corrections || [])
        .filter((c: Row) => c.purchase_line_id === l.id)
        .reduce((n: number, c: Row) => n + c.qty - c.stock_qty, 0);
  return (
    <div className="wf-stack">
      <WorkflowStatus state={state} />
      <div className="panel wf-stack">
        <div className="wf-row-head">
          <div>
            <h3>{r.name}</h3>
            <span className="wf-badge">{r.stage}</span>
          </div>
          <Button variant="ghost" onClick={() => state.load()}>
            Refresh run
          </Button>
        </div>
        {r.legacy ? (
          <p>
            This is a historical run. Its original quantities and costs remain
            unchanged. Pack details were not recorded.
          </p>
        ) : (
          <>
            {d.estimate && <Estimate estimate={d.estimate} />}
            <div className="wf-toolbar">
              {r.stage === "planning" && (
                <Button
                  disabled={state.busy || !!state.pending}
                  onClick={() =>
                    state.send({ action: "runStart", id, version: r.version })
                  }
                >
                  Start shopping
                </Button>
              )}
              {open && (
                <>
                  <Button variant="secondary" onClick={() => setAdd(!add)}>
                    Add an item
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={moneyState.busy}
                    onClick={() =>
                      moneyState.send({
                        action: "moneySelectRun",
                        runId: id,
                        version: funds?.settings.version,
                        freshDays: funds?.settings.price_fresh_days,
                      })
                    }
                  >
                    Use for funds forecast
                  </Button>
                </>
              )}
              {!d.receipts.length && open && (
                <details>
                  <summary>Cancel this run</summary>
                  <p>Cancel the plan without changing stock or funds.</p>
                  <Button
                    variant="secondary"
                    disabled={state.busy}
                    onClick={() =>
                      state.send({
                        action: "runCancel",
                        id,
                        version: r.version,
                      })
                    }
                  >
                    Confirm cancellation
                  </Button>
                </details>
              )}
              <Button
                variant="secondary"
                disabled={state.busy || !!state.pending}
                onClick={async () => {
                  const result = await state.send({
                    action: "runRepeat",
                    id,
                    name: r.name + " · repeat",
                  });
                  if (result) {
                    const u = new URL(location.href);
                    u.searchParams.set("run", result.id);
                    location.assign(u.pathname + u.search);
                  }
                }}
              >
                Repeat with current prices
              </Button>
            </div>
            <WorkflowStatus state={moneyState} />
            {funds?.settings.selected_run === id && (
              <p className="fine">
                Selected funds forecast:{" "}
                {funds.projected == null
                  ? "Incomplete — check balances and remaining prices/fees."
                  : money(funds.projected) +
                    " after this run and recorded commitments."}
              </p>
            )}
            {add && (
              <div className="wf-row">
                <Select
                  label="Add a stocked product / option"
                  value={addId}
                  onChange={setAddId}
                  options={[
                    ["", "Choose an item"],
                    ...(catalog.data?.items || [])
                      .filter(
                        (p: Row) =>
                          !d.lines.some(
                            (l: Row) =>
                              l.product_id === p.product_id &&
                              l.option_id === p.option_id,
                          ),
                      )
                      .map((p: Row) => [
                        p.product_id + ":" + p.option_id,
                        p.name + " " + (p.variant_label || ""),
                      ]),
                  ]}
                />
                <Button
                  disabled={!addId || state.busy}
                  onClick={async () => {
                    const p = catalog.data?.items.find(
                      (p: Row) => p.product_id + ":" + p.option_id === addId,
                    );
                    if (
                      p &&
                      (await state.send({
                        action: "runSave",
                        id,
                        version: r.version,
                        add: {
                          productId: p.product_id,
                          variantId: p.option_id,
                        },
                      }))
                    ) {
                      setAdd(false);
                      setAddId("");
                    }
                  }}
                >
                  Add to saved run
                </Button>
              </div>
            )}
          </>
        )}
        {!r.legacy && open && (
          <RunCharges key={r.version} run={r} state={state} scope={memberId} />
        )}
        <div className="wf-list">
          {d.lines.map((l: Row) =>
            r.legacy ? (
              <div className="wf-row" key={l.id}>
                <strong>{l.name}</strong>
                <span>
                  {l.qty} units · {money(l.total_cost)}
                </span>
              </div>
            ) : (
              <RunLine
                key={l.id + ":" + r.version}
                line={l}
                run={r}
                state={state}
                scope={memberId}
              />
            ),
          )}
        </div>
        {!r.legacy &&
          ["shopping", "purchased"].includes(r.stage) &&
          d.lines.some((l: Row) => l.state === "grabbed") && (
            <Purchase
              key={r.version}
              d={d}
              state={state}
              accounts={funds?.accounts || []}
              scope={memberId}
            />
          )}
      </div>
      {d.receipts.map((receipt: Row) => (
        <article className="panel wf-stack" key={receipt.id}>
          <h3>Receipt · {receipt.reference}</h3>
          <p>
            {receipt.supplier} · {date(receipt.purchased_at)} ·{" "}
            {money(receipt.total)} ·{" "}
            {receipt.funding === "personal"
              ? "Personal purchase · " + receipt.purchaser
              : funds?.accounts.find((a: Row) => a.id === receipt.account_id)
                  ?.name || receipt.account_id}
          </p>
          {receipt.image && (
            <a href={receipt.image} target="_blank" rel="noreferrer">
              View receipt image
            </a>
          )}
          <div className="wf-list">
            {d.purchaseLines
              .filter((l: Row) => l.receipt_id === receipt.id)
              .map((l: Row) => (
                <ReceiptLine
                  key={l.id + ":" + l.version}
                  line={l}
                  remaining={remaining(l)}
                  receipt={receipt}
                  state={state}
                  accounts={funds?.accounts || []}
                  scope={memberId}
                />
              ))}
          </div>
        </article>
      ))}
      {d.corrections?.length > 0 && (
        <details>
          <summary>Receipt corrections ({d.corrections.length})</summary>
          {d.corrections.map((c: Row) => (
            <p key={c.id}>
              {date(c.created_at)} · {c.kind}: {c.qty} units, {c.stock_qty}{" "}
              removed from stock · {money(c.refund)} refund · {c.reason}
            </p>
          ))}
        </details>
      )}
    </div>
  );
}
function RunLine({
  line: l,
  run: r,
  state,
  scope,
}: {
  line: Row;
  run: Row;
  state: ReturnType<typeof useWorkflow>;
  scope: string;
}) {
  const initial = {
      dirty: false,
      version: r.version,
      packs: String(l.actual_packs ?? l.planned_packs),
      units: String(l.actual_pack_units ?? l.planned_pack_units),
      price:
        (l.actual_pack_price ?? l.planned_pack_price) == null
          ? ""
          : String((l.actual_pack_price ?? l.planned_pack_price) / 100),
      discount: String(l.line_discount / 100),
      note: l.note || "",
      state: l.state,
    },
    [x, setX, clear] = useDraft(scope + ":line:" + l.id, initial);
  useEffect(() => {
    if (x.version !== r.version && !x.dirty) setX(initial);
  }, [r.version, x.version, x.dirty]);
  const set = (key: string, v: string) =>
      setX((d) => ({ ...d, [key]: v, dirty: true })),
    closed =
      ["completed", "cancelled"].includes(r.stage) || l.state === "purchased";
  return (
    <article className="wf-row">
      <div className="wf-row-head">
        <div>
          <h3>
            {l.name}
            {l.variant_label ? " · " + l.variant_label : ""}
          </h3>
          <p>
            {l.supplier || "Supplier not specified"} · {l.planned_packs} ×{" "}
            {l.planned_pack_units} planned units
          </p>
          <small>
            {l.price_kind} ·{" "}
            {l.price_at ? date(l.price_at) : "Price date missing"}
          </small>
        </div>
        <span className="wf-badge">
          {l.state === "needed" ? "Still needed" : l.state}
        </span>
      </div>
      {closed ? (
        <p>
          {l.actual_packs || l.planned_packs} packs ×{" "}
          {l.actual_pack_units || l.planned_pack_units} units
        </p>
      ) : (
        <details open={r.stage === "shopping" && l.state === "needed"}>
          <summary>Edit quantity, price or status</summary>
          <form
            className="wf-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await state.send({
                action: "runSave",
                id: r.id,
                version: x.version,
                lines: [
                  {
                    id: l.id,
                    packs: Number(x.packs),
                    unitsPerPack: Number(x.units),
                    packPrice: cents(x.price),
                    discount: cents(x.discount) || 0,
                    state: x.state,
                    note: x.note,
                  },
                ],
              });
              if (result) clear();
            }}
          >
            <fieldset disabled={state.busy || !!state.pending}>
              {x.version !== r.version && (
                <p className="notice warning">
                  The saved run changed. Review the current values above.{" "}
                  <button type="button" onClick={() => setX(initial)}>
                    Use current saved values
                  </button>
                </p>
              )}
              <div className="wf-fields">
                <NumberField
                  label="Packs"
                  value={x.packs}
                  min={1}
                  step="1"
                  set={(v) => set("packs", v)}
                />
                <NumberField
                  label="Units per pack"
                  value={x.units}
                  min={1}
                  step="1"
                  set={(v) => {
                    setX((d) => ({ ...d, units: v, price: "", dirty: true }));
                  }}
                />
                <NumberField
                  label="Actual price per pack ($)"
                  value={x.price}
                  set={(v) => set("price", v)}
                />
                <NumberField
                  label="Line discount ($)"
                  value={x.discount}
                  set={(v) => set("discount", v)}
                />
              </div>
              <p>
                {Number(x.packs) * Number(x.units)} units ·{" "}
                {cents(x.price) === null
                  ? "Price needed"
                  : money(
                      Number(x.packs) * (cents(x.price) || 0) -
                        (cents(x.discount) || 0),
                    )}{" "}
                before shared charges
              </p>
              <Select
                label="Item status"
                value={x.state}
                onChange={(v) => set("state", v)}
                options={[
                  ["needed", "Still needed"],
                  ...(r.stage !== "planning"
                    ? [["grabbed", "Grabbed"] as [string, string]]
                    : []),
                  ["skipped", "Skip"],
                ]}
              />
              <Field
                label="Change / substitution note"
                value={x.note}
                onChange={(e: any) => set("note", e.target.value)}
              />
              <Button type="submit" disabled={x.version !== r.version}>
                Save item
              </Button>
            </fieldset>
          </form>
        </details>
      )}
    </article>
  );
}
function Purchase({
  d,
  state,
  accounts,
  scope,
}: {
  d: Row;
  state: ReturnType<typeof useWorkflow>;
  accounts: Row[];
  scope: string;
}) {
  const r = d.run,
    [x, setX, clear] = useDraft<Row>(scope + ":receipt:" + r.id, {
      version: r.version,
      selected: d.lines
        .filter((l: Row) => l.state === "grabbed")
        .map((l: Row) => l.id),
      supplier: "",
      reference: "",
      date: localTime(),
      charges: "0",
      discount: "0",
      total: "",
      funding: "activity",
      account: "",
      purchaser: "",
      checked: false,
      receive: true,
      defaults: false,
      image: "",
    }),
    [uploading, setUploading] = useState(false);
  const set = (key: string, v: unknown) =>
    setX((o) => ({ ...o, [key]: v, checked: key === "checked" ? v : false }));
  const lines = d.lines.filter(
      (l: Row) => x.selected.includes(l.id) && l.state === "grabbed",
    ),
    merchandise = lines.reduce(
      (n: number, l: Row) =>
        n + l.actual_packs * l.actual_pack_price - l.line_discount,
      0,
    ),
    total = merchandise + (cents(x.charges) || 0) - (cents(x.discount) || 0);
  return (
    <details className="wf-row">
      <summary>
        <strong>Finish purchase · record a receipt</strong>
      </summary>
      <form
        className="wf-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const result = await state.send({
            action: "runPurchase",
            id: r.id,
            version: x.version,
            lineIds: lines.map((l: Row) => l.id),
            supplier: x.supplier,
            reference: x.reference,
            purchasedAt: Date.parse(x.date),
            charges: cents(x.charges),
            discount: cents(x.discount) || 0,
            total: cents(x.total),
            funding: x.funding,
            account: x.account,
            purchaser: x.purchaser,
            chargesValidated: x.checked,
            confirmed: true,
            receiveNow: x.receive,
            updateDefaults: x.defaults,
            image: x.image,
          });
          if (result) clear();
        }}
      >
        <fieldset disabled={state.busy || !!state.pending || uploading}>
          {x.version !== r.version && (
            <div className="notice warning">
              The run changed. Recheck quantities and shared charges.{" "}
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setX((v) => ({
                    ...v,
                    version: r.version,
                    selected: d.lines
                      .filter((l: Row) => l.state === "grabbed")
                      .map((l: Row) => l.id),
                    checked: false,
                  }))
                }
              >
                Review this version
              </Button>
            </div>
          )}
          <p>
            Choose only the items on this receipt. Other items stay on the run.
          </p>
          {d.lines
            .filter((l: Row) => l.state === "grabbed")
            .map((l: Row) => (
              <Check
                key={l.id}
                label={
                  l.name +
                  " · " +
                  l.actual_packs +
                  " packs · " +
                  money(l.actual_packs * l.actual_pack_price - l.line_discount)
                }
                checked={x.selected.includes(l.id)}
                onChange={(v) =>
                  set(
                    "selected",
                    v
                      ? [...x.selected, l.id]
                      : x.selected.filter((id: string) => id !== l.id),
                  )
                }
              />
            ))}
          <div className="wf-fields">
            <Field
              label="Supplier"
              required
              value={x.supplier}
              onChange={(e: any) => set("supplier", e.target.value)}
            />
            <Field
              label="Receipt reference"
              required
              value={x.reference}
              onChange={(e: any) => set("reference", e.target.value)}
            />
            <Field
              label="Purchased at (local time)"
              type="datetime-local"
              required
              value={x.date}
              onChange={(e: any) => set("date", e.target.value)}
            />
            <NumberField
              label="Shared tax / delivery / fees ($)"
              value={x.charges}
              set={(v) => set("charges", v)}
            />
            <NumberField
              label="Shared discount ($)"
              value={x.discount}
              set={(v) => set("discount", v)}
            />
            <NumberField
              label="Total on receipt ($)"
              value={x.total}
              set={(v) => set("total", v)}
            />
          </div>
          <p>
            <strong>{money(total)}</strong> calculated · {money(merchandise)}{" "}
            merchandise.{" "}
            {cents(x.total) === total
              ? "Receipt reconciles."
              : "Enter a matching receipt total or correct its prices and charges."}
          </p>
          <Select
            label="Paid with"
            value={x.funding}
            onChange={(v) => set("funding", v)}
            options={[
              ["activity", "Activity funds"],
              ["personal", "Personal funds · reimbursement exception"],
            ]}
          />
          {x.funding === "activity" ? (
            <Select
              label="Activity account used"
              required
              value={x.account}
              onChange={(v) => set("account", v)}
              options={[
                ["", "Choose the actual account"],
                ...accounts.filter((a) => a.active).map((a) => [a.id, a.name]),
              ]}
            />
          ) : (
            <Field
              label="Person to reimburse"
              required
              value={x.purchaser}
              onChange={(e: any) => set("purchaser", e.target.value)}
            />
          )}
          <Field label="Receipt image (optional)">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setUploading(true);
                try {
                  const body = new FormData();
                  body.append("image", f);
                  const res = await secureFetch("/api/product-images", {
                      method: "POST",
                      body,
                    }),
                    j = (await res.json()) as Row;
                  if (!res.ok) throw Error(j.error);
                  set("image", j.image);
                } catch (error) {
                  state.setError((error as Error).message);
                } finally {
                  setUploading(false);
                }
              }}
            />
          </Field>
          {x.image && <p>Receipt image attached.</p>}
          <Check
            label="I rechecked the shared charges and discounts for these quantities."
            checked={x.checked}
            onChange={(v) => set("checked", v)}
          />
          <Check
            label="Put all purchased units on the shelf now"
            checked={x.receive}
            onChange={(v) => setX((o) => ({ ...o, receive: v }))}
          />
          <p className="fine">
            Leave unchecked to record the purchase now and receive stock later.
            Funds are recorded once.
          </p>
          <Check
            label="Save these matching pack prices for future purchases"
            checked={x.defaults}
            onChange={(v) => setX((o) => ({ ...o, defaults: v }))}
          />
          <Button
            type="submit"
            disabled={
              !x.checked ||
              x.version !== r.version ||
              !lines.length ||
              cents(x.total) !== total
            }
          >
            {x.receive
              ? "Finish purchase & stock"
              : "Record purchase · stock later"}
          </Button>
        </fieldset>
      </form>
    </details>
  );
}
function ReceiptLine({
  line: l,
  remaining,
  receipt,
  state,
  accounts,
  scope,
}: {
  line: Row;
  remaining: number;
  receipt: Row;
  state: ReturnType<typeof useWorkflow>;
  accounts: Row[];
  scope: string;
}) {
  const [qty, setQty] = useState(String(remaining)),
    [fix, setFix] = useDraft<Row>(scope + ":correction:" + l.id, {
      kind: "return",
      qty: "1",
      stock: "0",
      refund: "0",
      account: "",
      reason: "",
    }),
    set = (key: string, value: string) =>
      setFix((x) => ({ ...x, [key]: value }));
  return (
    <div className="wf-row">
      <h4>
        {l.product_name} {l.variant_label}
      </h4>
      <p>
        {l.packs} × {l.units_per_pack} units · {money(l.pack_price)} per pack ·{" "}
        {money(l.total_cost)} total
      </p>
      <small>
        {(l.total_cost / l.qty / 100).toFixed(4)} USD per unit before inventory
        rounding · {l.received_qty} received · {Math.max(0, remaining)} still
        incoming
      </small>
      {remaining > 0 && (
        <form
          className="wf-toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            void state.send({
              action: "purchaseReceive",
              receiptId: receipt.id,
              lines: [{ id: l.id, version: l.version, qty: Number(qty) }],
            });
          }}
        >
          <NumberField
            label="Units to stock now"
            min={1}
            step="1"
            value={qty}
            set={setQty}
          />
          <Button disabled={state.busy || !!state.pending} type="submit">
            Add to stock
          </Button>
        </form>
      )}
      <details>
        <summary>Return or damaged goods</summary>
        <form
          className="wf-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void state.send({
              action: "purchaseCorrect",
              lineId: l.id,
              version: l.version,
              kind: fix.kind,
              qty: Number(fix.qty),
              stockQty: Number(fix.stock),
              refund: cents(fix.refund) || 0,
              account: fix.account,
              reason: fix.reason,
            });
          }}
        >
          <Select
            label="Correction"
            value={fix.kind}
            onChange={(v) => set("kind", v)}
            options={[
              ["return", "Return to supplier"],
              ["damage", "Damaged goods"],
            ]}
          />
          <div className="wf-fields">
            <NumberField
              label="Affected units"
              min={1}
              step="1"
              value={fix.qty}
              set={(v) => set("qty", v)}
            />
            <NumberField
              label="Of these, remove from shelf"
              step="1"
              value={fix.stock}
              set={(v) => set("stock", v)}
            />
            <NumberField
              label="Refund ($, zero for damage)"
              value={fix.refund}
              set={(v) => set("refund", v)}
            />
          </div>
          <Select
            label="Account receiving the refund, if activity funds are returned"
            value={fix.account}
            onChange={(v) => set("account", v)}
            options={[
              ["", "Choose if applicable"],
              ...accounts.filter((a) => a.active).map((a) => [a.id, a.name]),
            ]}
          />
          <Field
            label="Reason / evidence"
            required
            value={fix.reason}
            onChange={(e: any) => set("reason", e.target.value)}
          />
          <Button disabled={state.busy || !!state.pending} type="submit">
            Record correction
          </Button>
        </form>
      </details>
    </div>
  );
}

function ForecastSettings({
  state,
  settings,
}: {
  state: ReturnType<typeof useWorkflow>;
  settings: Row;
}) {
  const [days, setDays] = useState(String(settings.price_fresh_days));
  return (
    <details className="panel">
      <summary>Price freshness &amp; forecast</summary>
      <form
        className="wf-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void state.send({
            action: "moneySelectRun",
            version: settings.version,
            runId: settings.selected_run,
            freshDays: Number(days),
          });
        }}
      >
        <NumberField
          label="Recheck recorded prices after (days)"
          value={days}
          min={1}
          step="1"
          set={setDays}
        />
        <Button disabled={state.busy || !!state.pending}>
          Save freshness threshold
        </Button>
        {settings.selected_run && (
          <Button
            type="button"
            variant="secondary"
            disabled={state.busy || !!state.pending}
            onClick={() =>
              state.send({
                action: "moneySelectRun",
                version: settings.version,
                runId: null,
                freshDays: Number(days),
              })
            }
          >
            Clear selected funds forecast
          </Button>
        )}
      </form>
    </details>
  );
}
function RunCharges({
  run: r,
  state,
  scope,
}: {
  run: Row;
  state: ReturnType<typeof useWorkflow>;
  scope: string;
}) {
  const [x, setX, clear] = useDraft<Row>(scope + ":run-charges:" + r.id, {
    version: r.version,
    charges:
      r.estimated_charges == null ? "" : String(r.estimated_charges / 100),
    discount: String(r.estimated_discount / 100),
  });
  return (
    <details className="wf-row">
      <summary>Update remaining estimated charges</summary>
      <form
        className="wf-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await state.send({
              action: "runSave",
              id: r.id,
              version: x.version,
              charges: cents(x.charges),
              discount: cents(x.discount) || 0,
            })
          )
            clear();
        }}
      >
        <p className="fine">
          These are estimates for the unpurchased items only. Actual receipt
          charges are confirmed separately.
        </p>
        <NumberField
          label="Remaining tax / delivery / fees ($, blank if unknown)"
          value={x.charges}
          set={(v) => setX((o) => ({ ...o, charges: v }))}
        />
        <NumberField
          label="Remaining estimated discount ($)"
          value={x.discount}
          set={(v) => setX((o) => ({ ...o, discount: v }))}
        />
        {x.version !== r.version && (
          <p className="notice warning">
            The saved run changed.{" "}
            <button
              type="button"
              onClick={() =>
                setX({
                  version: r.version,
                  charges:
                    r.estimated_charges == null
                      ? ""
                      : String(r.estimated_charges / 100),
                  discount: String(r.estimated_discount / 100),
                })
              }
            >
              Use current saved estimates
            </button>
          </p>
        )}
        <Button
          disabled={state.busy || !!state.pending || x.version !== r.version}
        >
          Save estimated charges
        </Button>
      </form>
    </details>
  );
}
