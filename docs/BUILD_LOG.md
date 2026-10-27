# Build log

## Oct 26, 2026 (day 1)
- Repo scaffolded: receipt chain, provider seams, health/receipts endpoints.
- Meta Model API smoke test passed (see SMOKE_TEST.md): Spark 1.3 decisions
  and SAM 3.1 counts verified live; Lane C risk 1 cleared.
- Mandate and escrow core built (src/mandate.js, src/escrow.js): mandate
  object drives both Spark's prompt text and the deterministic release band;
  escrow state machine (created, funded, evidence-submitted, decided,
  settled, held) receipts every transition; human approval gate before any
  settlement; payment rail is a seam (mock rail in-process today).
- Decision engine (src/engine.js): SAM count is law, Spark explains, engine
  enforces the band, overrides are receipted and called out in the
  explanation text itself.
- Server endpoints: POST /orders, GET /orders/:id, POST /orders/:id/evidence,
  POST /orders/:id/approve, POST /orders/:id/reject, GET /health, /receipts.
- Tests: scripts/core-test.mjs (stubbed providers) covers override to
  partial-hold, full release, zero-count hold, approval gate, tamper
  detection. All pass.
- Live end-to-end through the HTTP server: ten-boxes photo released 100%
  (120 of 120) after approval; nine-boxes photo settled partial-hold
  (108 released, 12 held) after approval; receipt chains valid.
- Test-asset lesson: an outlined empty slot is itself box-shaped, and SAM
  correctly segmented it (count 10). The short-shipment asset now leaves the
  tenth slot bare. Demo assets must never draw the missing item's outline.
- Settlement is on the mock rail. Live x402 rail hookup remains, per plan.
- Realistic demo assets generated with Muse Image (test-assets/real-ten.jpg,
  real-nine.jpg): overhead packing photos, 10 and 9 white product boxes.
  SAM counts verified against visual ground truth (checked by eye on the
  annotated renders): 10 of 10 and 9 of 9, exact. CONCEPT LESSON: with the
  generic prompt "box" SAM also counts the outer shipping box (11 and 10);
  the mandate must name the item precisely ("white product box"). Naming
  discipline is now a documented product behavior.
- Demo UI built (public/index.html, served by the app): persona strip
  (marketplace holds payouts up to 14 days), order card with step tracker,
  scenario buttons (clean delivery, short shipment, upload your own photo),
  evidence view with numbered SAM boxes drawn over the photo, big count,
  green/red money bar, Spark explanation panel with override callout,
  human approval settle button, per-order receipt trail, chain status pill,
  tamper test (rewrites a past decision receipt; chain reports BROKEN at
  that receipt) and demo reset.
- Verified end to end via HTTP: page and assets serve; real-nine flow
  returns 9 boxes to the UI layer and settles partial-hold 108/12 after
  approval; tamper breaks verification at the decision receipt; reset
  restores a valid chain.
- Pre-deploy tweaks (Oct 26, prompted by John's review of the uneven boxes):
  (1) real-nine.jpg regenerated with a strict uniform-grid prompt; v2 is a
  clean 5+4 grid with a bare empty slot, SAM count 9 exact, tight boxes
  (v1 kept as real-nine-v1.jpg). The unevenness was a cosmetic artifact of
  image generation; SAM's counts were never affected by it.
  (2) Over-count sanity flag: when SAM counts more than the mandate expects
  (e.g. a loose concept catching the shipping carton), the release already
  capped at 100%; now the surplus is also flagged on the decision, in the
  explanation, in the UI, and in the decision receipt (overCount field).
  Core tests now 6/6 including the over-count case; live flow on the v2
  asset re-verified (9 -> partial-hold 90, no false flag).
- Repo published Oct 26, 2026: https://github.com/Evoarislan/settleproof
  (public, main @ aceb583). Pre-push checks: .env gitignored and not staged,
  secret scan clean (only .env.example placeholder in the tree). Dockerfile
  added (node:20-alpine; Render auto-detect pattern proven by Common Ground).
  Render service creation is John's dashboard step (his account), with
  META_API_KEY set server-side there.
- Oct 26, 2026: Airwallex Bank of Agents was NOT shortlisted. Per the standing
  Meta-vs-Airwallex decision rule, SettleProof is now the main build at FULL
  scope: the scoped-sprint cut list is retired and the third demo scenario
  (damaged goods) is restored alongside clean delivery and short shipment.
- Oct 27, 2026: Render security advisory (eMudhra CA compromise, Node.js Oct 21
  patches, PHP2Shell). SettleProof Dockerfile bumped node:20-alpine ->
  node:24-alpine (patched line; app already verified on Node 24.22.1) and
  pushed (main). Common Ground checked the same day: already on node:24-slim,
  rebuild + boot + health verified locally on the patched runtime; it needs
  only a Render rebuild (Manual Deploy) to pick up the patched base image.
  PHP does not apply to any portfolio app.
