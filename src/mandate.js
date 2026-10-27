// A mandate is the written agreement an escrow runs under: what was ordered,
// what the delivery photo must show, and how money moves for each outcome.
// The mandate text is what Muse Spark reads; the numeric clauses are what
// the deterministic engine enforces. Both come from this one object so the
// explanation and the enforcement can never drift apart.

export function createMandate({
  id,
  buyer,
  seller,
  concept,
  expectedCount,
  totalAmount,
  currency = "USD-TEST",
}) {
  // Input validation (audit F6): money fields are typed and ranged, so a
  // malformed order fails loudly instead of corrupting the receipts.
  const bad = (msg) => {
    const e = new Error(msg);
    e.status = 400;
    return e;
  };
  if (!id) throw bad("mandate requires id");
  if (typeof concept !== "string" || !concept.trim() || concept.length > 200) {
    throw bad("concept must be a string of 1-200 characters");
  }
  if (!Number.isInteger(expectedCount) || expectedCount < 1 || expectedCount > 100000) {
    throw bad("expectedCount must be an integer between 1 and 100000");
  }
  if (typeof totalAmount !== "number" || !Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw bad("totalAmount must be a positive number");
  }
  return {
    id,
    buyer,
    seller,
    concept, // the SAM 3.1 noun phrase for the shipped item, e.g. "box"
    expectedCount,
    totalAmount,
    currency,
    clauses: {
      // Release the percentage of items SAM verifies as present.
      partialRelease: true,
      // No evidence, or zero items verified, means hold everything.
      zeroEvidenceHolds: true,
      // A human approves before any money settles.
      humanApproval: true,
      // Visibly damaged items do not count as delivered in good condition;
      // their share is held like a missing item's share.
      conditionCheck: true,
    },
  };
}

// The deterministic release band. SAM's count is law: this function, not the
// language model, decides how much money moves.
export function releaseBand(mandate, samCountValue) {
  const { expectedCount, totalAmount } = mandate;
  if (samCountValue == null || samCountValue <= 0) {
    return { decision: "hold", releasePct: 0, releaseAmount: 0, heldAmount: totalAmount };
  }
  if (samCountValue >= expectedCount) {
    return { decision: "release", releasePct: 100, releaseAmount: totalAmount, heldAmount: 0 };
  }
  // Exact-fraction money: the amount comes from the true share, and the
  // displayed percentage is floored, so rounding can never push a partial
  // hold up to a full release (audit F6 rounding note).
  const releaseAmount = Math.round(totalAmount * (samCountValue / expectedCount) * 100) / 100;
  const releasePct = Math.floor((samCountValue / expectedCount) * 100);
  return {
    decision: "partial-hold",
    releasePct,
    releaseAmount,
    heldAmount: Math.round((totalAmount - releaseAmount) * 100) / 100,
  };
}

// The plain-language mandate summary Spark reasons over.
export function mandatePromptText(mandate) {
  return [
    `Mandate ${mandate.id}: buyer ${mandate.buyer} paid ${mandate.totalAmount} ${mandate.currency} to seller ${mandate.seller}.`,
    `The order is for ${mandate.expectedCount} units of "${mandate.concept}".`,
    `Release rule: release the percentage of the payment matching the share of items verified present in the delivery photo.`,
    `Items visibly damaged (crushed, torn, dented, punctured) do not count as delivered in good condition; their share is held the same as a missing item's share.`,
    `If all ${mandate.expectedCount} items are verified, release 100%. If none are verified, or there is no usable evidence, hold 100%.`,
    `A human approves every settlement before money moves.`,
  ].join(" ");
}
