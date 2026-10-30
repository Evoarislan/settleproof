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
- Oct 27, 2026: LIVE RAIL DONE. src/rail.js settles real USDC on Base from
  the treasury wallet, env-gated (SETTLEPROOF_RAIL=live), mock stays the
  default everywhere including the public demo. Demo rate 0.01 disclosed in
  every settlement receipt with the real amount and tx hash. On-chain
  proof: order-1 (10/10) tx 0x28258ea75d82a251ce5cdca85d6e00889b485b8df69fc5b03d410f39c40e9560
  moved 1.2 USDC; order-2 (9/10 partial) tx 0x52fa97337c1a1723849ff2ed1ffc3de524df7c3fd3ab965b5ee9b855298cb150
  moved 1.08 USDC; demo seller balance 0 -> 2.28 USDC exactly, held shares
  never left the treasury. Demo seller wallet: 0x4BC04F353D14d4d7F956c13638a031988Edc9330
  (key outside the repo). Treasury verified on chain the same day:
  70.95629 USDC and 0.000409 ETH (gas is the constraint, dozens of demo
  settlements of headroom).
- Oct 27, 2026: DAMAGED-GOODS SCENARIO DONE (third scenario, full scope).
  Finding: SAM cannot grade condition (damage concepts segment every box),
  so Spark vision does the condition check and SAM keeps the count. Live:
  10 present, 2 damaged -> partial-hold 80 (96 released, 24 held), vision
  notes localize the damage correctly; clean-delivery regression holds at
  100 with zero false damage flags.
- Oct 27, 2026: double-settlement race in approve() closed (synchronous
  settling state, rollback on rail failure), test 9 covers it. Core tests
  9/9. A SECURITY-AUDIT.md for a sibling build was committed by accident in
  e973196 and removed in bf26c23; it remains in git history and in
  ~/workspace/settleproof-audit/.
- Oct 27, 2026: SECURITY FIXES F2+F3 and F4 landed (approved by John in the
  main chat; audit at ~/workspace/settleproof-audit/SECURITY-AUDIT.md).
  F2: readBody caps at MAX_BODY_BYTES (default 12 MB, 413 on overflow,
  drain-and-discard so memory stays bounded); per-IP rate limits on
  POST /orders (30/min) and evidence (10/min) with 429s; order capacity
  cap (MAX_ORDERS default 200). F3: DEMO_TOKEN env puts /demo/*, approve,
  and reject behind an x-demo-token header; with a token configured the
  recorded approver is the server-side "demo-operator", never body text;
  the UI takes the token from ?token= in the presenter link (session only)
  and prompts once on a 401. Gate is off when DEMO_TOKEN is unset, so
  local flows are unchanged (regression-verified live). F4: submitEvidence
  is state-aware (funded = first submission, evidence-submitted =
  resubmission, receipted), and a SAM failure receipts evaluation-failed
  and rolls the order back to funded for retry; reject -> re-evaluate now
  works as the state machine always documented. Tests: core 11/11 (new
  tests 10 and 11 cover SAM-failure rollback and reject -> re-evidence)
  and scripts/server-test.mjs 6/6 against a real booted server in mock
  mode (body cap, both rate limits, both token gates).
- Oct 27, 2026: SWARM LOOP 2 (three lanes: judge sim, security second
  pass, live demo run-through; reports in ../SWARM-LOOP-2-LANE-*.md).
  Judge sim scored the build 7.1 weighted (Impact 6.5, Tooling 7.5, Demo
  7.0, Technical 7.5) against the Oct 24 sim's 8.2 post-fix estimate; the
  gap is judge-facing (no public URL yet, mock settlement visible, no
  fix-and-release flow), not engineering. Fixes landed in this loop:
  rate limits now key on the LAST X-Forwarded-For entry (first entry is
  client-forged; probe-verified bypass closed); F5 UI escaping for all
  model/user strings plus a CSP and nosniff headers; F6 mandate input
  validation (400s) and exact-fraction release amounts with a floored
  percentage (199/200 now partial-holds at 99%, never rounds to full);
  F9 META_API_MODE=mock now actually forces mock providers; F8-lite:
  provider error bodies stay server-side, clients get a generic 502, and
  condition-check failures no longer leak upstream text into responses.
  N1 (new, live rail): the transfer hash is receipted as
  settlement-submitted at broadcast, before confirmation; a
  confirmation failure leaves the order in settling with the hash on
  record and retries are refused, so a retry can never double-pay.
  N4: the vision totalVisible is cross-checked against SAM's count; a
  disagreement is flagged in the decision and receipted, and condition
  failures are receipted too. Demo: busy state with scenario buttons
  locked and a plain "counting" panel (a cold first call took 29.4s in
  Lane C's run), stale UI cleared at run start, SAM boxes reveal one by
  one, the damaged-case caption now credits SAM and Spark honestly, a
  Reject button drives the re-check flow on the same order, receipt
  details cover the new receipt kinds, and a live settlement links to
  Basescan with the paid-in-minutes line. Tests: core 13/13, server 8/8,
  selftest pass, live regression green (damaged flow exact, reject ->
  re-check decides live). Deferred by design: post-settlement held-
  remainder top-up flow and persistence-lite (noted for post-freeze).
- Oct 30, 2026 (FEATURE FREEZE): removed the /diag operator probe and its
  now-unused provider imports. The probe existed only to diagnose the
  Render deployment (it proved Meta serves Render an empty model
  catalog); the judged demo runs on GitHub Codespaces, verified end to
  end Oct 29, so the probe is scaffolding, not product. Tests after
  removal: core 13/13, server 8/8, selftest pass. Submission is
  video-led with the Codespace as a bonus link. No feature changes
  after this commit; fixes only, with John's go.
