// Decision engine: photo in, receipted decision out.
//
// The order of authority is deliberate:
//   1. SAM 3.1 counts the items. Its count is deterministic law.
//   2. The mandate's release band turns that count into money.
//   3. Muse Spark reads the mandate and the evidence and explains the
//      outcome in plain language. Spark advises; it never moves money.
// If Spark's proposal disagrees with the band, the band wins and the
// override is written into the receipt, where anyone can see it.

import { createHash } from "node:crypto";
import { releaseBand, mandatePromptText } from "./mandate.js";
import * as liveProviders from "./providers.js";

function parseSparkJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function evaluateDelivery(escrow, imageDataUri, providers = liveProviders) {
  const mandate = escrow.mandate;

  // Receipt the evidence by hash, never the image itself.
  const imageHash = createHash("sha256").update(imageDataUri).digest("hex");
  escrow.submitEvidence({
    kind: "photo",
    sha256: imageHash,
    bytes: imageDataUri.length,
    concept: mandate.concept,
  });

  // A transient SAM failure rolls the escrow back to funded (receipted as
  // evaluation-failed) and propagates, so the caller can retry (audit F4).
  let sam;
  try {
    sam = await providers.samCount(imageDataUri, mandate.concept);
  } catch (err) {
    escrow.failEvaluation(String(err).slice(0, 200));
    throw err;
  }

  // Condition check: SAM counts presence but cannot grade condition from a
  // text concept, so Spark vision assesses damage. Its damaged count feeds
  // the same deterministic band; the source is disclosed in the receipt.
  let condition = null;
  let damagedCount = 0;
  let conditionError = null;
  if (mandate.clauses.conditionCheck && typeof providers.sparkCondition === "function") {
    try {
      condition = await providers.sparkCondition(imageDataUri);
      damagedCount = Math.max(0, Math.min(condition.damagedCount || 0, sam.count ?? 0));
    } catch (err) {
      conditionError = String(err).slice(0, 200);
    }
  }
  const effectiveCount = Math.max(0, (sam.count ?? 0) - damagedCount);
  const band = releaseBand(mandate, effectiveCount);

  // Over-count sanity flag: more items segmented than the mandate expects
  // (a loose concept phrase can catch the shipping carton too). The band
  // already caps the release at 100%; the flag makes the surplus visible
  // to the human approver and permanent in the receipt.
  const overCount = Math.max(0, (sam.count ?? 0) - mandate.expectedCount);

  let spark = null;
  let explanation = null;
  if (typeof providers.sparkChat === "function") {
    const prompt = [
      mandatePromptText(mandate),
      `Evidence: a segmentation count verified ${sam.count} of ${mandate.expectedCount} items present in the delivery photo${damagedCount > 0 ? `; a vision condition check found ${damagedCount} of them visibly damaged, so ${effectiveCount} count as delivered in good condition` : ""}.`,
      `Reply with a JSON object only: {"decision": "release"|"partial-hold"|"hold", "releasePct": number, "reason": string}. No other text.`,
    ].join(" ");
    try {
      const out = await providers.sparkChat([{ role: "user", content: prompt }]);
      spark = parseSparkJson(out?.content);
      explanation = spark?.reason ?? null;
    } catch (err) {
      explanation = null;
      spark = { error: String(err).slice(0, 200) };
    }
  }
  if (!explanation) {
    explanation =
      band.decision === "release"
        ? `All ${mandate.expectedCount} items verified present in good condition. Full release per mandate.`
        : band.decision === "partial-hold"
          ? `${effectiveCount} of ${mandate.expectedCount} items count as delivered in good condition (${sam.count} present${damagedCount > 0 ? `, ${damagedCount} damaged` : ""}). Release ${band.releasePct}% and hold the rest per mandate.`
          : `Only ${effectiveCount} of ${mandate.expectedCount} items count as delivered in good condition. Hold everything per mandate.`;
  }

  const engineOverride = Boolean(
    spark &&
      !spark.error &&
      (spark.decision !== band.decision || spark.releasePct !== band.releasePct)
  );
  if (engineOverride) {
    // The explanation must never contradict the money. When the verified
    // count overrules the model, say so in the explanation itself.
    explanation = `${explanation} The verified count of ${sam.count} of ${mandate.expectedCount} governs under the mandate, so the outcome is ${band.decision} at ${band.releasePct}%.`;
  }

  if (overCount > 0) {
    explanation += ` Note: SAM counted ${sam.count} items, ${overCount} above the mandated ${mandate.expectedCount}. The release is capped at 100% and the surplus is flagged for the approver.`;
  }

  const decision = {
    samCount: sam.count,
    samBoxes: sam.boxes || [],
    samProvider: sam.provider,
    damagedCount,
    effectiveCount,
    condition,
    conditionError,
    overCount,
    band,
    spark: spark && !spark.error ? spark : null,
    engineOverride,
    explanation,
    final: band,
  };
  escrow.recordDecision(decision);
  return decision;
}
