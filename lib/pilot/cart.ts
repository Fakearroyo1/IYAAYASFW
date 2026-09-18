type Row = Record<string, any>;
export const CART_KEY = "supply-bag-v2";
export function loadCart(): Record<string, number> {
  try {
    const value = JSON.parse(sessionStorage.getItem(CART_KEY) || "{}");
    return Object.fromEntries(
      Object.entries(value).filter(
        ([key, qty]) =>
          key.length < 800 &&
          Number.isSafeInteger(qty) &&
          Number(qty) > 0 &&
          Number(qty) <= 30,
      ),
    ) as Record<string, number>;
  } catch {
    return {};
  }
}
export function saveCart(cart: Record<string, number>) {
  try {
    sessionStorage.setItem(CART_KEY, JSON.stringify(cart));
  } catch {}
}
export function gearKey(
  id: string,
  variantId: string,
  personalization: string,
  price: number,
) {
  return (
    "gear:" +
    encodeURIComponent(
      JSON.stringify({ id, variantId, personalization, price }),
    )
  );
}
export function selectionState(p: Row, variantId = "") {
  const required = !!(p.option_required || p.variants?.length),
    variant = p.variants?.find((v: Row) => v.id === variantId && v.active);
  return {
    required,
    variant,
    needsOption: required && !variant,
    price: variant?.price ?? p.price,
    stock: required ? (variant?.stock ?? 0) : p.stock,
    preorder: required ? !!variant?.preorder : !!p.preorder,
  };
}
export function productPrice(p: Row) {
  const prices =
    p.option_required || p.variants?.length
      ? (p.variants || [])
          .filter((v: Row) => v.active)
          .map((v: Row) => v.price ?? p.price)
          .filter((v: any) => v > 0)
      : [p.price].filter((v) => v > 0);
  return {
    price: prices.length ? Math.min(...prices) : null,
    varies: new Set(prices).size > 1,
  };
}
export function cartLines(
  cart: Record<string, number>,
  products: Row[],
): Row[] {
  return Object.entries(cart).flatMap<Row>(([key, qty]) => {
    let spec: Row = { id: key };
    try {
      if (key.startsWith("gear:"))
        spec = JSON.parse(decodeURIComponent(key.slice(5)));
    } catch {
      return [];
    }
    if (!spec || typeof spec.id !== "string") return [];
    const p = products.find((p) => p.id === spec.id);
    if (!p)
      return [
        {
          id: spec.id,
          key,
          qty,
          name: "Unavailable item",
          category: key.startsWith("gear:") ? "Gear" : "Snacks",
          price: spec.price || 0,
          currentPrice: null,
          active: 0,
          unavailable: true,
          stock: 0,
          stockKey: spec.variantId || spec.id,
        },
      ];
    const selection = selectionState(p, spec.variantId || ""),
      v = selection.variant;
    return [
      {
        ...p,
        key,
        qty,
        variantId: spec.variantId || "",
        variantLabel: v?.label || "",
        personalization: spec.personalization || "",
        price: spec.price ?? p.price,
        currentPrice: selection.price,
        stock: selection.stock,
        preorder: selection.preorder,
        active: p.active && (!spec.variantId || !!v),
        missingOption: selection.needsOption || (!!spec.variantId && !v),
        stockKey: spec.variantId || p.id,
      },
    ];
  });
}
export function cartIssue(p: Row, lines: Row[]) {
  if (p.unavailable || p.archived || !p.active)
    return "This item is no longer available. Remove it from your bag.";
  if (p.missingOption) return "Choose an available option on the product page.";
  if (!(p.currentPrice > 0) || p.tax_bp == null)
    return "This item is not ready for sale.";
  if (p.price !== p.currentPrice)
    return "The price changed. Review the new price before checkout.";
  if (!Number.isSafeInteger(p.qty) || p.qty < 1 || p.qty > 30)
    return "Choose a quantity from 1 to 30.";
  if (p.personalization_required && !String(p.personalization || "").trim())
    return "Add the required personalization on the product page.";
  if (
    !p.preorder &&
    lines
      .filter((x) => (x.stockKey || x.id) === (p.stockKey || p.id))
      .reduce((n, x) => n + x.qty, 0) > p.stock
  )
    return "Your bag exceeds the available stock. Reduce the quantity.";
  return "";
}
export function cartValid(lines: Row[]) {
  return !!lines.length && lines.every((p) => !cartIssue(p, lines));
}
export function canAddLine(p: Row, lines: Row[]) {
  return (
    !cartIssue(p, lines) &&
    p.qty < 30 &&
    (p.preorder ||
      lines
        .filter((x) => (x.stockKey || x.id) === (p.stockKey || p.id))
        .reduce((n, x) => n + x.qty, 0) < p.stock)
  );
}
export function productAvailability(p: Row) {
  if (p.archived) return "Archived";
  if (!p.active) return "Hidden";
  const variants = p.variants || [];
  if (p.option_required || variants.length) {
    if (p.tax_bp == null) return "Needs pricing";
    const purchasable = variants.filter(
      (v: Row) =>
        v.active && (v.price ?? p.price) > 0 && (v.preorder || v.stock > 0),
    );
    if (!purchasable.length) return "Options unavailable";
    return purchasable.every((v: Row) => v.preorder) ? "Preorder" : "Available";
  }
  if (!(p.price > 0) || p.tax_bp == null) return "Needs pricing";
  if (p.preorder) return "Preorder";
  return p.stock > 0 ? "Available" : "Out of stock";
}
export function productReady(p: Row) {
  return ["Available", "Preorder"].includes(productAvailability(p));
}
