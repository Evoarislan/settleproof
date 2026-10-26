import assert from "node:assert";
import { ReceiptChain } from "../src/receipts.js";

const chain = new ReceiptChain();
chain.append("mandate", { order: "demo-1", items: 10, amount: 120 });
chain.append("evidence", { order: "demo-1", samCount: 9, expected: 10 });
chain.append("decision", { order: "demo-1", action: "partial-hold", releasePct: 90 });

assert.deepEqual(chain.verify(), { ok: true, length: 3 });

// Tamper: rewrite history and the chain must break at that receipt.
chain.receipts[1].data.samCount = 10;
const after = chain.verify();
assert.equal(after.ok, false);
assert.equal(after.brokenAt, 2);

console.log("selftest passed: chain verifies, tamper detected at seq 2");
