// Core tests with stubbed providers: no API calls, no spend.
// Run: node scripts/core-test.mjs
import assert from "node:assert";
import { ReceiptChain } from "../src/receipts.js";
import { createMandate, releaseBand } from "../src/mandate.js";
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

// 7. Rail seam contract: approval calls settle exactly once with the release
//    amount, and rail metadata lands in the settlement and the receipt.
{
  const chain = new ReceiptChain();
  const mandate = createMandate({
    id: "order-railtest",
    buyer: "buyer-demo",
    seller: "seller-demo",
    concept: "box",
    expectedCount: 10,
    totalAmount: 120,
  });
  const calls = [];
  const capturingRail = {
    mode: "live",
    async settle(args) {
      calls.push(args);
      return { txRef: "0xdeadbeef", usdcAmount: 1.08, rate: 0.01, chain: "base" };
    },
  };
  const escrow = new Escrow(mandate, chain, capturingRail);
  escrow.fund();
  await evaluateDelivery(
    escrow,
    "data:image/png;base64,stub",
    stubProviders(9, { decision: "partial-hold", releasePct: 90, reason: "Nine of ten." })
  );
  const settlement = await escrow.approve("john");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].amount, 108);
  assert.equal(settlement.txRef, "0xdeadbeef");
  assert.equal(settlement.rail.usdcAmount, 1.08);
  const receipt = chain.receipts.find((r) => r.kind === "approved-and-settled");
  assert.equal(receipt.data.rail.chain, "base");
  assert.equal(chain.verify().ok, true);
  console.log("7. rail seam + metadata in receipt: ok");
}

// 8. Damaged goods: 10 present, 2 damaged -> 8 good -> partial-hold 80.
{
  const chain = new ReceiptChain();
  const escrow = newEscrow(chain);
  const providers = {
    ...stubProviders(10, { decision: "partial-hold", releasePct: 80, reason: "Two damaged." }),
    sparkCondition: async () => ({
      provider: "stub-vision",
      damagedCount: 2,
      totalVisible: 10,
      notes: "Two crushed.",
    }),
  };
  const decision = await evaluateDelivery(escrow, "data:image/png;base64,stub", providers);
  assert.equal(decision.samCount, 10);
  assert.equal(decision.damagedCount, 2);
  assert.equal(decision.effectiveCount, 8);
  assert.equal(decision.final.decision, "partial-hold");
  assert.equal(decision.final.releasePct, 80);
  assert.equal(decision.final.releaseAmount, 96);
  assert.equal(decision.final.heldAmount, 24);
  const receipt = chain.receipts.find((r) => r.kind === "decision");
  assert.equal(receipt.data.damagedCount, 2);
  assert.equal(receipt.data.conditionSource, "stub-vision");
  console.log("8. damaged goods condition path: ok");
}

// 9. Double-settlement race: two concurrent approve calls settle only once;
//    a rail failure rolls back to decided and a retry can succeed.
{
  const chain = new ReceiptChain();
  const mandate = createMandate({
    id: "order-racetest",
    buyer: "buyer-demo",
    seller: "seller-demo",
    concept: "box",
    expectedCount: 10,
    totalAmount: 120,
  });
  let railCalls = 0;
  const slowRail = {
    async settle() {
      railCalls++;
      await new Promise((r) => setTimeout(r, 50));
      return { txRef: "0xslow" };
    },
  };
  const escrow = new Escrow(mandate, chain, slowRail);
  escrow.fund();
  await evaluateDelivery(
    escrow,
    "data:image/png;base64,stub",
    stubProviders(10, { decision: "release", releasePct: 100, reason: "All present." })
  );
  const results = await Promise.allSettled([escrow.approve("john"), escrow.approve("john")]);
  const okCount = results.filter((r) => r.status === "fulfilled").length;
  const failCount = results.filter((r) => r.status === "rejected").length;
  assert.equal(okCount, 1);
  assert.equal(failCount, 1);
  assert.equal(railCalls, 1);
  assert.equal(escrow.state, "settled");

  // Rail failure rolls back; retry succeeds.
  const chain2 = new ReceiptChain();
  let attempts = 0;
  const flakyRail = {
    async settle() {
      attempts++;
      if (attempts === 1) throw new Error("rail down");
      return { txRef: "0xretry" };
    },
  };
  const escrow2 = new Escrow(mandate, chain2, flakyRail);
  escrow2.fund();
  await evaluateDelivery(
    escrow2,
    "data:image/png;base64,stub",
    stubProviders(10, { decision: "release", releasePct: 100, reason: "All present." })
  );
  await assert.rejects(() => escrow2.approve("john"), /rail down/);
  assert.equal(escrow2.state, "decided");
  const retry = await escrow2.approve("john");
  assert.equal(retry.txRef, "0xretry");
  assert.equal(escrow2.state, "settled");
  console.log("9. double-settle race closed + rail-failure rollback: ok");
}

// 10. F4: a transient SAM failure rolls back to funded, receipts the
//     failure, and a retry succeeds. The order is never bricked.
{
  const chain = new ReceiptChain();
  const escrow = newEscrow(chain);
  let calls = 0;
  const flaky = {
    samCount: async () => {
      calls++;
      if (calls === 1) throw new Error("sam http 503: upstream unavailable");
      return { provider: "stub-sam", count: 10, boxes: [] };
    },
    sparkChat: async () => ({
      content: JSON.stringify({ decision: "release", releasePct: 100, reason: "All present." }),
      usage: null,
      model: "stub-spark",
    }),
  };
  await assert.rejects(
    () => evaluateDelivery(escrow, "data:image/png;base64,stub", flaky),
    /503/
  );
  assert.equal(escrow.state, "funded");
  assert.ok(chain.receipts.some((r) => r.kind === "evaluation-failed"));
  const decision = await evaluateDelivery(escrow, "data:image/png;base64,stub", flaky);
  assert.equal(decision.final.decision, "release");
  const settlement = await escrow.approve("john");
  assert.equal(settlement.releasedAmount, 120);
  assert.equal(chain.verify().ok, true);
  console.log("10. SAM failure rollback + retry: ok");
}

// 11. F4: reject returns to evidence-submitted, and re-evaluation with new
//     proof works from there (previously a dead end).
{
  const chain = new ReceiptChain();
  const escrow = newEscrow(chain);
  await evaluateDelivery(
    escrow,
    "data:image/png;base64,stub",
    stubProviders(9, { decision: "partial-hold", releasePct: 90, reason: "Nine of ten." })
  );
  assert.equal(escrow.state, "decided");
  escrow.reject("john", "recount requested");
  assert.equal(escrow.state, "evidence-submitted");
  const second = await evaluateDelivery(
    escrow,
    "data:image/png;base64,stub2",
    stubProviders(10, { decision: "release", releasePct: 100, reason: "All ten on recount." })
  );
  assert.equal(second.final.decision, "release");
  assert.ok(chain.receipts.some((r) => r.kind === "evidence-resubmitted"));
  const settlement = await escrow.approve("john");
  assert.equal(settlement.releasedAmount, 120);
  assert.equal(chain.verify().ok, true);
  console.log("11. reject -> re-evaluation: ok");
}

// 12. N1: a live transfer that broadcasts and then fails confirmation
//     must never be retried into a double payment. The hash is receipted
//     at broadcast, the order stays in settling, and retries are refused.
{
  const chain = new ReceiptChain();
  const mandate = createMandate({
    id: "order-broadcast",
    buyer: "buyer-demo",
    seller: "seller-demo",
    concept: "box",
    expectedCount: 10,
    totalAmount: 120,
  });
  let settleCalls = 0;
  const broadcastRail = {
    async settle(args) {
      settleCalls++;
      if (args.onBroadcast) args.onBroadcast("0xbroadcast");
      throw new Error("confirmation timeout");
    },
  };
  const escrow = new Escrow(mandate, chain, broadcastRail);
  escrow.fund();
  await evaluateDelivery(
    escrow,
    "data:image/png;base64,stub",
    stubProviders(10, { decision: "release", releasePct: 100, reason: "All present." })
  );
  await assert.rejects(() => escrow.approve("john"), /already broadcast/);
  assert.equal(escrow.state, "settling");
  await assert.rejects(() => escrow.approve("john"), /already broadcast/);
  assert.equal(settleCalls, 1);
  assert.ok(chain.receipts.some((r) => r.kind === "settlement-submitted"));
  assert.equal(chain.verify().ok, true);
  console.log("12. broadcast-then-fail never double-pays: ok");
}

// 13. F6: mandate validation rejects bad money fields, and the release
//     band uses exact-fraction amounts with a floored percentage, so a
//     just-short count can never round up to a full release.
{
  assert.throws(
    () => createMandate({ id: "x", concept: "box", expectedCount: 0, totalAmount: 100 }),
    /expectedCount/
  );
  assert.throws(
    () => createMandate({ id: "x", concept: "box", expectedCount: 10, totalAmount: "120" }),
    /totalAmount/
  );
  assert.throws(
    () => createMandate({ id: "x", concept: "box", expectedCount: 10, totalAmount: -5 }),
    /totalAmount/
  );
  const m = createMandate({ id: "x", concept: "box", expectedCount: 200, totalAmount: 200 });
  const band = releaseBand(m, 199);
  assert.equal(band.decision, "partial-hold");
  assert.equal(band.releasePct, 99);
  assert.equal(band.releaseAmount, 199);
  assert.equal(band.heldAmount, 1);
  console.log("13. mandate validation + exact release math: ok");
}

console.log("core tests: all passed");
