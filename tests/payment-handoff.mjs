import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const require = createRequire(import.meta.url);
const { buildSync } = require(require.resolve("esbuild", { paths: [require.resolve("wrangler/package.json")] }));
const out = path.resolve(".sites-runtime/payment-handoff");
fs.mkdirSync(out, { recursive: true });
for (const [source, target] of [["lib/cashapp.ts", "cashapp"], ["app/store/payment-forms.tsx", "forms"]])
  buildSync({ entryPoints: [source], outfile: out + "/" + target + ".cjs", bundle: true, platform: "node", format: "cjs", jsx: "automatic", external: ["react", "react-dom"], logLevel: "silent" });
const { cashAppUrl, paymentReference, paymentDraftId, clearPaymentDraft } = require(out + "/cashapp.cjs");
const { CashAppHandoff } = require(out + "/forms.cjs");
const store = new Map();
globalThis.sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
assert.equal(cashAppUrl("$UnitSupply", 2001), "https://cash.app/$UnitSupply/20.01");
for (const amount of [0, -1, 12.3, NaN, Infinity, 50001]) assert.equal(cashAppUrl("UnitSupply", amount), null);
for (const tag of ["evil/path", "Unit?note=oops", "javascript:alert(1)", ""]) assert.equal(cashAppUrl(tag, 2000), null);
assert.equal(new URL(cashAppUrl("UnitSupply", 2000)).search, "", "No unsupported note query parameter is invented");
const id = paymentDraftId("member-1");
assert.equal(paymentDraftId("member-1"), id, "Reopening preserves the displayed payment reference");
assert.notEqual(paymentDraftId("member-2"), id, "Members have separate references");
assert.equal(paymentReference(id), "PAY-" + id.slice(0, 8).toUpperCase());
clearPaymentDraft("member-1", "another-id");
assert.equal(paymentDraftId("member-1"), id, "An older response cannot clear a newer draft");
clearPaymentDraft("member-1", id);
assert.notEqual(paymentDraftId("member-1"), id, "A completed report starts a new payment reference next time");
const html = renderToStaticMarkup(React.createElement(CashAppHandoff, { cashtag: "$UnitSupply", amount: 2001, reference: paymentReference(id) }));
assert.match(html, /Copy reference &amp; open Cash App/);
assert.match(html, /\$20\.01/);
assert.match(html, /does not record or confirm a payment/);
assert.doesNotMatch(html, /type="submit"/);

// Run the shipped guest script against a tiny DOM and browser API harness. No
// requests reach a server; the copied reference, popup fallback, and read-only
// handoff behavior are exercised using the actual event handlers.
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.attrs = {}; this.hidden = false; }
  setAttribute(k, v) { this.attrs[k] = v; if (k === "hidden") this.hidden = true; }
  append(...children) { this.children.push(...children); }
  addEventListener(k, fn) { this.events[k] = fn; }
  querySelector(tag) { return this.children.find((n) => n.tag === tag) || this.children.map((n) => n.querySelector?.(tag)).find(Boolean); }
  select() {}
}
let copies = [], navigated = [], opened = 0, mode = "ok", requests = 0;
const root = new Element("main"),
  context = vm.createContext({
    console, Intl, URL, AbortController, Map, Set, Date, JSON, Array, Number, String,
    Node: Element, crypto: webcrypto, sessionStorage,
    document: { querySelector: () => root, createElement: (tag) => new Element(tag), createTextNode: (text) => ({ text }), documentElement: { dataset: {} } },
    matchMedia: () => ({ matches: false }),
    setTimeout: () => 1, clearTimeout: () => {},
    fetch: () => { requests++; return new Promise(() => {}); },
    window: { open: (url) => { opened++; if (mode === "blocked") return null; navigated.push(url); return { opener: true }; } },
    navigator: { clipboard: { writeText: async (text) => { if (mode === "denied") throw Error("Clipboard denied"); copies.push(text); } } },
  });
vm.runInContext(fs.readFileSync("gear/public/gear.js", "utf8"), context);
vm.runInContext("data = { campaign: { name: 'Gear', endsAt: 123 }, settings: { cashtag: 'UnitSupply' }, orders: [] };", context);
const guestId = vm.runInContext("checkoutDraftId()", context);
assert.equal(vm.runInContext("checkoutDraftId()", context), guestId);
vm.runInContext(`data.orders = [{id: ${JSON.stringify(guestId)}}]`, context);
assert.notEqual(vm.runInContext("checkoutDraftId()", context), guestId, "An existing order cannot be reused for a second checkout");
for (const scenario of ["ok", "blocked", "denied"]) {
  mode = scenario;
  const panel = vm.runInContext("cashAppHandoff(2001, 'GEAR-12345678-123')", context);
  await panel.querySelector("button").events.click();
  assert.equal(requests, 1, "Opening Cash App never reports a payment or submits an order");
  assert.equal(panel.querySelector("button").disabled, false);
  if (scenario !== "ok") assert.equal(panel.children.at(-1).hidden, false, "Manual copy/open is available when browser capabilities are restricted");
}
assert.deepEqual(copies, ["GEAR-12345678-123", "GEAR-12345678-123"]);
assert.deepEqual(navigated, ["https://cash.app/$UnitSupply/20.01"]);
assert.equal(opened, 2, "Clipboard denial does not open Cash App without a copied reference");
console.log("Payment handoff: stable references, amount links, no payment mutation, and browser fallbacks passed.");
