# SettleProof

Proof-gated agent payments for small marketplace sellers.

A buyer's payment is held under a written mandate. When the seller ships, they
upload delivery proof (a photo of the packed items). SAM 3.1 segments the photo
and counts the items; its count is deterministic and overrides the language
model. Muse Spark reads the mandate and the invoice, cross-checks the
evidence, and explains every release, partial hold, or hold in plain language.
Every decision is written to a tamper-evident, hash-chained receipt log that
anyone can click, challenge, and re-run.

Built for the Meta Global AI Developer Hackathon (Indie track, Build for Your
World), Oct 26 to Nov 4, 2026. Test value only; synthetic data throughout.

## Run

    npm start          # plain HTTP server on PORT (default 3004)
    npm run selftest   # receipt chain self-test

## Layout

- src/server.js     HTTP server: demo UI, order/evidence/approve endpoints
- src/mandate.js    the written mandate; drives both Spark's prompt text and
                    the deterministic release band, so they can never drift
- src/escrow.js     escrow state machine; every transition is receipted and
                    nothing settles without the human approval call
- src/engine.js     SAM count is law, Spark explains, engine enforces;
                    overrides and over-counts are flagged in the receipt
- src/receipts.js   hash-chained receipt log (append, verify, tamper check)
- src/providers.js  Meta Model API providers (Muse Spark, SAM 3.1) with mocks
- public/index.html the demo: annotated evidence view, money bar, receipts,
                    tamper test
- docs/SEPARATION_CHECKLIST.md  what is new here vs adapted from prior work
- docs/SMOKE_TEST.md, docs/BUILD_LOG.md  verification records

## Deploy

Dockerfile included. On Render: New, Web Service, connect this repo,
Docker auto-detected, set env vars META_API_KEY and META_API_MODE=standard.
The key stays server-side; never commit it (.env is gitignored).

Demo protection (from the Oct 27 security audit): request bodies are capped
(413 over the limit), the order and evidence routes carry basic per-IP rate
limits, order count is capped, and setting DEMO_TOKEN puts approve, reject,
and the /demo/* controls behind an operator token header; the presenter
opens the demo with ?token=<value> in the link. Order and receipt reads
stay public: the receipt log is the showpiece.
