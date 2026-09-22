// Browser interactions use real compiled routes and a disposable database.
// Only the synthetic Access provider and network-to-local-Worker transport are fixtures.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { workflowWorker } from "./workflow-worker.mjs";
const require = createRequire(import.meta.url),
  { chromium } = require(
    process.env.WORKFLOW_PLAYWRIGHT_MODULE || "playwright",
  );
const f = await workflowWorker(),
  browser = await chromium.launch({
    headless: true,
    ...(process.env.WORKFLOW_BROWSER_CHANNEL
      ? { channel: process.env.WORKFLOW_BROWSER_CHANNEL }
      : {}),
  }),
  directory = ".sites-runtime/workflow-browser";
mkdirSync(directory, { recursive: true });
let checks = 0;
const errors = [],
  check = (v, label) => {
    assert.ok(v, label);
    checks++;
  };
async function contextFor(person, width = 390) {
  const ctx = await browser.newContext({
    viewport: { width, height: 844 },
    deviceScaleFactor: 1,
  });
  await ctx.route("**/*", f.browserRoute);
  if (person)
    await ctx.addCookies(
      [...person.cookies].map(([name, value]) => ({
        name,
        value,
        domain: person.host,
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
      })),
    );
  return ctx;
}
async function fits(page, label) {
  const sizes = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  check(
    sizes.content <= sizes.viewport + 1,
    label + " does not overflow: " + JSON.stringify(sizes),
  );
}
async function screenshot(page, name) {
  await page.screenshot({
    path: directory + "/" + name + ".png",
    fullPage: true,
  });
}
async function adminMenu(page, label, allTools = false) {
  const nav = page.getByRole("navigation", { name: "Store management" }),
    menu = nav.locator("details"),
    summary = menu.locator("summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  check(
    await menu.evaluate((el) => el.open),
    label + " keyboard opens More tools",
  );
  const geometry = await menu.evaluate((el) => {
    const panel = el.querySelector(":scope > div").getBoundingClientRect(),
      nav = el.closest("nav"),
      bounds = nav.getBoundingClientRect();
    return {
      left: panel.left,
      right: panel.right,
      bottom: panel.bottom,
      navBottom: bounds.bottom,
      clipped: nav.scrollHeight > nav.clientHeight + 1,
      viewport: innerWidth,
    };
  });
  check(
    geometry.left >= 0 &&
      geometry.right <= geometry.viewport + 1 &&
      geometry.bottom <= geometry.navBottom + 1 &&
      !geometry.clipped,
    label +
      " expanded tools stay inside unclipped navigation: " +
      JSON.stringify(geometry),
  );
  await fits(page, label + " expanded tools");
  await screenshot(page, "admin-tools-" + label.replaceAll(" ", "-"));
  const labels = allTools
    ? await menu.getByRole("button").allTextContents()
    : ["Store settings"];
  for (const name of labels) {
    if (!(await menu.evaluate((el) => el.open))) await summary.click();
    const target = menu.getByRole("button", { name, exact: true, includeHidden: true });
    await target.click();
    check(
      !(await menu.evaluate((el) => el.open)),
      label + " selection closes menu: " + name,
    );
    check(
      (await target.getAttribute("aria-current")) === "page",
      label + " navigates to " + name,
    );
    check(
      await summary.evaluate((el) => document.activeElement === el),
      label + " focus returns to More tools",
    );
  }
}
try {
  const publicContext = await contextFor(null, 320),
    landing = await publicContext.newPage();
  await landing.goto("https://test.local/");
  await landing.getByRole("heading", { name: "Unit snack bar." }).waitFor();
  check(
    (await landing
      .getByRole("link", { name: "Sign in", exact: true })
      .count()) === 1,
    "one prominent public sign-in",
  );
  await fits(landing, "320 landing");
  await screenshot(landing, "landing-320-light");
  await publicContext.close();
  const memberContext = await contextFor(f.member),
    member = await memberContext.newPage();
  await member.goto("https://test.local/?view=snacks");
  await member.getByRole("button", { name: "More", exact: true }).waitFor();
  check(
    (await member
      .getByRole("navigation", { name: "Store navigation" })
      .getByRole("button", { name: "Unit gear", exact: true })
      .count()) === 0,
    "gear moved under More",
  );
  await member.getByRole("button", { name: "More", exact: true }).click();
  await member.getByRole("heading", { name: "More", exact: true }).waitFor();
  await fits(member, "390 member More");
  await member.getByRole("button", { name: "Unit gear", exact: true }).click();
  await member
    .getByRole("heading", { name: "Unit gear.", exact: true })
    .waitFor();
  await memberContext.close();
  const ctx = await contextFor(f.admin),
    page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(15000);
  await page.goto("https://admin.test.local/?view=admin&section=inventory");
  await page.getByRole("button", { name: "Add snack item" }).waitFor();
  await page.getByRole("button", { name: "Add snack item" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Product name", { exact: true })
    .fill("Browser energy drink");
  await dialog.getByLabel("Supplier", { exact: true }).fill("Test store");
  await dialog.getByLabel("Units per pack", { exact: true }).fill("24");
  await dialog.getByLabel("Recorded price per pack").fill("44.93");
  await dialog.getByLabel("Selling price ($)", { exact: true }).fill("2.01");
  await dialog.getByLabel("Tax treatment").selectOption("0");
  await dialog.getByLabel("Make available for purchase").check();
  await screenshot(page, "product-390-light");
  await fits(page, "390 product editor");
  await dialog
    .getByRole("button", { name: "Save product & purchase defaults" })
    .click();
  await dialog.waitFor({ state: "hidden" });
  const product = await f.one(
    "SELECT * FROM products WHERE name='Browser energy drink'",
  );
  check(
    product?.price === 225 && product.active === 1,
    "browser publishes product with rounded price in one action",
  );
  check(
    (
      await f.one(
        "SELECT units_per_pack FROM purchase_options WHERE product_id=?",
        product.id,
      )
    ).units_per_pack === 24,
    "shared purchase defaults saved",
  );
  await page
    .getByRole("navigation", { name: "Store management" })
    .getByRole("button", { name: "Money", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Check balances", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Check balances", exact: true })
    .click();
  const checksForm = page.locator("form").filter({
    has: page.getByRole("heading", { name: "Check balances", exact: true }),
  });
  const amounts = checksForm.getByLabel(
    "Observed amount ($, blank if unchecked)",
    { exact: true },
  );
  await amounts.nth(0).fill("200");
  await amounts.nth(1).fill("300");
  const observed = new Date(Date.now() - 60000),
    stamp = new Date(observed.getTime() - observed.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 19);
  for (const field of await checksForm
    .getByLabel("Observed at (local time)", { exact: true })
    .all())
    await field.fill(stamp);
  for (const checkbox of await checksForm
    .getByLabel("All activity after this check")
    .all())
    await checkbox.check();
  await checksForm.getByLabel("Second checker").fill("Synthetic reviewer");
  await checksForm.getByRole("button", { name: "Save balance checks" }).click();
  await page.getByText("$500.00", { exact: true }).first().waitFor();
  check(
    (await f.one("SELECT COUNT(*) n FROM money_observations")).n === 2,
    "browser saves shared account checks",
  );
  await screenshot(page, "money-390-light");
  await fits(page, "390 Money");
  await page
    .getByRole("navigation", { name: "Store management" })
    .getByRole("button", { name: "Restock", exact: true })
    .click();
  await page
    .getByLabel("Run name", { exact: true })
    .fill("Browser shopping trip");
  const card = page.locator("article").filter({
    has: page.getByRole("heading", {
      name: "Browser energy drink",
      exact: true,
    }),
  });
  await card.getByLabel("Add to run").check();
  await card.getByLabel("Packs", { exact: true }).fill("2");
  await screenshot(page, "plan-390-light");
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await page
    .getByRole("button", { name: "Start shopping", exact: true })
    .waitFor();
  let run = await f.one(
    "SELECT * FROM restock_runs WHERE name='Browser shopping trip'",
  );
  check(!!run, "browser saved durable plan");
  await page.reload();
  await page
    .getByRole("button", { name: "Start shopping", exact: true })
    .waitFor();
  check(true, "saved run resumes after reload");
  await page
    .getByRole("button", { name: "Start shopping", exact: true })
    .click();
  const line = page.locator("article").filter({
    has: page.getByRole("heading", {
      name: "Browser energy drink",
      exact: true,
    }),
  });
  await line.getByLabel("Item status").selectOption("grabbed");
  await line.getByRole("button", { name: "Save item", exact: true }).click();
  await page
    .getByText("Finish purchase · record a receipt", { exact: true })
    .click();
  const receipt = page
    .locator("form")
    .filter({ has: page.getByLabel("Total on receipt ($)", { exact: true }) });
  await receipt.getByLabel("Supplier", { exact: true }).fill("Test store");
  await receipt
    .getByLabel("Receipt reference", { exact: true })
    .fill("BROWSER-RECEIPT");
  await receipt
    .getByLabel("Total on receipt ($)", { exact: true })
    .fill("89.86");
  await receipt
    .getByLabel("Activity account used", { exact: true })
    .selectOption("cashapp");
  await receipt.getByLabel("I rechecked the shared charges").check();
  f.dropNextResponse("runPurchase");
  await receipt
    .getByRole("button", { name: "Finish purchase & stock" })
    .click();
  await page.getByRole("button", { name: "Retry the same action" }).waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button")].some(
      (b) => b.textContent === "Retry the same action" && !b.disabled,
    ),
  );
  check(
    (
      await f.one(
        "SELECT COUNT(*) n FROM purchase_receipts WHERE run_id=?",
        run.id,
      )
    ).n === 1,
    "purchase committed before simulated response loss",
  );
  await page.reload();
  await page.getByRole("button", { name: "Retry the same action" }).click();
  await page.getByText("Receipt · BROWSER-RECEIPT", { exact: true }).waitFor();
  check(
    (await f.one("SELECT stock FROM products WHERE id=?", product.id)).stock ===
      48,
    "reload/retry stocks once",
  );
  check(
    (
      await f.one(
        "SELECT COUNT(*) n FROM money_movements WHERE source_type='receipt'",
      )
    ).n === 1,
    "reload/retry charges account once",
  );
  const funds = await (
    await f.request(f.admin, "/api/workflows?view=money")
  ).json();
  check(
    funds.funds === 41014,
    "balance checks roll forward after a subsequent purchase",
  );
  await screenshot(page, "completed-run-390-light");
  await fits(page, "390 completed run");

  await page
    .getByRole("navigation", { name: "Store management" })
    .getByRole("button", { name: "Money", exact: true })
    .click();
  await page
    .getByLabel("Record activity", { exact: true })
    .selectOption("expense");
  const expense = page.locator("form").filter({
    has: page.getByRole("heading", { name: "Activity expense", exact: true }),
  });
  await expense
    .getByLabel("Actual activity account", { exact: true })
    .selectOption("cashapp");
  await expense.getByLabel("Amount ($)", { exact: true }).fill("1");
  await expense
    .getByLabel("Reference / reason", { exact: true })
    .fill("Session renewal synthetic check");
  await f.run(
    "UPDATE auth_sessions SET expires_at=? WHERE member_id='owner'",
    Date.now() - 1,
  );
  await expense
    .getByRole("button", { name: "Save record", exact: true })
    .click();
  await page
    .getByText("Administrator session expired.", { exact: false })
    .waitFor();
  check(
    (
      await f.one(
        "SELECT COUNT(*) n FROM expenses WHERE description='Session renewal synthetic check'",
      )
    ).n === 0,
    "expired session leaves no expense",
  );
  await f.context(f.admin);
  check(
    (await f.request(f.admin, "/identity/api", { action: "adminLogin" })).ok,
    "renew admin session through real compiled Access login",
  );
  await f.context(f.admin);
  await ctx.addCookies(
    [...f.admin.cookies].map(([name, value]) => ({
      name,
      value,
      domain: f.admin.host,
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    })),
  );
  await page.reload();
  await page.getByRole("button", { name: "Retry the same action" }).click();
  await page
    .getByRole("button", { name: "Retry the same action" })
    .waitFor({ state: "hidden" });
  check(
    (
      await f.one(
        "SELECT COUNT(*) n FROM expenses WHERE description='Session renewal synthetic check'",
      )
    ).n === 1,
    "saved action resumes exactly once after session renewal",
  );
  await page
    .getByRole("navigation", { name: "Store management" })
    .getByRole("button", { name: "Members", exact: true })
    .click();
  await page.getByRole("button", { name: /Synthetic member/ }).click();
  await page
    .getByRole("button", { name: "Edit account & purchasing permissions" })
    .waitFor();
  await page
    .getByRole("button", { name: "Sign-in & access", exact: true })
    .click();
  await screenshot(page, "member-access-390-light");
  await fits(page, "390 member access");
  await page
    .getByRole("button", { name: "Back to members", exact: false })
    .click();
  await page.getByRole("button", { name: "CSV import", exact: true }).click();
  await page.getByText("Paste or inspect CSV text", { exact: true }).click();
  await page
    .getByLabel("CSV rows", { exact: true })
    .fill(
      "display_name,email,access_enabled\nMobile import,mobile-import@gmail.com,TRUE\nBroken row,not-an-email,TRUE",
    );
  await page
    .getByRole("button", { name: "Preview new members", exact: true })
    .click();
  await page.getByText("Needs correction", { exact: true }).waitFor();
  check(
    await page.getByLabel("Apply row 2", { exact: true }).isDisabled(),
    "invalid row cannot be selected",
  );
  check(
    await page.getByLabel("Apply row 1", { exact: true }).isChecked(),
    "valid new member is selected",
  );
  await screenshot(page, "csv-review-390-light");
  await fits(page, "390 CSV review");
  for (const width of [320, 390, 430, 1280])
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((theme) => {
        localStorage.setItem("supply-theme", theme);
        document.documentElement.classList.toggle("dark", theme === "dark");
        document.documentElement.dataset.theme = theme;
      }, theme);
      await page.goto("https://admin.test.local/?view=admin&section=members");
      await page
        .getByRole("button", { name: "CSV import", exact: true })
        .click();
      await page.getByText("Needs correction", { exact: true }).waitFor();
      await fits(page, width + " CSV " + theme);
      await screenshot(page, "csv-" + width + "-" + theme);
      await page.goto("https://admin.test.local/?view=admin&section=money");
      await page.getByRole("heading", { name: "Money", exact: true }).waitFor();
      await page
        .getByText("Activity assets & annual reporting", { exact: true })
        .waitFor();
      await fits(page, width + " Money " + theme);
      await screenshot(page, "money-" + width + "-" + theme);
      await adminMenu(
        page,
        width + " " + theme,
        width === 390 && theme === "dark",
      );
    }
  await page.setViewportSize({ width: 780, height: 900 });
  await page.evaluate(() => (document.documentElement.style.zoom = "2"));
  await adminMenu(page, "200-percent zoom");
  await fits(page, "200% zoom Money");
  await page.keyboard.press("Tab");
  check(
    await page.evaluate(() => document.activeElement !== document.body),
    "keyboard focus reaches a control",
  );
  check(
    errors.length === 0,
    "no browser runtime errors: " + JSON.stringify(errors),
  );
  check(f.outbound() === 0, "browser sent no real provider traffic");
  const report = {
    suite: "workflow-browser",
    checks,
    engine: await browser.version(),
    widths: [320, 390, 430, 1280],
    themes: ["light", "dark"],
    zoom: "200%",
    runtime:
      "real compiled routes and isolated D1; signed synthetic Access; no production data",
    screenshots: directory,
    passedAt: new Date().toISOString(),
  };
  writeFileSync(directory + "/evidence.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await ctx.close();
} catch (e) {
  for (const ctx of browser.contexts())
    for (const page of ctx.pages())
      try {
        await screenshot(page, "failure");
        writeFileSync(directory + "/failure.html", await page.content());
      } catch {}
  throw e;
} finally {
  await browser.close();
  await f.close();
}
