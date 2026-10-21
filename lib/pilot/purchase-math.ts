// Monetary inputs are integer cents; pack quantities are whole units. Keep the
// receipt total exact. Display unit costs at four decimal dollars, not as a
// replacement for the exact line total or the historical sale cost.
export type EstimateLine = {
  planned_packs: number;
  planned_pack_units: number;
  planned_pack_price: number | null;
  price_at: number | null;
  price_kind: string;
  state?: string;
  actual_packs?: number | null;
  actual_pack_units?: number | null;
  actual_pack_price?: number | null;
  line_discount?: number;
};
export function estimateRun(
  lines: EstimateLine[],
  charges: number | null,
  discount = 0,
  freshDays = 30,
  now = Date.now(),
) {
  const selected = lines.filter(
    (l) => !["skipped", "purchased"].includes(l.state || ""),
  );
  let units = 0,
    knownSubtotal = 0,
    priced = 0,
    stale = 0;
  for (const l of selected) {
    const actual = l.actual_packs != null && l.actual_pack_units != null,
      packs = actual ? l.actual_packs! : l.planned_packs,
      packUnits = actual ? l.actual_pack_units! : l.planned_pack_units,
      price = actual ? l.actual_pack_price : l.planned_pack_price;
    units += packs * packUnits;
    if (price != null) {
      priced++;
      knownSubtotal += packs * price - (actual ? l.line_discount || 0 : 0);
    }
    if (
      !actual &&
      price != null &&
      (!l.price_at || now - l.price_at > freshDays * 86400000)
    )
      stale++;
  }
  const complete = priced === selected.length,
    total =
      selected.length === 0
        ? 0
        : complete && charges !== null && knownSubtotal + charges >= discount
          ? knownSubtotal + charges - discount
          : null;
  return {
    units,
    knownSubtotal,
    priced,
    items: selected.length,
    complete,
    stale,
    charges,
    discount,
    total,
    basis: !complete
      ? "Known subtotal"
      : charges === null
        ? "Before tax/fees"
        : "Estimated total",
  };
}
// Largest remainder allocation is deterministic (stable input IDs/order), sums
// exactly to the receipt, and cannot create a negative line from a discount.
export function allocateReceipt(amounts: number[], netCharges: number) {
  const sum = amounts.reduce((a, b) => a + b, 0);
  if (
    !amounts.length ||
    amounts.some((n) => !Number.isSafeInteger(n) || n < 0) ||
    !Number.isSafeInteger(netCharges) ||
    sum + netCharges < 0
  )
    throw Error("Receipt totals do not reconcile.");
  const weights = sum ? amounts : amounts.map(() => 1),
    denominator = sum || amounts.length;
  const exact = weights.map((w) => ((sum + netCharges) * w) / denominator),
    totals = exact.map(Math.floor);
  let remainder = sum + netCharges - totals.reduce((a, b) => a + b, 0);
  const order = exact
    .map((n, i) => ({ i, remainder: n - totals[i] }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  for (const { i } of order) {
    if (!remainder) break;
    totals[i]++;
    remainder--;
  }
  return totals.map((total, i) => ({ total, charges: total - amounts[i] }));
}
export function proportionalReceiptCost(
  total: number,
  units: number,
  previous: number,
  added: number,
) {
  return (
    Math.round((total * (previous + added)) / units) -
    Math.round((total * previous) / units)
  );
}
