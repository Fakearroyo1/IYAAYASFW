"use strict";
const app = document.querySelector("#app"),
  dialog = document.querySelector("#details"),
  detail = document.querySelector("#detail-body");
const money = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n / 100,
  );
let data = null,
  bag = [],
  quote = null,
  pending = null,
  submitting = false,
  storeOpen = true;
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "checked") n.checked = v;
    else n.setAttribute(k, String(v));
  }
  for (const c of children.flat())
    if (c != null)
      n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}
const clear = () => app.replaceChildren();
function field(label, name, type = "text", value = "", required = true) {
  return el(
    "label",
    {},
    label,
    el("input", { name, type, value, ...(required ? { required: "" } : {}) }),
  );
}
// Optional fields must not carry a required attribute.
function optional(label, name, value = "") {
  const f = field(label, name, "text", value);
  f.querySelector("input").removeAttribute("required");
  return f;
}
async function api(path, body) {
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const r = await fetch(path, {
      ...(body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
      cache: "no-store",
      signal: controller.signal,
    });
    const j = await r.json();
    if (!r.ok)
      throw Object.assign(Error(j.error || "Try again."), { status: r.status });
    return j;
  } finally {
    clearTimeout(timeout);
  }
}
function errorNode() {
  return el("p", { class: "error", role: "alert" });
}
function imageUrl(path) {
  if (typeof path !== "string") return null;
  const match = path.match(/^\/api\/product-images\?id=([a-f0-9-]{36})$/);
  return match ? "/media?id=" + match[1] : null;
}
function entry(message = "") {
  clear();
  document.querySelector("#signout").hidden = true;
  data = null;
  bag = [];
  pending = null;
  const error = errorNode(),
    form = el(
      "form",
      { class: "panel entry" },
      el("h1", {}, "Gear for the team."),
      el(
        "p",
        { class: "muted" },
        "Enter the campaign code shared by your organizer.",
      ),
      field("Campaign code", "code"),
      el("button", { class: "primary", type: "submit" }, "Open gear shop"),
      error,
    );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      await api("/api/entry", { code: new FormData(form).get("code") });
      await load();
    } catch (e) {
      error.textContent = e.message;
    } finally {
      button.disabled = false;
    }
  });
  if (message) error.textContent = message;
  if (!storeOpen)
    form.replaceChildren(
      el("h1", {}, "Gear ordering is currently closed."),
      el(
        "p",
        { class: "muted" },
        "Your organizer will let you know when the next campaign opens. Existing receipts remain available below.",
      ),
    );
  const recover = el(
    "details",
    { class: "panel entry" },
    el("summary", {}, "Already ordered? Find your receipt"),
  );
  const rf = el(
      "form",
      {},
      field("Order reference", "code"),
      field("Private receipt key", "secret"),
      el("button", { type: "submit" }, "Open receipt"),
    ),
    re = errorNode();
  rf.append(re);
  rf.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await api("/api/resume", Object.fromEntries(new FormData(rf)));
      await showReceipt(r.orderId);
    } catch (e) {
      re.textContent = e.message;
    }
  });
  recover.append(rf);
  app.append(form, recover);
}
async function load() {
  data = await api("/api/catalog");
  document.querySelector("#signout").hidden = false;
  shop();
}
function showProduct(p) {
  detail.replaceChildren(
    el("h2", {}, p.name),
    el("p", { class: "muted" }, p.optionLabel),
    el(
      "p",
      {},
      p.description || p.detail || "Unit gear, selected for this campaign.",
    ),
    el("p", { class: "price" }, money(p.price)),
  );
  const gallery = el("div", { class: "gallery" });
  for (const path of [p.image, ...p.images]) {
    const src = imageUrl(path);
    if (src) gallery.append(el("img", { src, alt: p.name, loading: "lazy" }));
  }
  detail.append(
    gallery,
    el(
      "p",
      {},
      p.preorder
        ? "Preorder: your organizer will provide the pickup or shipping timeline."
        : "Stocked item.",
    ),
    el("p", {}, data.campaign.pickupNote || ""),
  );
  dialog.showModal();
}
function shop() {
  clear();
  app.append(
    el("h1", {}, data.campaign.name),
    el("p", { class: "muted" }, data.campaign.description),
  );
  const grid = el("section", { class: "grid", "aria-label": "Campaign gear" }),
    aside = el("aside", { class: "panel bag", "aria-label": "Your bag" });
  for (const p of data.items) {
    const src = imageUrl(p.image),
      tile = el("article", { class: "tile" }),
      image = el(
        "button",
        {
          type: "button",
          class: "image",
          onclick: () => showProduct(p),
          "aria-label": "Details for " + p.name,
        },
        src
          ? el("img", { src, alt: p.name, loading: "lazy" })
          : el("span", { class: "placeholder" }, "Unit Gear"),
      );
    const qty = el("input", {
        type: "number",
        min: 1,
        max: Math.max(1, p.available),
        value: 1,
        "aria-label": "Quantity for " + p.name,
      }),
      personal = el("input", {
        type: "text",
        maxlength: p.personalizationMax,
        "aria-label": p.personalizationLabel || "Personalization",
      }),
      error = errorNode();
    const add = el(
      "button",
      {
        type: "button",
        class: "primary",
        onclick: () => {
          const count = Number(qty.value);
          if (!Number.isInteger(count) || count < 1) {
            error.textContent = "Enter a whole-number quantity.";
            return;
          }
          if (p.personalizationRequired && !personal.value.trim()) {
            error.textContent = "Enter " + p.personalizationLabel + ".";
            return;
          }
          const used = bag
            .filter((x) => x.key === p.key)
            .reduce((n, x) => n + x.qty, 0);
          if (used + count > p.available) {
            error.textContent = "This quantity is not available.";
            return;
          }
          const existing = bag.find(
            (x) =>
              x.key === p.key && x.personalization === personal.value.trim(),
          );
          if (existing) existing.qty += count;
          else
            bag.push({
              ...p,
              qty: count,
              personalization: personal.value.trim(),
            });
          quote = null;
          error.textContent = "";
          drawBag(aside);
        },
      },
      p.available ? "Add to bag" : "Unavailable",
    );
    add.disabled = !p.available;
    tile.append(
      image,
      el("h3", {}, p.name),
      el("p", { class: "muted" }, p.optionLabel || "Standard"),
      el("p", { class: "price" }, money(p.price)),
      el("small", {}, p.preorder ? "Preorder" : p.available + " available"),
      el("label", {}, "Quantity", qty),
    );
    if (p.personalizationLabel)
      tile.append(el("label", {}, p.personalizationLabel, personal));
    tile.append(add, error);
    grid.append(tile);
  }
  if (!data.items.length)
    grid.append(el("p", {}, "No gear is available in this campaign yet."));
  app.append(el("div", { class: "layout" }, grid, aside));
  drawBag(aside);
  if (data.orders?.length)
    app.append(
      el(
        "section",
        { class: "panel history-panel" },
        el("h2", {}, "Your recent orders"),
        ...data.orders.map((o) =>
          el(
            "button",
            { type: "button", onclick: () => showReceipt(o.id) },
            o.code + " · " + o.state.replaceAll("_", " "),
          ),
        ),
      ),
    );
}
function drawBag(aside) {
  aside.replaceChildren(el("h2", {}, "Your bag"));
  if (!bag.length) {
    aside.append(el("p", { class: "muted" }, "Choose gear to get started."));
    return;
  }
  for (const [index, p] of bag.entries())
    aside.append(
      el(
        "div",
        { class: "line" },
        el(
          "div",
          {},
          el("p", {}, p.qty + " × " + p.name),
          el(
            "small",
            {},
            [p.optionLabel, p.personalization].filter(Boolean).join(" · "),
          ),
          el("p", {}, money(p.qty * p.price)),
        ),
        el(
          "button",
          {
            type: "button",
            "aria-label": "Remove " + p.name,
            onclick: () => {
              bag.splice(index, 1);
              quote = null;
              drawBag(aside);
            },
          },
          "Remove",
        ),
      ),
    );
  aside.append(
    el(
      "p",
      { class: "total" },
      "Items " + money(bag.reduce((n, p) => n + p.price * p.qty, 0)),
    ),
    el(
      "button",
      { type: "button", class: "primary", onclick: checkout },
      "Continue to checkout",
    ),
  );
}
function checkout() {
  clear();
  const form = el("form", { class: "panel receipt" }),
    error = errorNode(),
    totals = el("div", { class: "notice" }),
    address = el("div", { hidden: "" }),
    pickupNote = el("p", { class: "muted" }, data.campaign.pickupNote || ""),
    delivery = el(
      "select",
      { name: "delivery" },
      el("option", { value: "pickup" }, "Free pickup"),
      el("option", { value: "shipping" }, "Ship within the US"),
    );
  if (!bag.every((p) => p.pickup))
    delivery.querySelector("[value=pickup]").disabled = true;
  if (!bag.every((p) => p.shipping))
    delivery.querySelector("[value=shipping]").disabled = true;
  if (delivery.options[0].disabled) delivery.value = "shipping";
  const states =
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(
      " ",
    );
  address.append(
    field("Recipient name", "addressName"),
    field("Street address", "line1"),
    optional("Apartment / suite", "line2"),
    field("City", "city"),
    el(
      "div",
      { class: "row" },
      el(
        "label",
        {},
        "State",
        el(
          "select",
          { name: "region", required: "" },
          el("option", { value: "" }, "Choose state"),
          ...states.map((s) => el("option", { value: s }, s)),
        ),
      ),
      field("ZIP code", "postal"),
    ),
  );
  const method = el(
      "select",
      { name: "method" },
      el("option", { value: "cash" }, "Cash"),
      ...(data.settings?.cashtag
        ? [el("option", { value: "cashapp" }, "Cash App")]
        : []),
    ),
    instructions = el("p", { class: "notice" });
  const updateInstructions = () =>
    (instructions.textContent =
      method.value === "cashapp"
        ? "Send the exact total to " +
          data.settings.cashtag +
          ". Your organizer will verify receipt."
        : data.settings?.cash_instructions ||
          "Give cash to your organizer before reporting this payment.");
  method.addEventListener("change", updateInstructions);
  updateInstructions();
  const submit = el(
    "button",
    { class: "primary", type: "submit" },
    "Report payment & place order",
  );
  let quoteSequence = 0;
  async function updateQuote() {
    const sequence = ++quoteSequence;
    quote = null;
    error.textContent = "";
    submit.disabled = true;
    address.hidden = delivery.value !== "shipping";
    pickupNote.hidden = delivery.value !== "pickup";
    for (const f of address.querySelectorAll("input,select"))
      f.disabled = address.hidden;
    try {
      const nextQuote = await api("/api/quote", {
        items: bag.map((p) => ({
          productId: p.productId,
          optionId: p.optionId,
          qty: p.qty,
          personalization: p.personalization,
        })),
        delivery: delivery.value,
      });
      if (sequence !== quoteSequence) return;
      quote = nextQuote;
      totals.replaceChildren(
        el("p", {}, "Items " + money(quote.subtotal)),
        el("p", {}, "Shipping " + money(quote.shipping)),
        el("p", { class: "total" }, "Total " + money(quote.total)),
        el("small", {}, "Includes " + money(quote.tax) + " tax."),
      );
      submit.disabled = false;
    } catch (e) {
      if (sequence === quoteSequence) error.textContent = e.message;
    }
  }
  delivery.addEventListener("change", updateQuote);
  form.append(
    el("button", { type: "button", onclick: shop }, "Back to bag"),
    el("h1", {}, "Checkout"),
    field("Your name", "name"),
    field("Email for order contact", "email", "email"),
    el("label", {}, "Delivery", delivery),
    address,
    pickupNote,
    totals,
    el("label", {}, "Payment method", method),
    instructions,
    el(
      "label",
      { class: "check" },
      el("input", { type: "checkbox", name: "reported", required: "" }),
      "I have made this payment. I understand it is pending administrator confirmation.",
    ),
    el(
      "p",
      { class: "muted" },
      "Unconfirmed reservations expire after " +
        data.campaign.reservationHours +
        " hours. Save your private receipt key after ordering.",
    ),
    submit,
    error,
  );
  app.append(form);
  void updateQuote();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting || !quote) return;
    submitting = true;
    submit.disabled = true;
    error.textContent = "";
    if (!pending) {
      const f = Object.fromEntries(new FormData(form)),
        secret = Array.from(crypto.getRandomValues(new Uint8Array(24)), (n) =>
          n.toString(16).padStart(2, "0"),
        )
          .join("")
          .toUpperCase();
      pending = {
        requestId: crypto.randomUUID(),
        receiptSecret: secret,
        items: bag.map((p) => ({
          productId: p.productId,
          optionId: p.optionId,
          qty: p.qty,
          personalization: p.personalization,
        })),
        delivery: f.delivery,
        name: f.name,
        email: f.email,
        method: f.method,
        paymentReported: true,
        expectedTotal: quote.total,
        ...(f.delivery === "shipping"
          ? {
              address: {
                name: f.addressName,
                line1: f.line1,
                line2: f.line2,
                city: f.city,
                region: f.region,
                postal: f.postal,
                country: "US",
              },
            }
          : {}),
      };
    }
    try {
      const result = await api("/api/orders", pending),
        secret = pending.receiptSecret;
      pending = null;
      bag = [];
      renderReceipt(result, secret);
    } catch (e) {
      error.textContent =
        e.message +
        " " +
        (e.status && e.status < 500
          ? "Review the order before trying again."
          : "Keep this page open. Retry sends the same order safely.");
      if (e.status && e.status < 500) pending = null;
    } finally {
      submitting = false;
      submit.disabled = false;
    }
  });
}
async function showReceipt(id) {
  try {
    renderReceipt(await api("/api/receipt?id=" + encodeURIComponent(id)));
  } catch (e) {
    entry(e.message);
  }
}
function renderReceipt(result, secret) {
  clear();
  const o = result.order,
    panel = el(
      "section",
      { class: "panel receipt" },
      el("h1", {}, "Your gear order"),
      el("p", { class: "secret" }, o.code),
      el("p", { class: "notice" }, o.state.replaceAll("_", " ")),
      el("p", { class: "total" }, money(o.total)),
    );
  if (o.refunded > 0)
    panel.append(
      el(
        "p",
        { class: "notice" },
        money(o.refunded) +
          " refunded / returned. Original order " +
          money(o.original_total) +
          ".",
      ),
    );
  for (const i of result.items.filter((i) => i.qty > 0))
    panel.append(
      el(
        "div",
        { class: "line" },
        el("p", {}, i.qty + " × " + i.name),
        el(
          "small",
          {},
          [i.variant_label, i.personalization].filter(Boolean).join(" · "),
        ),
      ),
    );
  if (o.payment_status === "pending")
    panel.append(
      el(
        "p",
        {},
        "Payment reported. Your organizer must confirm it before fulfillment.",
      ),
      el(
        "p",
        { class: "muted" },
        "Reservation expires " +
          new Date(o.reservation_expires).toLocaleString() +
          ".",
      ),
    );
  if (o.delivery === "pickup")
    panel.append(
      el("p", {}, o.pickup_note || "Your organizer will arrange pickup."),
    );
  if (o.tracking) panel.append(el("p", {}, o.carrier + " · " + o.tracking));
  if (secret)
    panel.append(
      el(
        "div",
        { class: "notice" },
        el("h2", {}, "Save your receipt key"),
        el(
          "p",
          {},
          "Keep this key private. Use it with your order reference to reopen this receipt.",
        ),
        el("p", { class: "secret" }, secret),
      ),
    );
  panel.append(
    el(
      "a",
      { href: "mailto:snackbar@iyaayasfw.com" },
      "Contact your organizer",
    ),
    el("p", {}),
    el(
      "button",
      { type: "button", onclick: () => load().catch((e) => entry(e.message)) },
      "Return to gear shop",
    ),
  );
  app.append(panel);
}
document
  .querySelector("#close-details")
  .addEventListener("click", () => dialog.close());
document.querySelector("#signout").addEventListener("click", async () => {
  await api("/api/signout", {});
  entry();
});
document.querySelector("#theme").addEventListener("click", () => {
  document.documentElement.dataset.theme =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
});
if (matchMedia("(prefers-color-scheme: dark)").matches)
  document.documentElement.dataset.theme = "dark";
api("/api/status")
  .then((s) => {
    storeOpen = s.open;
    if (!storeOpen) {
      entry();
      return;
    }
    return load();
  })
  .catch((e) => entry(e.status === 401 ? "" : e.message));
