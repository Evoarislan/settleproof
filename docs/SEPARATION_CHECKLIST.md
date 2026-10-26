# Separation checklist (SettleProof vs prior projects)

SettleProof is a fresh project for the Meta Global AI Developer Hackathon.
The Official Rules (waiver document dated Oct 25, 2026) require the submission
to be the entrant's original work and do not ban pre-existing code, non-Meta
models, third-party help, or licensed open source. This checklist keeps the
boundary clean and auditable anyway.

## New in this repo (written Oct 26 to Nov 4, 2026)
- Mandate and escrow decision flow for marketplace delivery proof
- SAM 3.1 evidence pipeline (photo in, numbered masks, item count out)
- Spark decision loop and plain-language explanations
- Annotated evidence view (numbered masks tied to decision lines)
- Demo scenarios and all UI, copy, and branding

## Adapted patterns (ideas and small utilities, re-implemented here)
- Hash-chained receipt log pattern (from the author's earlier agent-payment
  prototypes): re-implemented fresh in src/receipts.js
- Policy threshold style (full / partial / reject bands) as a concept;
  the SettleProof mandate engine is new code

## Explicitly NOT shared with any other live entry
- No code, copy, branding, or assets from the Airwallex "Bank of Agents"
  concept; different audience (human sellers vs AI agents), different core
  flow (one escrow decision vs accounts/credit/payroll), no vision there,
  no lending or payroll here
- No cross-mentions between writeups

## Rules posture
- Meta model is the core (Spark decisions, SAM 3.1 evidence): 25% of score
- Human approval step before any consequential release
- Test value only (x402 / stablecoin test rails); synthetic data throughout
