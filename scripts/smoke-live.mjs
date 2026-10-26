// Live smoke test for the Meta Model API providers.
// Usage: node scripts/smoke-live.mjs   (reads .env in the repo root)
// Costs: one SAM image ($0.0025 list) and one small Spark call (~$0.002 list),
// drawn from hackathon credits while they are active. Synthetic data only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(join(root, ".env"), "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.startsWith("#")) {
    process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
}

const { samCount, sparkDecide, providerMode } = await import(
  join(root, "src/providers.js")
);
console.log("provider mode:", providerMode());

const b64 = readFileSync(join(root, "test-assets/ten-boxes.png")).toString(
  "base64"
);
const sam = await samCount(`data:image/png;base64,${b64}`, "box");
console.log("SAM count (expect 10):", sam.count);
console.log("SAM first box:", JSON.stringify(sam.boxes[0]));

const dec = await sparkDecide({
  prompt:
    'Mandate: release 100% if all 10 items are present and undamaged; if items are missing, release the percentage present and hold the rest; if evidence is absent, hold all. Evidence: SAM counted 9 of 10 items, all present items undamaged. Reply with a JSON object only: {"decision": "release"|"partial-hold"|"hold", "releasePct": number, "reason": string}.',
});
console.log("Spark decision:", dec.raw);
console.log("Spark usage:", JSON.stringify(dec.usage));
