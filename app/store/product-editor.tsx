"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { secureFetch } from "@/lib/identity/client";
import { Field, NumberField, money, type Row } from "./shared";
import { useDraft, Select, Check, cents } from "./workflow-shared";
export default function ProductEditor({
  product: p,
  memberId,
  send,
  busy,
}: {
  product: Row;
  memberId: string;
  send: (b: Row) => Promise<any>;
  busy: boolean;
}) {
  const [x, setX, clear] = useDraft<Row>(
      memberId + ":product:" + (p.id || "new"),
      {
        id: p.id || "",
        version: p.version ?? -1,
        name: p.name || "",
        category: p.category || "Snacks",
        detail: p.detail || "",
        image: p.image || "",
        price: p.price == null ? "" : String(p.price / 100),
        tax: p.tax_bp == null ? "" : String(p.tax_bp),
        stock: "0",
        cost: "",
        reorder: String(p.reorder ?? 5),
        active: !!p.active,
        purchase: null,
      },
    ),
    [options, setOptions] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [uploading, setUploading] = useState(false);
  const set = (k: string, v: unknown) => setX((o) => ({ ...o, [k]: v })),
    setOption = (k: string, v: unknown) =>
      setX((o) => ({
        ...o,
        purchase: {
          ...(o.purchase || {
            supplier: "",
            packLabel: "",
            unitsPerPack: "1",
            packPrice: "",
            priceKind: "default",
          }),
          [k]: v,
        },
      }));
  useEffect(() => {
    if (!p.id) return;
    secureFetch(
      "/api/workflows?view=purchaseOptions&productId=" +
        encodeURIComponent(p.id),
      { cache: "no-store" },
    )
      .then(async (r) => {
        const j = (await r.json()) as Row;
        if (!r.ok) throw Error(j.error);
        setOptions(j.options);
        const o =
          j.options.find((o: Row) => o.active && o.preferred) ||
          j.options.find((o: Row) => o.active);
        if (o)
          setX((x) =>
            x.purchase
              ? x
              : {
                  ...x,
                  purchase: {
                    id: o.id,
                    version: o.version,
                    supplier: o.supplier,
                    packLabel: o.pack_label,
                    unitsPerPack: String(o.units_per_pack),
                    packPrice:
                      o.pack_price == null ? "" : String(o.pack_price / 100),
                    priceKind: "default",
                  },
                },
          );
      })
      .catch((e) => setError(e.message));
  }, [p.id]);
  const price = cents(x.price),
    rounded = price === null ? null : Math.ceil(price / 25) * 25,
    option = x.purchase;
  return (
    <form
      className="wf-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const id = x.id || crypto.randomUUID();
        set("id", id);
        const result = await send({
          action: "saveProduct",
          id,
          create: !p.id,
          version: x.version,
          name: x.name,
          category: x.category,
          detail: x.detail,
          image: x.image,
          price,
          taxBp: x.tax === "" ? null : Number(x.tax),
          openingStock: Number(x.stock),
          cost: cents(x.cost),
          reorder: Number(x.reorder),
          active: x.active,
          purchase: option
            ? {
                ...option,
                unitsPerPack: Number(option.unitsPerPack),
                packPrice: cents(option.packPrice),
                priceAt: Date.now(),
                preferred: true,
              }
            : undefined,
        });
        if (result) clear();
      }}
    >
      <fieldset disabled={busy || uploading}>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {p.id && x.version !== p.version && (
          <p className="notice warning">
            This product changed since the draft was started. Compare its
            current saved details before saving.{" "}
            <button type="button" onClick={() => set("version", p.version)}>
              I reviewed the current version
            </button>
          </p>
        )}
        <Field
          label="Product name"
          required
          value={x.name}
          onChange={(e: any) => set("name", e.target.value)}
        />
        <div className="wf-fields">
          <Select
            label="Category"
            value={x.category}
            onChange={(v) => set("category", v)}
            options={["Snacks", "Drinks", "Frozen"].map(
              (v): [string, string] => [v, v],
            )}
          />
          <Field
            label="Variety / size"
            value={x.detail}
            onChange={(e: any) => set("detail", e.target.value)}
          />
        </div>
        <details open={!p.id}>
          <summary>Purchase defaults</summary>
          <p className="fine">
            Used by future restock plans and cost calculations. A pack price
            applies only to this supplier and pack size.
          </p>
          {options.length > 0 && (
            <Select
              label="Saved purchase option"
              value={option?.id || ""}
              onChange={(id) => {
                const o = options.find((o) => o.id === id);
                set(
                  "purchase",
                  o
                    ? {
                        id: o.id,
                        version: o.version,
                        supplier: o.supplier,
                        packLabel: o.pack_label,
                        unitsPerPack: String(o.units_per_pack),
                        packPrice:
                          o.pack_price == null
                            ? ""
                            : String(o.pack_price / 100),
                        priceKind: "default",
                      }
                    : {
                        supplier: "",
                        packLabel: "",
                        unitsPerPack: "1",
                        packPrice: "",
                        priceKind: "default",
                      },
                );
              }}
              options={[
                ["", "Add another supplier / pack"],
                ...options.map((o) => [
                  o.id,
                  o.supplier + " · " + o.units_per_pack + " units",
                ]),
              ]}
            />
          )}
          <div className="wf-fields">
            <Field
              label="Supplier"
              value={option?.supplier || ""}
              onChange={(e: any) => setOption("supplier", e.target.value)}
            />
            <Field
              label="Pack description"
              value={option?.packLabel || ""}
              onChange={(e: any) => setOption("packLabel", e.target.value)}
            />
            <NumberField
              label="Units per pack"
              min={1}
              step="1"
              value={option?.unitsPerPack || "1"}
              set={(v) => setOption("unitsPerPack", v)}
            />
            <NumberField
              label="Recorded price per pack ($, blank if unknown)"
              value={option?.packPrice ?? ""}
              set={(v) => setOption("packPrice", v)}
            />
          </div>
        </details>
        <div className="wf-fields">
          <NumberField
            label="Selling price ($)"
            value={x.price}
            min={0.01}
            set={(v) => set("price", v)}
          />
          <Select
            label="Tax treatment"
            value={x.tax}
            onChange={(v) => set("tax", v)}
            options={[
              ["", "Choose explicitly"],
              ["0", "No tax"],
              ["600", "6% included"],
              ["700", "7% included"],
              ...(!["", "0", "600", "700"].includes(x.tax)
                ? [
                    [x.tax, Number(x.tax) / 100 + "% included"] as [
                      string,
                      string,
                    ],
                  ]
                : []),
            ]}
          />
          <NumberField
            label="Restock at (units)"
            value={x.reorder}
            step="1"
            set={(v) => set("reorder", v)}
          />
        </div>
        <p className="fine">
          Checkout price: {money(rounded)}. Selling prices round up to the next
          $0.25, including the selected tax.
        </p>
        {!p.id ? (
          <details>
            <summary>Opening inventory, if already on the shelf</summary>
            <div className="wf-fields">
              <NumberField
                label="Opening units"
                value={x.stock}
                step="1"
                set={(v) => set("stock", v)}
              />
              <NumberField
                label="Historical cost per unit ($, blank if unknown)"
                value={x.cost}
                set={(v) => set("cost", v)}
              />
            </div>
            <p className="fine">
              This records existing stock, not a new purchase or expense. Use
              Restock to record a purchase.
            </p>
          </details>
        ) : (
          <p className="fine">
            Stock stays current while you edit. Receive purchases in Restock or
            make a separate counted stock adjustment.
          </p>
        )}
        <details>
          <summary>Product image</summary>
          {x.image && (
            <img
              src={x.image}
              alt="Product preview"
              style={{ maxWidth: 160, maxHeight: 160, objectFit: "contain" }}
            />
          )}
          <Field label="Upload image">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setUploading(true);
                setError("");
                try {
                  const form = new FormData();
                  form.append("image", f);
                  const r = await secureFetch("/api/product-images", {
                      method: "POST",
                      body: form,
                    }),
                    j = (await r.json()) as Row;
                  if (!r.ok) throw Error(j.error);
                  set("image", j.image);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setUploading(false);
                }
              }}
            />
          </Field>
          {x.image && (
            <Button
              variant="ghost"
              type="button"
              onClick={() => set("image", "")}
            >
              Remove image
            </Button>
          )}
        </details>
        <Check
          label="Make available for purchase"
          checked={x.active}
          onChange={(v) => set("active", v)}
        />
        <Button
          type="submit"
          disabled={x.active && (price === null || x.tax === "")}
        >
          {p.id ? "Save product" : "Save product & purchase defaults"}
        </Button>
        <p className="fine">Draft saved in this browser tab.</p>
      </fieldset>
    </form>
  );
}
