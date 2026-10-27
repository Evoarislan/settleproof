# SettleProof — Security Audit

**Date:** Oct 27, 2026
**Target:** `~/workspace/survival/meta-entry/settleproof`, commit `aceb583` ("SettleProof: proof-gated agent payments (Meta hackathon build)"). Worktree had one uncommitted modification (`docs/BUILD_LOG.md`) at audit time; all findings are traced to the committed source files listed below.
**Published as:** github.com/Evoarislan/settleproof
**Scope:** `src/server.js`, `src/escrow.js`, `src/mandate.js`, `src/engine.js`, `src/providers.js`, `src/receipts.js`, `public/index.html`, `scripts/*.mjs`, `package.json`, `Dockerfile`, `.env.example`, `.gitignore`. The real `.env` file's contents were **not** read at any point.
**Audit only.** No SettleProof code was modified, committed, or pushed.

## Method

This audit followed Cloudflare's **security-audit-skill** (github.com/cloudflare/security-audit-skill), verified from its own repo page and source on Oct 27, 2026: **49,441 stars** (the Oct 26 scan figure of ~47,871 is already stale; the repo is growing fast), **MIT license, not archived**, 14 commits, created 2026-06-18. Its six phases were applied:

1. **Reconnaissance** — architecture, trust boundaries, coverage ledger (below).
2. **Coverage-led hunting** — phased review: attack surface, auth/secrets, input validation, money/escrow logic integrity, API key handling, dependency/config risks, plus the skill's AI/LLM, web-protocol, resource-exhaustion, and supply-chain classes.
3. **Candidate validation (disproof pass)** — every candidate was first attacked from source. Three dynamic claims were reproduced in an OS network namespace (`unshare -n`, allowlisted empty environment, `timeout`, a scratch copy of `src/` only, no `.env` present): the target code never ran with network access or real credentials.
4. **Structured output** — confirmed / needs-validation / rejected records (this report is the readable form).
5. **Independent record verification** — a fresh verifier agent, which had not done the hunting, re-traced every candidate from source and tried to disprove it. It downgraded two findings (F6, F8), bounded one (F1), and added four items the hunt missed (F7, plus the items in "Design limitations" and "Needs validation"). All line references below are the verifier-checked ones.
6. **Reporting** — this file.

Per the skill's own honesty note and Cloudflare's published experience, a single run finds roughly half of what repeated runs find. Treat this as a strong sample, not a proof of cleanliness. Per CHAI rules, every confirmed finding cites exact code, covers its whole class, and carries a concrete fix; anything that could not be established is labeled investigation/needs-validation rather than given a severity.

### Recon summary (Phase 1)

- Plain Node 20 HTTP server, **zero npm dependencies** (`package.json` has no `dependencies`), in-memory state only: a global `Map` of orders and one global receipt chain. No persistence, no sessions, no auth anywhere.
- Money flow: `POST /orders` creates a mandate + escrow and "funds" it → `POST /orders/:id/evidence` sends a photo to SAM 3.1 (count) and Muse Spark (explanation) via the Meta Model API → deterministic release band converts count to money → `POST /orders/:id/approve` settles on a rail. Shipped rail is `mockRail`; `src/escrow.js:136` states the live x402 rail implements the same `settle()` shape, and `docs/BUILD_LOG.md:26` confirms the live hookup is planned.
- Trust boundaries: (a) anonymous internet ↔ server (the Render demo is public, `META_API_KEY` set server-side); (b) server ↔ Meta API (key in `Authorization` header only); (c) browser UI ↔ API responses rendered with `innerHTML`; (d) LLM output ↔ money decisions (well separated: see Rejected R1).
- Things done right, verified: `.env` is gitignored, **not tracked** (`git ls-files` shows only `.env.example`), excluded by `.dockerignore`, file mode 600. Evidence receipts store only a SHA-256 hash and byte count, never the image (`src/engine.js:39-45`). Mock mode fails safe: with no key, SAM count is `null` and the band holds 100% (`src/mandate.js:41-43`). SAM over-counts are capped at 100% and flagged (`src/mandate.js:44-46`, `src/engine.js:50,91-93`).

---

## Confirmed findings

### F1 — HIGH — Concurrent approvals settle twice (escrow race)

- **Evidence:** `src/escrow.js:87-109`. `approve()` runs `_require(DECIDED)` at line 88, then `await this.rail.settle(...)` at line 92, and only assigns `this.state` at line 101, after the await. There is no lock or in-flight flag, and `src/server.js:144-148` adds no per-order queue.
- **Observed result (sandboxed harness):** two overlapping `approve()` calls against a 50 ms-delayed rail produced `settleCalls = 2`, both fulfilled, two `approved-and-settled` receipts.
- **Verifier bound:** the hold path (`releaseAmount == 0`) takes no await and is not racy; the race needs `releaseAmount > 0`. The shipped server only wires `mockRail` (`src/server.js`, `src/escrow.js:135-140`), so **today** the impact is duplicate mock settlements and duplicate settlement receipts — the demo's own audit log ends up showing the same order settled twice. The moment the planned live x402 rail is attached to this seam, the identical code double-pays real funds.
- **Why it matters here:** this is the core money-integrity property of the whole product ("nothing settles without approval" also implies "settles exactly once"), in the code the hackathon is judging.
- **Fix:** transition state before the await. Set `this.state = STATES.SETTLED` (or a new `SETTLING` state) immediately after `_require`, before calling `rail.settle`; on rail error, receipt the failure and move to an explicit `settle-failed` state rather than silently returning to `decided`. One-line class of fix; add a core test that fires two concurrent `approve()` calls against a delayed rail and asserts exactly one `settle`.

### F2 — HIGH — Unauthenticated paid-API spend and unbounded request bodies (public demo)

- **Evidence:** `src/server.js:35-49` `readBody` accumulates chunks with **no byte limit** on any route. `POST /orders/:id/evidence` (`src/server.js:137-142`) is unauthenticated, and each call triggers a live SAM 3.1 call plus a Muse Spark call (`src/engine.js:47,61-68` → `src/providers.js:21,60`) billed to the server's `META_API_KEY`. `POST /orders` is unauthenticated (`src/server.js:113`), and the `orders` Map and `chain.receipts` array grow without cap or TTL.
- **Verifier notes:** spend requires the key to be present — which is exactly the planned Render configuration (mock mode spends $0, but memory/CPU exhaustion works in both modes). Minting a fresh order per paid call defeats the per-order state machine as a cost control.
- **Why it matters here:** the demo goes public on Render with roughly $150 of hackathon API credits behind it. Anyone with the URL can drain the credits (denying the demo its live SAM/Spark calls during judging) or OOM the process with oversized `imageDataUri` bodies and order spam. No account, token, or rate limit stands in the way.
- **Fix:** (1) cap `readBody` (e.g. reject bodies over ~12 MB with 413 — a phone photo data-URI fits comfortably); (2) add a simple per-IP token-bucket rate limit on `/orders` and `/evidence` (a few requests/minute is plenty for a demo); (3) cap total live orders and evict or refuse beyond it; (4) optionally require the demo token from F3 for evidence calls. Also set a spend alarm on the Meta API side if the console offers one.

### F3 — MEDIUM — The "human approval gate" is unenforced at the API layer; demo state is anonymously writable

- **Evidence:** no header, token, session, or origin check exists anywhere in `src/server.js`. `POST /orders/:id/approve` (line 144) and `/reject` (line 150) take `body.approver` / `body.rejector` as free text (defaulting to `"human-demo"`) and receipt that text as the approver (`src/escrow.js:100-109`). `POST /demo/tamper` (line 85) and `POST /demo/reset` (line 91) are equally open: reset wipes **all** orders and the entire receipt chain.
- **Why it matters here:** the product's central claim (mandate clause `humanApproval: true`, `src/mandate.js`) is, at the API layer, a UI fiction — the disabled approve button in `public/index.html` is bypassed by any direct API call, as the verifier put it. With synthetic money there is no theft, but during judging any visitor (or bot) can settle or hold every order, tamper the chain, or wipe the demo state mid-evaluation. This is a demo-integrity and availability risk, not a funds risk.
- **Fix:** put `/demo/*`, `approve`, and `reject` behind a shared demo-operator token (env var, checked against a header), and keep the read-only surface (`/`, `/health`, `/receipts`, order GETs) public. Record a server-side approver identity derived from the token, not from the request body.

### F4 — MEDIUM — Dead-end state: rejected orders can never be re-checked, and a SAM failure bricks an order permanently

- **Evidence:** `src/escrow.js:113-122` `reject()` sets state to `evidence-submitted`, intending a re-check (comment at `src/escrow.js:8`: "decided --reject--> evidence-submitted (re-check with new proof)"). But `evaluateDelivery` (`src/engine.js:38`) begins with `escrow.submitEvidence()`, which requires state `funded` (`src/escrow.js:55-57`). The same trap fires when `providers.samCount` throws (`src/engine.js:47`, outside any try/catch — only the Spark call at lines 61-68 is caught): the evidence transition has already happened, the decision never records, and no transition out of `evidence-submitted` remains reachable. The only recovery is the global `/demo/reset`, which destroys every other order and the whole chain.
- **Observed result (sandboxed harness):** both paths throw `cannot submit evidence from state evidence-submitted (needs funded)` on retry, permanently.
- **Why it matters here:** two ordinary demo events — a judge pressing reject and then re-running evidence, or one transient Meta API 503 — wedge an order with a 500 and no way forward short of wiping the demo. This contradicts the state machine's own documented design.
- **Fix:** make `evaluateDelivery` state-aware: if the escrow is already in `evidence-submitted` (post-reject or post-failure), skip `submitEvidence` (or add an explicit `resubmitEvidence` transition) and receipt the new attempt; wrap the SAM call so a provider failure receipts an `evidence-failed` event and returns the order to `funded`. Add core tests for reject→re-evidence and SAM-throws→retry.

### F5 — MEDIUM — Unsanitized `innerHTML` sinks fed by user input and LLM output (bounded today)

- **Evidence:** `public/index.html:223-230` builds `decisionBody.innerHTML` including `decision.explanation`, which is Muse Spark's free-text `reason` (`src/engine.js:62-64`); Spark's prompt is built from user-controlled mandate fields (`src/engine.js:55-60`, `mandatePromptText` at `src/mandate.js:59-65`). `public/index.html:236-246` `renderReceipts()` concatenates `r.data.concept` and `r.data.expectedCount` — raw JSON fields from `POST /orders` (`src/server.js:99-106`) — into `innerHTML`.
- **Verifier bound (agreed):** the shipped UI reads no URL/hash/order-id parameter; `currentOrder` is set only from the UI's own order creation with hard-coded concept/count (`public/index.html:251-255`). So today this is **self-XSS**, plus a payload stored in API/receipt responses that becomes stored XSS in any future or alternate renderer of `/receipts`. There is no session or token in this origin to steal, which further bounds impact. Severity would jump if orders ever become shareable by link.
- **Why it matters here:** the LLM-output-to-`innerHTML` path needs no attacker at all to be fragile — a model that emits markup (or is prompt-influenced via a crafted `concept`) injects it into the page. It is also the cheapest class of bug to eliminate now, before the UI grows a share view.
- **Fix:** render all dynamic strings via `textContent` (build the receipt rows and explanation block with DOM methods), or pass every interpolated value through an `escapeHtml` helper. Add a CSP header (see hardening notes) as a second layer.

### F6 — LOW — No type/range validation on mandate money fields (accounting corruption, not over-release)

- **Evidence:** `src/mandate.js:16-19` checks only truthiness of `expectedCount` / `totalAmount`. Negative, fractional, string, array, and object values pass `createMandate` and flow from `POST /orders` (`src/server.js:113-126`) into `releaseBand` and the receipts.
- **Verifier bound (finding downgraded from the hunt's framing):** this **cannot over-release** — `releaseBand` caps the full branch at exactly `totalAmount` (`src/mandate.js:46`), pro-rates the partial branch (lines 48-49), and `approve()` calls the rail only when `releaseAmount > 0` (`src/escrow.js:91`). Real impact: `NaN` percentages/amounts, negative settlements that skip the rail yet still transition to `settled`/`held` with a bogus settlement receipt, string amounts passed through verbatim, and full release against a negative `expectedCount` (any count ≥ a negative number). Receipt integrity — the product's selling point — is what suffers.
- **Related rounding observation (verifier):** `releasePct = Math.round(count / expected * 100)` (`src/mandate.js:48`) can round a just-short count up to 100% (199 of 200 → 100%), producing a "partial-hold" that releases the full amount. Bounded at under ~0.5% of `totalAmount`, but it contradicts the mandate's "release the share verified present" wording; consider flooring the percentage or computing `releaseAmount` from the exact fraction and deriving the displayed percentage from it.
- **Fix:** validate in `createMandate`: `expectedCount` must be an integer 1–100000, `totalAmount` a finite number > 0 (reject strings/objects outright), `concept` a string with a length cap. Throw 400 at the route on failure.

### F7 — LOW (MEDIUM the moment real data touches this code) — All orders and the full receipt chain are publicly readable; order IDs are enumerable

- **Evidence (added by the verifier; the hunt missed it):** `GET /receipts` (`src/server.js:76-77`) returns the **entire global chain** — every visitor's buyer, seller, concept, amounts, approver strings, explanations, evidence hashes — to any anonymous caller. `GET /orders/:id` (`src/server.js:118-122`) is enumerable because auto-IDs are sequential (`order-${++orderSeq}`, `src/server.js:115`) and client-chosen IDs are accepted.
- **Bound:** for this demo the data is synthetic and the README advertises a public receipt log, so today's impact is low — one visitor can watch/replay another's runs. It becomes a real confidentiality failure if any genuine order data ever flows through this code.
- **Fix:** none required for the synthetic demo if public receipts are the intended showpiece; before any real-data use, scope receipt/order reads per order (return only that order's receipts — the per-order filter already exists at `src/server.js:119-121`) and use unguessable order IDs.

### F8 — LOW — Upstream SAM error bodies are reflected to clients in 500 responses

- **Evidence (downgraded by the verifier):** the Spark arm of the original claim is dead — Spark errors embedding `resp.text()` (`src/providers.js:33`) are caught in `src/engine.js:65-68`, truncated to 200 chars, kept internal, and excluded from the returned decision. The live path is SAM only: `src/providers.js:83` throws `sam http ${status}: ${await resp.text()}`, `samCount` is uncaught (`src/engine.js:47`), and `src/server.js:146-147` returns `String(err.message)` to the client.
- **Secret check — rejected:** the API key appears only in the outbound `Authorization` header (`src/providers.js:10-13`); no error path interpolates it. A leak would require Meta's API to echo the bearer token in its own error body, for which there is no evidence.
- **Fix:** log upstream bodies server-side; return a generic `provider error` message (plus a correlation id) to clients. Apply the same generic-message policy in the top-level catch.

### F9 — LOW — `META_API_MODE` is documented but never read; spend mode is controlled by key presence alone

- **Evidence:** grep across the tree finds `META_API_MODE` only in `.env.example:3` and `README.md:40` (the Render deploy instructions tell the operator to set it). `src/providers.js:6-8` derives mode solely from whether `META_API_KEY` exists.
- **Why it matters here:** an operator who sets `META_API_MODE` expecting it to gate live spend (e.g. to force mock mode while a key is present) gets live paid calls instead. Configuration that silently does nothing is an incident waiting for a tired deploy night.
- **Fix:** either read the variable (`META_API_MODE=mock` forces mock providers even with a key set) or delete it from `.env.example` and the README so the docs match the code.

---

## Needs validation (no severity assigned, per skill rules)

- **Indirect, Meta-mediated SSRF via `imageDataUri`.** `POST /orders/:id/evidence` checks only that `imageDataUri` is truthy (`src/server.js:127`); `src/providers.js:63-77` forwards the string verbatim as `input_image.image_url` to Meta. This Node process never fetches the URL itself (its fetch target is hard-coded to `https://api.meta.ai/v1`), so at most this is a blind, upstream-mediated fetch/count oracle — **unverified** because establishing what Meta's fetcher will retrieve would require spending live API calls against third-party URLs, which this audit did not do. Fix regardless: allowlist `data:image/(png|jpeg|webp);base64,` (and the server's own `/assets` images) and reject anything else before it reaches the provider.

## Design limitations and hardening notes (not vulnerabilities under current boundaries)

- **The receipt chain is unkeyed.** `src/receipts.js:10-21` is plain `SHA256(JSON.stringify({seq, kind, data, prevHash}))` — no HMAC, signature, timestamp, or external anchor, over a mutable in-memory array. It detects the naive single-edit tampering the demo showcases (and `/demo/tamper` proves that), but anyone who can edit the store can recompute the chain and `verify()` returns `ok: true`. It proves internal consistency, not authenticity. If receipts are ever evidence in a real dispute, HMAC them with a server-side secret and anchor periodic chain heads somewhere external.
- **Container:** `Dockerfile` runs as root (no `USER`), base image `node:20-alpine` is not digest-pinned. Add `USER node` and pin the image before any non-demo deployment.
- **No security headers** on any response (`src/server.js`): no CSP (which would blunt F5), `X-Content-Type-Options`, or `frame-ancestors`. Render's TLS termination covers transport only. Add a small header block in the `send`/response paths.
- **Minor robustness quirk (not a vuln):** `/assets` lookup uses the whitelist object directly, so inherited keys like `toString` are truthy and produce a 500 on a missing file instead of a 404 (`src/server.js:47-52,68`). Use `Object.hasOwn(ASSETS, parts[1])`.

## Rejected candidates (disproved in the disproof pass / independent verification)

- **R1 — Prompt injection via `concept` steals or misdirects funds.** Disproved: `final` is always the `releaseBand` output (`src/engine.js:99-112`); Spark's proposal is used only for the explanation and the override flag. Injection can distort explanation text (that is F5's input), never amounts.
- **R2 — Path traversal via `/assets/:file`.** Disproved: exact-key whitelist (`src/server.js:47-52`); a traversal segment simply 404s.
- **R3 — Prototype pollution via order `id` or body fields.** Disproved: orders live in a `Map`; `createMandate` destructures named fields; no merge/`Object.assign`/dynamic-key assignment of user JSON exists anywhere in the tree.
- **R4 — API key committed to the repo / exposed via `.env`.** Disproved: `git ls-files` shows only `.env.example`; `.env` is ignored by git and Docker, mode 600; tree-wide secret scan found placeholders only. (The `.env` contents were never read.)
- **R5 — SAM over-count causes over-release.** Disproved: the band caps at 100% of `totalAmount` when count ≥ expected (`src/mandate.js:44-46`) and receipts the surplus as `overCount`.
- **R6 — API key leaks through the 500 error path.** Disproved: see F8. No error construction includes the key or headers.

## Coverage statement

All six source files, the UI, all three scripts, and the deploy/config files were read in full; hunting covered the attack-surface, auth/secrets, input-validation, money-logic, API-key, dependency/config, AI/LLM, resource-exhaustion, and data-isolation classes. Dependency risk is minimal by construction (zero npm packages; one base image). Not covered: live testing against the deployed Render instance or the real Meta API (out of scope and would spend credits), the planned x402 rail implementation (does not exist yet), and any code added after commit `aceb583`. One audit run is a sample, not a verdict of cleanliness — a second run after the fixes land is the skill's intended loop.

## Submission verdict

**Nothing in this report hard-blocks the Nov 4 submission.** The shipped demo moves synthetic value on a mock rail, so no finding exposes real funds or real user data today. However, four fixes are small, high-value, and should land before the Oct 30 feature freeze, in this order:

1. **F2 + F3** (body cap, basic rate limit, token-gate `/demo/*` + approve/reject) — these protect the live demo and the API credits during judging; without them the demo can be wiped or drained by any visitor.
2. **F1** (state transition before the rail await, plus a concurrent-approve test) — one-line class of fix to the exact money logic being judged; **mandatory before the live x402 rail is wired to this seam.**
3. **F4** (state-aware re-evaluation + SAM-failure rollback, plus tests) — prevents the two most likely judge-visible wedges.

F5–F9 are safe to schedule after the freeze if time runs out, with F5 first among them.
