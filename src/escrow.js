// Escrow state machine. Every transition is written to the receipt chain
// before it takes effect, so the log is the source of truth and any later
// edit to history breaks verification.
//
// States: created -> funded -> evidence-submitted -> decided
//         decided --approve--> settled (release or partial-hold)
//         decided --approve--> held    (hold decisions settle as fully held)
//         decided --reject---> evidence-submitted (re-check with new proof)
//         evidence-submitted --evaluation fails--> funded (retry, F4)
//         evidence-submitted --new proof--> evidence-submitted (resubmission)

export const STATES = {
  CREATED: "created",
  FUNDED: "funded",
  EVIDENCE: "evidence-submitted",
  DECIDED: "decided",
  SETTLING: "settling",
  SETTLED: "settled",
  HELD: "held",
};

export class Escrow {
  constructor(mandate, chain, rail) {
    this.mandate = mandate;
    this.chain = chain;
    this.rail = rail; // payment rail seam: { settle({amount, to, memo}) -> {txRef} }
    this.state = STATES.CREATED;
    this.decision = null; // {band, spark, final} once decided
    this.settlement = null; // {releasedAmount, heldAmount, txRef} once settled
    this.pendingTxHash = null; // set when a live transfer broadcasts (N1)
    this.chain.append("mandate-created", {
      mandateId: mandate.id,
      buyer: mandate.buyer,
      seller: mandate.seller,
      concept: mandate.concept,
      expectedCount: mandate.expectedCount,
      totalAmount: mandate.totalAmount,
      currency: mandate.currency,
    });
  }

  _require(state, action) {
    if (this.state !== state) {
      throw new Error(`cannot ${action} from state ${this.state} (needs ${state})`);
    }
  }

  fund() {
    this._require(STATES.CREATED, "fund");
    this.state = STATES.FUNDED;
    this.chain.append("funded", {
      mandateId: this.mandate.id,
      amount: this.mandate.totalAmount,
      currency: this.mandate.currency,
    });
    return this.state;
  }

  // State-aware (audit F4): from funded this is the first submission; from
  // evidence-submitted it is a re-check after a rejected decision or a
  // failed evaluation, receipted as a resubmission without a state change.
  submitEvidence(evidence) {
    if (this.state === STATES.FUNDED) {
      this.state = STATES.EVIDENCE;
      this.chain.append("evidence-submitted", {
        mandateId: this.mandate.id,
        evidence,
      });
      return this.state;
    }
    if (this.state === STATES.EVIDENCE) {
      this.chain.append("evidence-resubmitted", {
        mandateId: this.mandate.id,
        evidence,
      });
      return this.state;
    }
    throw new Error(
      `cannot submit evidence from state ${this.state} (needs funded or evidence-submitted)`
    );
  }

  // A provider failure during evaluation rolls the order back to funded and
  // receipts the failure, so a transient error never bricks the order (F4).
  failEvaluation(error) {
    this._require(STATES.EVIDENCE, "fail evaluation");
    this.state = STATES.FUNDED;
    this.chain.append("evaluation-failed", {
      mandateId: this.mandate.id,
      error,
    });
    return this.state;
  }

  recordDecision(decision) {
    this._require(STATES.EVIDENCE, "record decision");
    this.decision = decision;
    this.state = STATES.DECIDED;
    this.chain.append("decision", {
      mandateId: this.mandate.id,
      decision: decision.final.decision,
      releasePct: decision.final.releasePct,
      releaseAmount: decision.final.releaseAmount,
      heldAmount: decision.final.heldAmount,
      samCount: decision.samCount,
      damagedCount: decision.damagedCount ?? 0,
      effectiveCount: decision.effectiveCount ?? decision.samCount,
      conditionSource: decision.condition ? decision.condition.provider : null,
      conditionTotalVisible: decision.condition?.totalVisible ?? null,
      conditionDiscrepancy: decision.conditionDiscrepancy ?? false,
      conditionFailed: Boolean(decision.conditionError),
      overCount: decision.overCount ?? 0,
      expectedCount: this.mandate.expectedCount,
      sparkProposed: decision.spark?.decision ?? null,
      sparkReleasePct: decision.spark?.releasePct ?? null,
      engineOverride: Boolean(decision.engineOverride),
      explanation: decision.explanation,
    });
    return this.state;
  }

  // Human approval gate. Nothing settles without this call.
  async approve(approver) {
    // A previous attempt already broadcast a live transfer: its hash is
    // receipted and the money may be gone. Never settle a second time;
    // a human reconciles against the hash first (audit follow-up N1).
    if (this.state === STATES.SETTLING && this.pendingTxHash) {
      throw new Error(
        `settlement already broadcast (${this.pendingTxHash}); reconcile before retrying`
      );
    }
    this._require(STATES.DECIDED, "approve");
    const { releaseAmount, heldAmount, decision } = this.decision.final;
    // Claim the transition synchronously, before any await. A second
    // approve call (double click, client retry, concurrent request) then
    // fails the state check instead of settling twice. If the rail call
    // fails before broadcasting, the state rolls back to decided so
    // approval can be retried; if it fails after broadcasting, the order
    // stays in settling with the hash recorded, and retries are refused.
    this.state = STATES.SETTLING;
    let txRef = null;
    let railMeta = null;
    try {
      if (releaseAmount > 0) {
        const out = await this.rail.settle({
          amount: releaseAmount,
          currency: this.mandate.currency,
          to: this.mandate.seller,
          memo: `settleproof ${this.mandate.id} release ${decision}`,
          onBroadcast: (hash) => {
            this.pendingTxHash = hash;
            this.chain.append("settlement-submitted", {
              mandateId: this.mandate.id,
              txRef: hash,
              amount: releaseAmount,
            });
          },
        });
        txRef = out.txRef;
        const { txRef: _omit, ...rest } = out;
        railMeta = Object.keys(rest).length ? rest : null;
      }
    } catch (err) {
      if (this.pendingTxHash) {
        throw new Error(
          `settlement already broadcast (${this.pendingTxHash}); reconcile before retrying`
        );
      }
      this.state = STATES.DECIDED;
      throw err;
    }
    this.pendingTxHash = null;
    this.settlement = { releasedAmount: releaseAmount, heldAmount, txRef, rail: railMeta, approver };
    this.state = decision === "hold" ? STATES.HELD : STATES.SETTLED;
    this.chain.append("approved-and-settled", {
      mandateId: this.mandate.id,
      approver,
      releasedAmount: releaseAmount,
      heldAmount,
      txRef,
      rail: railMeta,
      outcome: this.state,
    });
    return this.settlement;
  }

  reject(rejector, reason) {
    this._require(STATES.DECIDED, "reject");
    this.decision = null;
    this.state = STATES.EVIDENCE;
    this.chain.append("decision-rejected", {
      mandateId: this.mandate.id,
      rejector,
      reason,
    });
    return this.state;
  }

  snapshot() {
    return {
      mandate: this.mandate,
      state: this.state,
      decision: this.decision,
      settlement: this.settlement,
    };
  }
}

// Mock rail: records the settlement intent in-process and returns a reference.
// The live x402 rail implements the same { settle } shape.
export const mockRail = {
  async settle({ amount, currency, to, memo }) {
    return { txRef: `mock-rail-${Date.now()}-${Math.round(amount * 100)}` };
  },
};
