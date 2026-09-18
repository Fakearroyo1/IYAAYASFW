"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field, money, type Row } from "./shared";
import {GearDelivery} from "./guest-manager";
import { Performance } from "./pricing-hub";
import { suggestedPrice, priceMargin } from "@/lib/pilot/pricing";

const dollars = (n: number | null | undefined) =>
  n == null ? "" : String(n / 100);
const cents = (s: string) =>
  s.trim() === "" ? null : Math.round(Number(s) * 100);
function draft(p: Row): Row {
  return {
    ...p,
    name: p.name || "",
    detail: p.detail || "",
    description: p.description || "",
    image: p.image || "",
    images: p.images || [],
    priceText: dollars(p.price),
    costText: dollars(p.cost),
    taxText: p.tax_bp == null ? "" : String(p.tax_bp / 100),
    active: !!p.active,
    preorder: !!p.preorder,
    personalization_label: p.personalization_label || "",
    personalization_required: !!p.personalization_required,
    personalization_max: p.personalization_max || 30,
    pickup_note: p.pickup_note || "",
    stock: 0,
    stockReason: "",
    variants: (p.variants || []).map((v: Row) => ({
      ...v,
      priceText: dollars(v.price),
      costText: dollars(v.cost),
      active: !!v.active,
      preorder: !!v.preorder,
    })),
  };
}
export default function GearManager({
  p,
  data,
  send,
  open,
  busy,
  onBack,
}: {
  p: Row;
  data: Row;
  send: (b: Row) => Promise<any>;
  open: (kind: string, row?: Row) => void;
  busy: boolean;
  onBack: () => void;
}) {
  const [value, setValue] = useState(() => draft(p)),
    [dirty, setDirty] = useState(false),
    [uploading, setUploading] = useState(false),
    [message, setMessage] = useState("");
  const [preset, setPreset] = useState("shirt"),
    [sizes, setSizes] = useState("XS, S, M, L, XL, 2XL, 3XL"),
    [colors, setColors] = useState("");
  const [quote, setQuote] = useState(dollars(p.cost)),
    [margin, setMargin] = useState("30");
  const newId = useRef(""),
    snapshot = JSON.stringify(p),
    saved = useRef(snapshot);
  useEffect(() => {
    if (!dirty) {
      setValue(draft(p));
      saved.current = snapshot;
    }
  }, [snapshot, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const edit = (patch: Row) => {
    setValue((v: Row) => ({ ...v, ...patch }));
    setDirty(true);
    setMessage("");
  };
  const editOption = (index: number, patch: Row) =>
    edit({
      variants: value.variants.map((v: Row, i: number) =>
        i === index ? { ...v, ...patch } : v,
      ),
    });
  const photos = [value.image, ...value.images].filter(Boolean) as string[];
  function setPhotos(next: string[]) {
    edit({ image: next[0] || "", images: next.slice(1) });
  }
  async function upload(files: FileList | null) {
    if (!files) return;
    if (photos.length + files.length > 9) {
      setMessage("Use one main image and up to eight detail photos.");
      return;
    }
    setUploading(true);
    setMessage("");
    let next = [...photos];
    try {
      for (const file of Array.from(files)) {
        if (file.size > 5 * 1024 * 1024)
          throw Error("Each image must be under 5 MB.");
        const f = new FormData();
        f.set("image", file);
        const r = await fetch("/api/product-images", {
            method: "POST",
            body: f,
          }),
          j = (await r.json()) as Row;
        if (!r.ok) throw Error(j.error || "Upload failed.");
        next = [...next, j.image];
        setPhotos(next);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }
  function addOptions() {
    const ss =
        preset === "name"
          ? [""]
          : sizes
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
      cs = colors
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    if (!cs.length) cs.push("");
    const extra = ss
      .flatMap((size) =>
        cs.map((color) => ({
          label: [
            preset === "name"
              ? "Name tape"
              : preset === "hoodie"
                ? "Hoodie"
                : "Shirt",
            size,
            color,
          ]
            .filter(Boolean)
            .join(" / "),
          size,
          color,
          priceText: "",
          stock: 0,
          active: true,
          preorder: value.preorder,
        })),
      )
      .filter(
        (v) =>
          !value.variants.some(
            (x: Row) => x.label.toLowerCase() === v.label.toLowerCase(),
          ),
      );
    if (value.variants.length + extra.length > 80) {
      setMessage("Use up to 80 options per product.");
      return;
    }
    edit({ variants: [...value.variants, ...extra] });
    if (preset === "name")
      edit({
        personalization_label: value.personalization_label || "Last name",
        personalization_required: true,
      });
  }
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage("");
    const intent = (e.nativeEvent as SubmitEvent).submitter?.getAttribute(
      "value",
    );
    if (!newId.current) newId.current = crypto.randomUUID();
    const payload = {
      action: "saveGear",
      id: p.id || newId.current,
      create: !p.id,
      version: value.version || 0,
      name: value.name,
      detail: value.detail,
      description: value.description,
      image: value.image,
      images: value.images,
      price: cents(value.priceText),
      cost: cents(value.costText),
      taxBp: cents(value.taxText),
      active:
        intent === "publish" ? true : intent === "draft" ? false : value.active,
      preorder: value.preorder,
      personalizationLabel: value.personalization_label,
      personalizationRequired: value.personalization_required,
      personalizationMax: Number(value.personalization_max),
      pickupNote: value.pickup_note,
      stockReason: value.stockReason,
      ...(!p.id ? { stock: Number(value.stock) } : {}),
      variants: value.variants.map((v: Row) => ({
        ...(v.id
          ? { id: v.id, version: v.version }
          : { stock: Number(v.stock || 0) }),
        label: v.label,
        size: v.size,
        color: v.color,
        price: cents(v.priceText),
        cost: cents(v.costText || ""),
        active: v.active,
        preorder: v.preorder,
      })),
    };
    if (new TextEncoder().encode(JSON.stringify(payload)).length > 63000) {
      setMessage(
        "This item has too much text for one save. Shorten the description or option labels. Your edits are still here.",
      );
      return;
    }
    const ok = await send(payload);
    if (ok) {
      setDirty(false);
      setMessage(
        payload.active
          ? "Saved and published."
          : "Draft saved. This item is hidden from members.",
      );
    } else
      setMessage(
        "Your edits are still here. Review the error above, then retry.",
      );
  }
  const quoteCents = cents(quote),
    suggestion =
      quoteCents !== null &&
      Number.isFinite(quoteCents) &&
      quoteCents >= 0 &&
      value.taxText !== ""
        ? suggestedPrice(
            quoteCents,
            Number(margin),
            Number(value.taxText),
            false,
          )
        : null;
  const locked = busy || uploading,
    countLocked = locked || dirty;
  return (
    <section className="panel gear-manager">
      <Button
        variant="ghost"
        type="button"
        disabled={locked}
        onClick={() => {
          if (
            !dirty ||
            window.confirm("Leave without saving these gear changes?")
          )
            onBack();
        }}
      >
        <ArrowLeft size={16} />
        All inventory
      </Button>
      <div className="section-title">
        <div>
          <span className="eyebrow">Gear Manager</span>
          <h2>{p.name || "New gear item"}</h2>
          <p className="fine">
            Details, photos, options, and pricing in one place.
          </p>
        </div>
        <span className={"status " + (p.active ? "verified" : "pending")}>
          {p.archived ? "Archived" : p.active ? "Published" : "Draft / hidden"}
        </span>
      </div>
      {p.archived ? (
        <p className="notice warning">
          Restore this item from Inventory to edit it.
        </p>
      ) : null}
      {dirty && saved.current !== snapshot ? (
        <p className="notice warning" role="alert">
          This item changed while you were editing. Your draft is intact.{" "}
          <Button
            type="button"
            variant="outline"
            disabled={locked}
            onClick={() => {
              if (
                window.confirm(
                  "Discard this draft and load the latest saved item?",
                )
              ) {
                setDirty(false);
                setMessage("Latest item loaded.");
              }
            }}
          >
            Load latest item
          </Button>
        </p>
      ) : null}
      <form onSubmit={save}>
        <fieldset disabled={locked || !!p.archived}>
          <section className="gear-section">
            <h3>Product details</h3>
            <div className="form-grid">
              <Field
                label="Product name"
                value={value.name}
                maxLength={100}
                required
                onChange={(e: any) => edit({ name: e.target.value })}
              />
              <Field
                label="Short description"
                value={value.detail}
                maxLength={200}
                onChange={(e: any) => edit({ detail: e.target.value })}
              />
            </div>
            <Field label="Full description">
              <textarea
                rows={4}
                value={value.description}
                maxLength={5000}
                onChange={(e) => edit({ description: e.target.value })}
                placeholder="Fit, materials, size guide, ordering deadlines…"
              />
            </Field>
          </section>
          <section className="gear-section">
            <h3>Photos</h3>
            <p className="fine">
              The first photo is used on the shop tile. JPG, PNG, or WebP · 5 MB
              each.
            </p>
            <div className="gallery-editor">
              {photos.map((src, i) => (
                <div key={src}>
                  <img src={src} alt={"Product photo " + (i + 1)} />
                  <small>{i === 0 ? "Main image" : "Detail photo"}</small>
                  <div className="inline-actions">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={i === 0}
                      onClick={() =>
                        setPhotos([src, ...photos.filter((x) => x !== src)])
                      }
                    >
                      Make main
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={"Remove photo " + (i + 1)}
                      onClick={() => setPhotos(photos.filter((x) => x !== src))}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <Field label="Upload product photos">
              <Input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={(e) => {
                  void upload(e.target.files);
                  e.target.value = "";
                }}
              />
            </Field>
          </section>
          <section className="gear-section">
            <h3>Pricing & ordering</h3>
            <div className="form-grid">
              <Field
                label="Base price ($, tax included)"
                type="number"
                min="0.01"
                max="1000"
                step="0.01"
                value={value.priceText}
                onChange={(e: any) => edit({ priceText: e.target.value })}
              />
              <Field
                label="Included sales tax (%)"
                type="number"
                min="0"
                max="30"
                step="0.01"
                value={value.taxText}
                onChange={(e: any) => edit({ taxText: e.target.value })}
              />
              <Field
                label={
                  value.variants.length
                    ? "Default for new options"
                    : "Ordering mode"
                }
              >
                <NativeSelect
                  value={value.preorder ? "preorder" : "stock"}
                  onChange={(e) =>
                    edit({ preorder: e.target.value === "preorder" })
                  }
                >
                  <option value="stock">Stocked item</option>
                  <option value="preorder">Preorder</option>
                </NativeSelect>
              </Field>
            </div>
            <Field
              label="Recorded unit cost ($, optional)"
              type="number"
              min="0"
              max="10000"
              step="0.01"
              value={value.costText}
              onChange={(e: any) => edit({ costText: e.target.value })}
            />
            <p className="fine">
              Cost edits affect future purchases; they do not add an expense or
              alter past sales. Leave blank if unknown.
            </p>
            <p className="fine">
              Enter 0 for tax only when confirmed exempt. Blank option prices
              inherit the base price. Price edits apply to future purchases.
            </p>
            <details className="workbench">
              <summary>Explore cost & margin</summary>
              <div className="gear-calculator">
                <div className="form-grid">
                  <Field
                    label="Estimated unit cost ($)"
                    type="number"
                    min="0"
                    step="0.01"
                    value={quote}
                    onChange={(e: any) => setQuote(e.target.value)}
                  />
                  <Field
                    label="Target gross margin (%)"
                    type="number"
                    min="0"
                    max="95"
                    value={margin}
                    onChange={(e: any) => setMargin(e.target.value)}
                  />
                </div>
                <p>
                  Suggested price: <strong>{money(suggestion)}</strong>
                  {suggestion && quoteCents !== null
                    ? " · " +
                      priceMargin(
                        suggestion,
                        quoteCents,
                        Number(value.taxText),
                      ).margin.toFixed(1) +
                      "% margin"
                    : ""}
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!suggestion}
                  onClick={() => edit({ priceText: dollars(suggestion) })}
                >
                  Use as draft base price
                </Button>
                <p className="fine">
                  Estimates do not change recorded costs. Receive purchases
                  below to record actual restocking costs.
                </p>
              </div>
            </details>
          </section>
          <section className="gear-section">
            <h3>Sizes, colors & options</h3>
            <p className="fine">
              For items without options, leave this section empty. Existing
              options can be hidden while retaining purchase history.
            </p>
            <details className="workbench">
              <summary>Add common options</summary>
              <div className="gear-calculator">
                <div className="form-grid">
                  <Field label="Preset">
                    <NativeSelect
                      value={preset}
                      onChange={(e) => setPreset(e.target.value)}
                    >
                      <option value="shirt">Shirt</option>
                      <option value="hoodie">Hoodie</option>
                      <option value="name">Name tape</option>
                    </NativeSelect>
                  </Field>
                  {preset !== "name" ? (
                    <Field
                      label="Sizes, separated by commas"
                      value={sizes}
                      onChange={(e: any) => setSizes(e.target.value)}
                    />
                  ) : null}
                  <Field
                    label="Colors, separated by commas"
                    value={colors}
                    placeholder="Black, Gray, Navy"
                    onChange={(e: any) => setColors(e.target.value)}
                  />
                </div>
                <Button type="button" variant="secondary" onClick={addOptions}>
                  Add preset options
                </Button>
              </div>
            </details>
            <div className="gear-options">
              {value.variants.map((v: Row, i: number) => (
                <div className="variant-card" key={v.id || "new" + i}>
                  <div className="form-grid">
                    <Field
                      label="Option name"
                      required
                      value={v.label}
                      maxLength={100}
                      onChange={(e: any) =>
                        editOption(i, { label: e.target.value })
                      }
                    />
                    <Field
                      label="Size"
                      value={v.size}
                      maxLength={30}
                      onChange={(e: any) =>
                        editOption(i, { size: e.target.value })
                      }
                    />
                    <Field
                      label="Color"
                      value={v.color}
                      maxLength={50}
                      onChange={(e: any) =>
                        editOption(i, { color: e.target.value })
                      }
                    />
                    <Field
                      label="Option price ($)"
                      type="number"
                      step="0.01"
                      min="0.01"
                      max="1000"
                      value={v.priceText}
                      placeholder={
                        value.priceText
                          ? "Base: " + value.priceText
                          : "Use base price"
                      }
                      onChange={(e: any) =>
                        editOption(i, { priceText: e.target.value })
                      }
                    />
                    <Field
                      label="Option unit cost ($, optional)"
                      type="number"
                      min="0"
                      max="10000"
                      step="0.01"
                      value={v.costText || ""}
                      placeholder={
                        value.costText
                          ? "Base cost: " + value.costText
                          : "Use base cost"
                      }
                      onChange={(e: any) =>
                        editOption(i, { costText: e.target.value })
                      }
                    />
                    <Field label="Ordering mode">
                      <NativeSelect
                        value={v.preorder ? "preorder" : "stock"}
                        onChange={(e) =>
                          editOption(i, {
                            preorder: e.target.value === "preorder",
                          })
                        }
                      >
                        <option value="stock">Stocked</option>
                        <option value="preorder">Preorder</option>
                      </NativeSelect>
                    </Field>
                    {!v.id ? (
                      <Field
                        label="Opening count"
                        type="number"
                        min="0"
                        max="100000"
                        step="1"
                        value={v.stock || 0}
                        onChange={(e: any) =>
                          editOption(i, { stock: e.target.value })
                        }
                      />
                    ) : null}
                  </div>
                  <div className="variant-controls">
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={v.active}
                        onChange={(e) =>
                          editOption(i, { active: e.target.checked })
                        }
                      />
                      Visible option
                    </label>
                    <span className="fine">
                      {v.priceText
                        ? money(cents(v.priceText))
                        : value.priceText
                          ? money(cents(value.priceText)) + " · base price"
                          : "Price not set"}
                    </span>
                    {!v.id ? (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          edit({
                            variants: value.variants.filter(
                              (_: Row, j: number) => i !== j,
                            ),
                          })
                        }
                      >
                        Remove new option
                      </Button>
                    ) : (
                      <span className="fine">
                        {p.variants?.find((x: Row) => x.id === v.id)?.stock ??
                          v.stock}{" "}
                        on hand
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={value.variants.length >= 80}
              onClick={() =>
                edit({
                  variants: [
                    ...value.variants,
                    {
                      label: "",
                      size: "",
                      color: "",
                      priceText: "",
                      active: true,
                      preorder: value.preorder,
                      stock: 0,
                    },
                  ],
                })
              }
            >
              <Plus size={16} />
              Add custom option
            </Button>
            {!p.id && !value.variants.length ? (
              <Field
                label="Opening inventory count"
                type="number"
                min="0"
                max="100000"
                step="1"
                value={value.stock}
                onChange={(e: any) => edit({ stock: e.target.value })}
              />
            ) : null}
            {Number(value.stock) > 0 ||
            value.variants.some((v: Row) => !v.id && Number(v.stock) > 0) ? (
              <>
                <Field
                  label="Opening count reason"
                  required
                  value={value.stockReason}
                  maxLength={200}
                  placeholder="Counted existing stock on…"
                  onChange={(e: any) => edit({ stockReason: e.target.value })}
                />
                <p className="fine">
                  Opening counts record existing inventory without recording an
                  expense. Use Receive stock for a new supplier purchase.
                </p>
              </>
            ) : null}
          </section>
          <section className="gear-section">
            <h3>Personalization & pickup</h3>
            <div className="form-grid">
              <Field
                label="Personalization label (optional)"
                value={value.personalization_label}
                maxLength={60}
                placeholder="Last name"
                onChange={(e: any) =>
                  edit({ personalization_label: e.target.value })
                }
              />
              <Field
                label="Maximum characters"
                type="number"
                min="1"
                max="80"
                step="1"
                required
                value={value.personalization_max}
                onChange={(e: any) =>
                  edit({ personalization_max: e.target.value })
                }
              />
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={value.personalization_required}
                onChange={(e) =>
                  edit({ personalization_required: e.target.checked })
                }
              />
              Require personalization
            </label>
            <Field label="Pickup instructions">
              <textarea
                rows={3}
                maxLength={500}
                value={value.pickup_note}
                onChange={(e) => edit({ pickup_note: e.target.value })}
              />
            </Field>
          </section>
          <div className="gear-save">
            <div>
              <strong>
                {dirty
                  ? "Unsaved changes"
                  : p.id
                    ? "All changes saved"
                    : "Start with a draft"}
              </strong>
              <p className="fine">
                Publishing makes the complete item visible to members with gear
                access.
              </p>
            </div>
            <div className="inline-actions">
              {p.active ? (
                <>
                  <Button type="submit" value="publish">
                    Save published item
                  </Button>
                  <Button type="submit" variant="outline" value="draft">
                    Save & hide
                  </Button>
                </>
              ) : (
                <>
                  <Button type="submit" variant="outline" value="draft">
                    Save draft
                  </Button>
                  <Button type="submit" value="publish">
                    {uploading ? "Uploading…" : "Publish item"}
                  </Button>
                </>
              )}
            </div>
          </div>
          {message ? (
            <p className="notice" role="status">
              {message}
            </p>
          ) : null}
        </fieldset>
      </form>
      {p.id ? (
        <section className="gear-section">
          <div className="section-title">
            <div>
              <h3>Inventory actions</h3>
              <p className="fine">
                {dirty
                  ? "Save your product changes before receiving or adjusting stock."
                  : "Record received purchases or correct a physical count with an audit note."}
              </p>
            </div>
            {p.active && !p.archived ? (
              <Button variant="outline" asChild>
                <a href={"/products/" + encodeURIComponent(p.id)}>
                  View published item
                </a>
              </Button>
            ) : null}
          </div>
          {(p.variants?.length ? p.variants : [p]).map((v: Row) => (
            <div className="gear-stock-row" key={v.id}>
              <div>
                <strong>{v.label || p.name}</strong>
                <small>
                  {v.stock} on hand{v.preorder ? " · Preorder" : ""}
                  {!v.active ? " · Hidden" : ""}
                </small>
              </div>
              <div className="inline-actions">
                {!v.preorder ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={countLocked || p.archived}
                    onClick={() =>
                      open(
                        "receive",
                        v === p
                          ? p
                          : { ...p, variantId: v.id, variantLabel: v.label },
                      )
                    }
                  >
                    Receive stock
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  disabled={countLocked || p.archived}
                  onClick={() =>
                    open(
                      v === p ? "gearStock" : "variantStock",
                      v === p ? p : { ...v, name: p.name, productId: p.id },
                    )
                  }
                >
                  Adjust count
                </Button>
              </div>
            </div>
          ))}
          {p.variants?.length ? (
            <div className="unassigned-stock">
              <h4>{p.stock} unassigned units</h4>
              <p className="fine">
                Assign these existing units to an option before members can buy
                them. Allocation preserves the total inventory.
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={countLocked || !p.stock || p.archived}
                onClick={() => open("allocate", p)}
              >
                Allocate existing stock
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
      {p.id ? <><GearDelivery productId={p.id}/><Performance p={p} data={data} /></> : null}
    </section>
  );
}
