// Core tests with stubbed providers: no API calls, no spend.
// Run: node scripts/core-test.mjs
import assert from "node:assert";
import { ReceiptChain } from "../src/receipts.js";
import { createMandate } from "../src/mandate.js";
import { Escrow, mockRail } from "../src/escrow.js";
import { evaluateDelivery } from "../src/engine.js";

const stubProviders = (count, sparkJson) => ({
  samCount: async () => ({ provider: "stub-sam", count, boxes: [] }),
  sparkChat: async () => ({
    content: JSON.stringify(sparkJson),
    usage: null,
    model: "stub-spark",
  }),
});

function newEscrow(chain) {
  const mandate = createMandate({
    id: `order-${Math.random().toString(36).slice(2, 8)}`,
    buyer: "buyer-demo",
    seller: "seller-demo",
    concept: "box",
    expectedCount: 10,
    totalAmount: 120,
  });
  const escrow = new Escrow(mandate, chain, mockRail);
  escrow.fund();
  return escrow;
}

// 1. SAM is law: Spark wrongly proposes full release on 9 of 10.
//    The engine must override to partial-hold 90 and receipt the override.
{
  const chain = new ReceiptChain();
  const escrow = newEscrow(chain);
  const decision = await evaluateDelivery(
    escrow,
    "data:image/png;base64,stub",
    stubProviders(9, { decision: "release", releasePct: 100, reason: "Looks complete." })
  );
  assert.equal(decision.final.decision, "partial-hold");
  assert.equal(decision.final.releasePct, 90);
  assert.equal(decision.final.releaseAmount, 108);
  assert.equal(decision.final.heldAmount, 12);
  assert.equal(decision.engineOverride, true);
  assert.equal(escrow.state, "decided");

  const settlement = await escrow.approve("john");
  assert.equal(escrow.state, "settled");
  assert.equal(settlement.releasedAmount, 108);
  assert.equal(settlement.heldAmount, 12);
  assert.ok(settlement.txRef);
  assert.equal(chain.verify().ok, true);
  console.log("1. override + partial-hold settlement: ok");
}

// 2. Full count releases in full after approval.
{
  const chain = new ReceiptChain();
  const escrow = newEscrow(chain);
  const decision = await evaluateDelivery(
    escrow,
    "data:image/png;base64,stub",
    stubProviders(10, { decision: "release", releasePct: 100, reason: "All present." })
  );
  assert.equal(decision.final.decision, "release");
  assert.equal(decision.engineOverride, false);
  const settlement = await escrow.approve("john");
  assert.equal(settlement.releasedAmount, 120);
  assert.equal(settlement.heldAmount, 0);
  assert.equal(escrow.state, "settled");
  console.log("2. full release: ok");
}

// 3. Zero count holds everything; approval settles as held, no rail call.
{
  const chain = new ReceiptChain();
  const escrow = newEscrow(chain);
  const decision = await evaluateDelivery(
    escrow,
    "data:image/png;base64,stub",
    stubProviders(0, { decision: "hold", releasePct: 0, reason: "Nothing verified." })
  );
  assert.equal(decision.final.decision, "hold");
  const settlement = await escrow.approve("john");
  assert.equal(escrow.state, "held");
  assert.equal(settlement.releasedAmount, 0);
  assert.equal(settlement.txRef, null);
  console.log("3. zero count hold: ok");
}

// 4. Nothing settles before a decision exists.
{
  const chain = new ReceiptChain();
  const escrow = newEscrow(chain);
  await assert.rejects(() => escrow.approve("john"), /cannot approve/);
  console.log("4. approval gate holds before decision: ok");
}

// 5. Tampering with a receipt breaks the chain.
{
  const chain = new ReceiptChain();
  const escrow = newEscrow(chain);
  await evaluateDelivery(
    escrow,
    "data:image/png;base64,stub",
    stubProviders(9, { decision: "partial-hold", releasePct: 90, reason: "Nine of ten." })
  );
  assert.equal(chain.verify().ok, true);
  const target = chain.receipts.find((r) => r.kind === "decision");
  target.data.releasePct = 100;
  assert.equal(chain.verify().ok, false);
  console.log("5. tamper detection: ok");
}

// 6. Over-count: SAM sees 11 (mandate expects 10). Release caps at 100%,
//    the surplus is flagged on the decision and in the receipt.
{
  const chain = new ReceiptChain();
  const escrow = newEscrow(chain);
  const decision = await evaluateDelivery(
    escrow,
    "data:image/png;base64,stub",
    stubProviders(11, { decision: "release", releasePct: 100, reason: "All present." })
  );
  assert.equal(decision.final.decision, "release");
  assert.equal(decision.final.releasePct, 100);
  assert.equal(decision.overCount, 1);
  assert.match(decision.explanation, /capped at 100%/);
  const receipt = chain.receipts.find((r) => r.kind === "decision");
  assert.equal(receipt.data.overCount, 1);
  console.log("6. over-count cap + flag: ok");
}

console.log("core tests: all passed");
