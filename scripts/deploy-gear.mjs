import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const id = process.env.CLOUDFLARE_D1_DATABASE_ID;
if (id !== "ed7e63c8-77fd-4314-ab35-131c061e016a")
  throw Error(
    "Set CLOUDFLARE_D1_DATABASE_ID to the established production database.",
  );
const config = JSON.parse(readFileSync("gear/wrangler.json", "utf8"));
if (config.name !== "iyaayasfw-gear")
  throw Error("Unexpected gear Worker name.");
config.d1_databases[0].database_id = id;
writeFileSync("gear/wrangler.deploy.json", JSON.stringify(config, null, 2));
const wrangler = fileURLToPath(
  new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
);
// Run in the gear Worker's own build. Never bypass the build-to-Worker identity check.
for (const args of [
  [
    "d1",
    "execute",
    "iyaayasfw-supply-db",
    "--remote",
    "--command",
    "SELECT id FROM guest_settings WHERE id='main'",
    "--config",
    "gear/wrangler.deploy.json",
  ],
  ["deploy", "--config", "gear/wrangler.deploy.json"],
]) {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    stdio: "inherit",
    env: { ...process.env, CI: "true" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
