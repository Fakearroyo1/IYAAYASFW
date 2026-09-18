/** Keep the established amount link; do not depend on undocumented note parameters. */
export function cashAppUrl(cashtag: unknown, amount: number): string | null {
  const tag = String(cashtag || "").replace(/^\$/, "");
  if (
    !/^[A-Za-z][A-Za-z0-9_]{0,29}$/.test(tag) ||
    !Number.isSafeInteger(amount) ||
    amount < 1 ||
    amount > 50000
  )
    return null;
  return `https://cash.app/$${tag}/${(amount / 100).toFixed(2)}`;
}

export function paymentReference(id: string): string {
  return "PAY-" + id.slice(0, 8).toUpperCase();
}

// A draft identifies a future report; creating/opening it never records a payment.
export function paymentDraftId(key: string): string {
  try {
    const existing = sessionStorage.getItem(key);
    if (existing && /^[a-f0-9-]{36}$/.test(existing)) return existing;
  } catch {}
  const id = crypto.randomUUID();
  try {
    sessionStorage.setItem(key, id);
  } catch {}
  return id;
}

export function clearPaymentDraft(key: string, id: string): void {
  try {
    if (sessionStorage.getItem(key) === id) sessionStorage.removeItem(key);
  } catch {}
}
