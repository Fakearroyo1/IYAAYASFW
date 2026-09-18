import { SignJWT, jwtVerify } from "jose";
import {
  type DB,
  type Row,
  fail,
  first,
  rows,
  str,
  int,
  hash,
  uid,
  stmt,
  guard,
  audit,
  batchAtomic,
} from "../pilot/core";
export {
  type DB,
  type Row,
  fail,
  first,
  rows,
  str,
  int,
  hash,
  uid,
  stmt,
  guard,
  audit,
  batchAtomic,
};
export const GUEST_COOKIE = "__Host-gear-session";
export const RECEIPT_COOKIE = "__Host-gear-receipt";
export const SESSION_SECONDS = 4 * 3600;
export function secretKey(secret?: string) {
  if (!secret || secret.length < 32)
    fail("Gear ordering is temporarily unavailable.", 503);
  return new TextEncoder().encode(secret);
}
export async function signedToken(
  secret: string,
  payload: Row,
  seconds = SESSION_SECONDS,
) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("iyaayasfw-gear")
    .setAudience("gear-storefront")
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + seconds)
    .sign(secretKey(secret));
}
export async function verifiedToken(
  secret: string,
  token: string | null,
  scope: string,
) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), {
      algorithms: ["HS256"],
      issuer: "iyaayasfw-gear",
      audience: "gear-storefront",
    });
    return payload.scope === scope ? (payload as Row) : null;
  } catch {
    return null;
  }
}
export function readCookie(request: Request, name: string) {
  const value = (request.headers.get("cookie") || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(name + "="))
    ?.slice(name.length + 1);
  return value && value.length < 1500 ? value : null;
}
export function cookie(name: string, value: string, maxAge = SESSION_SECONDS) {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
}
export function randomCode() {
  // 60 random bits, grouped for reading aloud. Sessions and receipt keys use
  // their own cryptographic generators; this is only the shared campaign code.
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => alphabet[b & 31])
    .join("").match(/.{4}/g)!.join("-");
}
export function campaignCode(mode: unknown, custom: unknown) {
  if (mode == null || mode === "random") return randomCode();
  if (mode !== "custom") fail("Choose a generated code or your own phrase.");
  const code = str(custom, 64);
  if (!/^[A-Za-z0-9 -]+$/.test(code) || code.replace(/[ -]/g, "").length < 8)
    fail("Use at least 8 letters or numbers. Spaces and hyphens are welcome; keep the code within 64 characters.");
  return code;
}
export const codeHash = (code: string) =>
  hash({
    purpose: "guest-campaign",
    code: code.replace(/[ -]/g, "").toUpperCase(),
  });
export const receiptHash = (code: string) =>
  hash({ purpose: "guest-receipt", code });
export function validateAddress(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("Enter a US shipping address.");
  const b = value as Row,
    address = {
      name: str(b.name, 100),
      line1: str(b.line1, 120),
      line2: str(b.line2 || "", 120),
      city: str(b.city, 80),
      region: str(b.region, 2).toUpperCase(),
      postal: str(b.postal, 10),
      country: "US",
    };
  const states =
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(
      " ",
    );
  if (
    !address.name ||
    !address.line1 ||
    !address.city ||
    !states.includes(address.region) ||
    !/^\d{5}(-\d{4})?$/.test(address.postal) ||
    (b.country && b.country !== "US") ||
    Object.values(address).some((v) => /[\x00-\x1f\x7f]/.test(v))
  )
    fail(
      "Enter a complete domestic US address. Military and international shipping are not enabled.",
    );
  return address;
}
export function shippingQuote(lines: Row[], delivery: string, campaign: Row) {
  if (!["pickup", "shipping"].includes(delivery))
    fail("Choose pickup or shipping.");
  if (lines.some((l) => !l[delivery]))
    fail("One or more selected options do not support this delivery method.");
  if (delivery === "pickup") return 0;
  const subtotal = lines.reduce((n, l) => n + l.price * l.qty, 0);
  if (
    campaign.free_shipping_threshold != null &&
    subtotal >= campaign.free_shipping_threshold
  )
    return 0;
  const first = [...lines].sort(
    (a, b) =>
      b.first_charge - a.first_charge ||
      String(a.key).localeCompare(String(b.key)),
  )[0];
  let charge =
    first.first_charge +
    lines.reduce((n, l) => n + l.additional_charge * l.qty, 0) -
    first.additional_charge;
  if (campaign.shipping_cap != null)
    charge = Math.min(charge, campaign.shipping_cap);
  return int(charge, 0, 100000);
}
export async function sessionFor(db: DB, token: Row | null, open = true) {
  if (!token || typeof token.sid !== "string" || typeof token.cid !== "string")
    fail("Enter your campaign code to continue.", 401);
  const s = await first(
    db,
    `SELECT s.id session_id,c.* FROM guest_sessions s JOIN guest_campaigns c ON c.id=s.campaign_id JOIN guest_settings g ON g.id='main'
    WHERE s.id=? AND s.campaign_id=? AND s.code_version=c.code_version AND s.expires_at>? AND (?=0 OR (g.enabled=1 AND c.active=1 AND c.code_hash IS NOT NULL AND c.starts_at<=? AND c.ends_at>?))`,
    token.sid,
    token.cid,
    Date.now(),
    open ? 1 : 0,
    Date.now(),
    Date.now(),
  );
  if (!s)
    fail(
      "This gear session is no longer available. Enter a current campaign code.",
      401,
    );
  return s;
}
export const sessionStatements = (db: DB, s: Row) => [
  guard(
    db,
    `EXISTS(SELECT 1 FROM guest_sessions s JOIN guest_campaigns c ON c.id=s.campaign_id JOIN guest_settings g ON g.id='main' WHERE s.id=? AND s.expires_at>? AND s.code_version=c.code_version AND c.id=? AND c.version=? AND c.active=1 AND g.enabled=1 AND c.code_hash IS NOT NULL AND c.starts_at<=? AND c.ends_at>?)`,
    s.session_id,
    Date.now(),
    s.id,
    s.version,
    Date.now(),
    Date.now(),
  ),
];
export async function campaignCatalog(db: DB, campaignId: string) {
  return rows(
    db,
    `SELECT ci.product_id,ci.option_id,ci.quantity_limit,p.name,p.detail,p.image,p.tax_bp,p.version product_version,
    d.description,d.images,d.personalization_label,d.personalization_required,d.personalization_max,
    COALESCE(v.label,'') option_label,COALESCE(v.size,'') size,COALESCE(v.color,'') color,
    COALESCE(v.price,p.price) price,COALESCE(v.cost,p.cost) cost,CASE WHEN ci.option_id='' THEN p.stock ELSE v.stock END stock,
    CASE WHEN ci.option_id='' THEN p.preorder ELSE v.preorder END preorder,COALESCE(v.version,0) option_version,
    COALESCE(g.pickup,1) pickup,COALESCE(g.shipping,0) shipping,COALESCE(g.first_charge,0) first_charge,COALESCE(g.additional_charge,0) additional_charge,
    COALESCE(g.version,-1) delivery_version,
    COALESCE((SELECT SUM(i.remaining_qty) FROM guest_orders go JOIN orders o ON o.id=go.order_id JOIN item_balances i ON i.order_id=o.id WHERE go.campaign_id=ci.campaign_id AND o.status<>'void' AND i.product_id=ci.product_id AND COALESCE(i.variant_id,'')=ci.option_id),0) committed
    FROM guest_campaign_items ci JOIN products p ON p.id=ci.product_id LEFT JOIN product_details d ON d.product_id=p.id
    LEFT JOIN product_variants v ON v.id=ci.option_id AND v.product_id=p.id LEFT JOIN gear_delivery g ON g.product_id=p.id AND g.option_id=ci.option_id
    WHERE ci.campaign_id=? AND p.category='Gear' AND p.active=1 AND COALESCE(d.archived,0)=0 AND p.tax_bp IS NOT NULL AND COALESCE(v.price,p.price)>0
    AND ((ci.option_id='' AND NOT EXISTS(SELECT 1 FROM product_variants x WHERE x.product_id=p.id)) OR (v.id IS NOT NULL AND v.active=1))
    ORDER BY p.position,p.name,ci.option_id LIMIT 150`,
    campaignId,
  );
}
export function publicCatalog(items: Row[]) {
  return items.map((p) => ({
    key: p.product_id + ":" + p.option_id,
    productId: p.product_id,
    optionId: p.option_id,
    name: p.name,
    detail: p.detail,
    description: p.description || "",
    image: p.image,
    images: JSON.parse(p.images || "[]"),
    optionLabel: p.option_label,
    size: p.size,
    color: p.color,
    price: p.price,
    preorder: !!p.preorder,
    available: Math.max(
      0,
      Math.min(p.quantity_limit - p.committed, p.preorder ? 30 : p.stock, 30),
    ),
    pickup: !!p.pickup,
    shipping: !!p.shipping,
    firstCharge: p.first_charge,
    additionalCharge: p.additional_charge,
    personalizationLabel: p.personalization_label || "",
    personalizationRequired: !!p.personalization_required,
    personalizationMax: p.personalization_max || 30,
  }));
}
