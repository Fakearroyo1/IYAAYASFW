"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, Package, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  gearKey,
  loadCart,
  saveCart,
  cartLines,
  selectionState,
  productPrice,
} from "@/lib/pilot/cart";
import { ProductReviews } from "@/app/store/community";
import { BrandMark, ThemeToggle } from "@/app/store/appearance";
type Row = Record<string, any>;
const money = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    v / 100,
  );
export default function ProductPage({ id }: { id: string }) {
  const [data, setData] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [option, setOption] = useState(""),
    [text, setText] = useState(""),
    [qty, setQty] = useState(1),
    [selectedImage, setSelectedImage] = useState(0),
    [added, setAdded] = useState(false);
  useEffect(() => {
    fetch("/api/pilot?view=catalog", { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 401) {
          window.location.replace(
            "/login?next=" + encodeURIComponent("/products/" + id),
          );
          return;
        }
        const j = (await r.json()) as Row;
        if (!r.ok) throw Error(j.error);
        setData(j);
      })
      .catch((e) => setError(e.message));
  }, [id]);
  const p = data?.products.find(
      (p: Row) => p.id === id && !p.archived && p.active,
    ),
    variants = p?.variants.filter((v: Row) => v.active) || [],
    v = variants.find((v: Row) => v.id === option),
    selected = p ? selectionState(p, option) : null,
    price = selected?.price,
    preorder = selected?.preorder,
    stock = selected?.stock || 0,
    priceRange = p ? productPrice(p) : { price: null, varies: false },
    images = [
      ...new Set([p?.image, ...(p?.images || [])].filter(Boolean)),
    ] as string[],
    available =
      p &&
      data?.settings.enabled &&
      !selected?.needsOption &&
      Number.isInteger(qty) &&
      qty > 0 &&
      qty <= 30 &&
      price > 0 &&
      p.tax_bp !== null &&
      (preorder || stock >= qty);
  const gear = p?.category === "Gear",
    shopHref = gear ? "/?view=gear" : "/?view=snacks",
    bagHref = shopHref + "&bag=1";
  function add(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!available) return;
    const cart = loadCart();
    try {
      if (sessionStorage.getItem("supply-pending"))
        throw Error(
          "Resolve the pending action in your bag before adding another item.",
        );
      if (p.personalization_required && !text.trim())
        throw Error("Enter " + p.personalization_label + ".");
      const key = gear ? gearKey(id, option, text.trim(), price) : id,
        quantity = (cart[key] || 0) + qty;
      if (quantity > 30) throw Error("Limit each option to 30 per purchase.");
      const used = cartLines(cart, data!.products)
        .filter((i) => i.stockKey === (option || id))
        .reduce((s, i) => s + i.qty, 0);
      if (!preorder && used + qty > stock)
        throw Error("Your bag already contains the available stock.");
      saveCart({ ...cart, [key]: quantity });
      setAdded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Try again.");
    }
  }
  return (
    <div className="app product-page">
      <header className="topbar">
        <a className="brand" href={shopHref}>
          <BrandMark />
          <span>
            IYAAYASFW<span className="brand-sub">Unit Supply</span>
          </span>
        </a>
        <div className="inline-actions">
          <ThemeToggle />
          <Button asChild variant="outline">
            <a href={bagHref}>
              <ShoppingBag size={17} />
              Your bag
            </a>
          </Button>
        </div>
      </header>
      <main>
        <Button asChild variant="ghost">
          <a href={shopHref}>
            <ArrowLeft size={16} />
            {gear ? "Back to unit gear" : "Back to snack bar"}
          </a>
        </Button>
        {!data ? (
          <p role="status">{error || "Loading product…"}</p>
        ) : !p ? (
          <section className="panel">
            <h1>Product unavailable</h1>
            <p>This item is not available for your account.</p>
          </section>
        ) : (
          <div className="product-detail-layout">
            <section className="product-gallery" aria-label="Product images">
              <div className="gallery-main">
                {images.length ? (
                  <img
                    src={images[selectedImage] || images[0]}
                    alt={p.name + " · image " + (selectedImage + 1)}
                  />
                ) : (
                  <Package size={64} />
                )}
              </div>
              {images.length > 1 ? (
                <div className="gallery-thumbs">
                  {images.map((image, i) => (
                    <button
                      type="button"
                      key={image}
                      aria-label={"View product image " + (i + 1)}
                      aria-pressed={selectedImage === i}
                      onClick={() => setSelectedImage(i)}
                    >
                      <img src={image} alt="" />
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
            <section className="product-detail-copy">
              <span className="eyebrow">
                {gear ? "Unit gear · Pickup only" : "Snack bar"}
              </span>
              <h1>{p.name}</h1>
              <p className="product-subtitle">{p.detail}</p>
              <p className="detail-price">
                {selected?.needsOption
                  ? priceRange.price == null
                    ? "Price unavailable"
                    : (priceRange.varies ? "From " : "") +
                      money(priceRange.price)
                  : price == null
                    ? "Price unavailable"
                    : money(price)}
              </p>
              <p className="fine">Includes configured tax.</p>
              <div className="product-description">
                {p.description ||
                  (gear
                    ? "Choose your item below. Your order will be available for pickup through the unit store."
                    : "Add the items you are taking to your tab. You can also use confirmed account credit.")}
              </div>
              <p className="product-balance">
                <strong>{money(data.member.credit)} credit available</strong>
                {!gear ? (
                  <span>{money(data.member.debt)} on your tab</span>
                ) : null}
              </p>
              <form onSubmit={add}>
                <fieldset disabled={!data.settings.enabled}>
                  <div className="form-grid">
                    {variants.length ? (
                      <label className="field">
                        <span>Size / color</span>
                        <NativeSelect
                          value={option}
                          onChange={(e) => {
                            setOption(e.target.value);
                            setQty(1);
                            setAdded(false);
                            setError("");
                          }}
                          required
                        >
                          <option value="">Choose an option</option>
                          {variants.map((v: Row) => (
                            <option key={v.id} value={v.id}>
                              {v.label} ·{" "}
                              {(v.price ?? p.price) == null
                                ? "Price unavailable"
                                : money(v.price ?? p.price)}
                              {v.preorder
                                ? " · Preorder"
                                : v.stock
                                  ? ""
                                  : " · Out of stock"}
                            </option>
                          ))}
                        </NativeSelect>
                      </label>
                    ) : null}
                    <label className="field">
                      <span>Quantity</span>
                      <Input
                        type="number"
                        disabled={!!selected?.needsOption}
                        min={1}
                        max={preorder ? 30 : Math.min(30, stock || 1)}
                        value={qty}
                        required
                        onChange={(e) => {
                          setQty(Number(e.target.value));
                          setAdded(false);
                        }}
                      />
                    </label>
                  </div>
                  {p.personalization_label ? (
                    <label className="field">
                      <span>
                        {p.personalization_label}
                        {p.personalization_required ? " *" : " (optional)"}
                      </span>
                      <Input
                        value={text}
                        onChange={(e) => {
                          setText(e.target.value);
                          setAdded(false);
                        }}
                        required={!!p.personalization_required}
                        maxLength={p.personalization_max}
                        placeholder={
                          p.personalization_label === "Last name"
                            ? "Enter the name exactly as it should appear"
                            : ""
                        }
                      />
                      <small>
                        Check spelling and capitalization. This text is saved
                        with your order.
                      </small>
                    </label>
                  ) : null}
                  <p className="notice" role="status" aria-live="polite">
                    {selected?.needsOption
                      ? variants.length
                        ? "Select an option to check availability."
                        : "No options are currently available."
                      : preorder
                        ? "Preorder · Pay before the group order is placed. Check My account for pickup updates."
                        : stock > 0
                          ? gear
                            ? "In stock · Check My account for pickup status."
                            : "In stock · Add to your tab at checkout."
                          : "Currently out of stock."}
                    {p.pickup_note ? " " + p.pickup_note : ""}
                  </p>
                  {!data.settings.enabled ? (
                    <p className="notice warning">
                      The shop is temporarily paused.
                    </p>
                  ) : null}
                  {error ? (
                    <p className="notice error" role="alert">
                      {error}
                    </p>
                  ) : null}
                  {added ? (
                    <p className="notice" role="status">
                      Added to your bag.
                    </p>
                  ) : null}
                  <div className="inline-actions">
                    <Button type="submit" disabled={!available}>
                      <ShoppingBag size={17} />
                      Add to bag{available ? " · " + money(price * qty) : ""}
                    </Button>
                    <Button variant="outline" asChild>
                      <a href={bagHref}>View bag & checkout</a>
                    </Button>
                  </div>
                </fieldset>
              </form>
            </section>
          </div>
        )}
        {data && p ? (
          <section id="reviews" className="product-reviews">
            <ProductReviews productId={id} member={data.member} />
          </section>
        ) : null}
      </main>
    </div>
  );
}
