import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";

const manifest = JSON.parse(
  await readFile(
    new URL("../asset-source/manifest.json", import.meta.url),
    "utf8",
  ),
);
for (const asset of manifest) {
  const parts = await Promise.all(
    asset.parts.map((part) =>
      readFile(new URL(`../asset-source/${part}`, import.meta.url), "utf8"),
    ),
  );
  const bytes = Buffer.from(parts.join(""), "base64");
  if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256) {
    throw new Error(`Asset checksum mismatch: ${asset.path}`);
  }
  const output = new URL(`../${asset.path}`, import.meta.url);
  await mkdir(dirname(output.pathname), { recursive: true });
  await writeFile(output, bytes);
}
console.log(
  `Restored and verified ${manifest.length} brand and product images.`,
);

const logo = await readFile(
  new URL("../public/brand/logo.png", import.meta.url),
);
await writeFile(
  new URL("../public/favicon.svg", import.meta.url),
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080"><image width="1080" height="1080" href="data:image/png;base64,' +
    logo.toString("base64") +
    '"/></svg>',
);
