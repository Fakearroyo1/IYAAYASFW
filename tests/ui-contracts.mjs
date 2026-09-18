// Render the real financial controls without network calls or production data.
import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const require = createRequire(import.meta.url),
  { buildSync } = require(
    require.resolve("esbuild", {
      paths: [require.resolve("wrangler/package.json")],
    }),
  );
const directory = resolve(".sites-runtime/ui-contracts");
mkdirSync(directory, { recursive: true });
for (const entry of ["checkout", "gear-manager", "install-guide"]) {
  buildSync({
    entryPoints: ["app/store/" + entry + ".tsx"],
    outfile: directory + "/" + entry + ".cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    external: ["react", "react-dom"],
    logLevel: "silent",
  });
}
const Checkout = require(directory + "/checkout.cjs").default;
let checks = 0;
const check = (ok, message) => {
  assert.ok(ok, message);
  checks++;
};
const member = { id: "fixture", debt: 2500, credit: 400, tab_limit: 3000 },
  settings = { enabled: true, cashtag: "ExampleSupply", tabReminder: 2000 };
const snack = {
  id: "snack",
  key: "snack",
  name: "Test snack",
  category: "Snacks",
  qty: 1,
  price: 250,
  currentPrice: 250,
  stock: 10,
  active: 1,
  tax_bp: 0,
};
const gear = {
  ...snack,
  id: "shirt",
  key: "shirt",
  name: "Test unit shirt",
  category: "Gear",
  price: 2500,
  currentPrice: 2500,
};
const render = (lines, preferredShop = "snacks") =>
  renderToStaticMarkup(
    React.createElement(Checkout, {
      lines,
      member,
      settings,
      preferredShop,
      busy: false,
      send: async () => true,
      onQuantity: () => {},
      onRemove: () => {},
      onPrice: () => {},
    }),
  );
let html = render([snack]);
check(
  html.includes("Add to my tab") && !html.includes('name="gear-method"'),
  "Snack checkout exposes tab as primary without external payment radios",
);
check(
  html.includes("Use my credit for this purchase") && html.includes("$4.00"),
  "Confirmed credit is visible and optional",
);
check(
  html.includes("Add $2.50 to tab") && html.includes("$27.50"),
  "Snack confirmation states the amount and projected tab",
);
html = render([{ ...snack, qty: 3 }]);
check(
  /type="submit"[^>]*disabled/.test(html),
  "Checkout blocks a tab purchase exceeding the hard cap",
);
html = render([gear], "gear");
check(
  html.includes('name="gear-method"') &&
    html.includes("Cash App") &&
    !html.includes("Add to my tab"),
  "Gear prompts an immediate payment method and cannot use tabs",
);
html = render([snack, gear]);
check(
  html.includes("Each shop checks out separately") &&
    !html.includes("Test unit shirt"),
  "Mixed bag presents a separate snack checkout",
);
html = render([{ ...gear, currentPrice: 2700 }], "gear");
check(
  html.includes("Use $27.00 price") && html.includes("The price changed"),
  "Changed gear price has an explicit acceptance control",
);
check(
  html.includes('aria-label="Remove one Test unit shirt"') &&
    html.includes("Remove</button>"),
  "Mobile checkout includes quantity and remove controls",
);
html = render([{ ...snack, stock: 0 }, gear]);
check(
  html.includes("Test unit shirt") && html.includes('name="gear-method"'),
  "Mixed cart opens a valid shop when the preferred shop is unavailable",
);
html = render([]);
check(
  html.includes("Your bag is empty") && /type="submit"[^>]*disabled/.test(html),
  "Removing the final line leaves a clear empty state",
);
const GearManager = require(directory + "/gear-manager.cjs").default;
html = renderToStaticMarkup(
  React.createElement(GearManager, {
    p: { category: "Gear", variants: [] },
    data: {},
    send: async () => true,
    open: () => {},
    busy: false,
    onBack: () => {},
  }),
);
check(
  html.includes("Save draft") && html.includes("Publish item"),
  "New gear has an explicit draft and publish workflow",
);
check(
  html.includes("Base price") &&
    html.includes("Full description") &&
    html.includes("Upload product photos") &&
    html.includes("Add custom option"),
  "One gear form contains details, media, pricing and options",
);
check(
  !html.includes("Save options") && !html.includes("Save product details"),
  "Gear has no competing section save buttons",
);
const InstallGuide = require(directory + "/install-guide.cjs").default;
html = renderToStaticMarkup(React.createElement(InstallGuide));
check(
  html.includes("Add to home screen"),
  "Account installation control renders without requiring camera access",
);
const css = readFileSync("app/globals.css", "utf8"),
  light = {},
  dark = {};
for (const match of css.matchAll(/:root(\.dark)?\s*\{([^}]+)\}/g))
  for (const v of match[2].matchAll(
    /(--[\w-]+)\s*:\s*(#(?:[\da-f]{6}|[\da-f]{3}))\s*[;}]/gi,
  ))
    (match[1] ? dark : light)[v[1]] = v[2];
const luminance = (hex) =>
  (hex.length === 4
    ? "#" +
      hex
        .slice(1)
        .split("")
        .map((v) => v + v)
        .join("")
    : hex
  )
    .slice(1)
    .match(/../g)
    .map((v) => parseInt(v, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (x + 0.05) / (y + 0.05);
};
for (const [theme, vars] of [
  ["light", light],
  ["dark", { ...light, ...dark }],
])
  for (const [a, b, min] of [
    ["--foreground", "--background", 4.5],
    ["--muted-foreground", "--card", 4.5],
    ["--primary-foreground", "--primary", 4.5],
    ["--warning-fg", "--warning-bg", 4.5],
    ["--error-fg", "--error-bg", 4.5],
    ["--success-fg", "--success-bg", 4.5],
    ["--input", "--card", 3],
  ])
    check(contrast(vars[a], vars[b]) >= min, theme + " " + a + " contrast");
console.log(checks + " checkout control and theme contrast checks passed.");
