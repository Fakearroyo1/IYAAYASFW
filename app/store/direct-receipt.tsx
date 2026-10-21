"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Field, NumberField, money, type Row } from "./shared";
import {
  useDraft,
  useWorkflow,
  WorkflowStatus,
  Select,
  Check,
  cents,
  localTime,
} from "./workflow-shared";
export default function DirectReceipt({
  product: p,
  memberId,
  onSaved,
}: {
  product: Row;
  memberId: string;
  onSaved: () => void;
}) {
  const state = useWorkflow("view=catalog", memberId + ":direct:" + p.id),
    funds = useWorkflow("view=money", memberId + ":direct-funds"),
    [x, setX, clear] = useDraft<Row>(memberId + ":direct:" + p.id, {
      option: "",
      loaded: false,
      packs: "1",
      units: "1",
      price: "",
      charges: "0",
      discount: "0",
      total: "",
      supplier: "",
      reference: "",
      time: localTime(),
      funding: "activity",
      account: "",
      purchaser: "",
      receive: true,
      confirmed: false,
    }),
    item = state.data?.items.find(
      (i: Row) => i.product_id === p.id && i.option_id === (p.variantId || ""),
    ),
    options = item?.purchaseOptions || [];
  const useOption = (o?: Row) =>
    setX((v) => ({
      ...v,
      loaded: true,
      option: o?.id || "",
      units: String(o?.units_per_pack || 1),
      price: o?.pack_price == null ? "" : String(o.pack_price / 100),
      supplier: o?.supplier || "",
      confirmed: false,
    }));
  useEffect(() => {
    if (item && !x.loaded) useOption(options[0]);
  }, [item, x.loaded]);
  const set = (k: string, v: unknown) =>
      setX((x) => ({ ...x, [k]: v, confirmed: k === "confirmed" ? v : false })),
    total =
      Number(x.packs) * (cents(x.price) || 0) +
      (cents(x.charges) || 0) -
      (cents(x.discount) || 0);
  return (
    <form
      className="wf-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const result = await state.send({
          action: "purchaseDirect",
          items: [
            {
              productId: p.id,
              variantId: p.variantId || "",
              purchaseOptionId: x.option || undefined,
              packs: Number(x.packs),
              unitsPerPack: Number(x.units),
              packPrice: cents(x.price),
              supplier: x.supplier,
            },
          ],
          supplier: x.supplier,
          reference: x.reference,
          purchasedAt: Date.parse(x.time),
          charges: cents(x.charges),
          discount: cents(x.discount) || 0,
          total: cents(x.total),
          funding: x.funding,
          account: x.account,
          purchaser: x.purchaser,
          receiveNow: x.receive,
          confirmed: x.confirmed,
          chargesValidated: x.confirmed,
        });
        if (result) {
          clear();
          onSaved();
        }
      }}
    >
      <WorkflowStatus state={state} />
      <p>
        <strong>{p.name}</strong> · a receipt records spending once. Stock can
        be added now or later.
      </p>
      <fieldset disabled={state.busy || !!state.pending}>
        <Select
          label="Recorded purchase option"
          value={x.option}
          onChange={(id) => useOption(options.find((o: Row) => o.id === id))}
          options={[
            ["", "Manual receipt"],
            ...options.map((o: Row) => [
              o.id,
              `${o.supplier} · ${o.units_per_pack} units · ${money(o.pack_price)}${o.stale ? " · recheck price" : ""}`,
            ]),
          ]}
        />
        <div className="wf-fields">
          <NumberField
            label="Packs purchased"
            min={1}
            step="1"
            value={x.packs}
            set={(v) => set("packs", v)}
          />
          <NumberField
            label="Units per pack"
            min={1}
            step="1"
            value={x.units}
            set={(v) =>
              setX((x) => ({ ...x, units: v, price: "", confirmed: false }))
            }
          />
          <NumberField
            label="Actual price per pack ($)"
            value={x.price}
            set={(v) => set("price", v)}
          />
          <NumberField
            label="Tax / delivery / fees allocated to this item ($)"
            value={x.charges}
            set={(v) => set("charges", v)}
          />
          <NumberField
            label="Discount ($)"
            value={x.discount}
            set={(v) => set("discount", v)}
          />
          <NumberField
            label="Receipt total for these goods ($)"
            value={x.total}
            set={(v) => set("total", v)}
          />
        </div>
        <p>
          {Number(x.packs) * Number(x.units)} units · calculated total{" "}
          {money(total)}
        </p>
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
          value={x.time}
          onChange={(e: any) => set("time", e.target.value)}
        />
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
            label="Activity account actually used"
            value={x.account}
            onChange={(v) => set("account", v)}
            required
            options={[
              ["", "Choose account"],
              ...(funds.data?.accounts || [])
                .filter((a: Row) => a.active)
                .map((a: Row) => [a.id, a.name]),
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
        <Check
          label="Add these units to stock now"
          checked={x.receive}
          onChange={(v) => set("receive", v)}
        />
        <Check
          label="I checked the quantities, price, and allocated charges against this receipt."
          checked={x.confirmed}
          onChange={(v) => set("confirmed", v)}
        />
        <Button
          disabled={
            !x.confirmed ||
            x.price === "" ||
            x.charges === "" ||
            cents(x.total) !== total
          }
          type="submit"
        >
          {x.receive
            ? "Record receipt & stock"
            : "Record receipt · stock later"}
        </Button>
      </fieldset>
    </form>
  );
}
