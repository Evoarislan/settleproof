# Smoke test results — Oct 26, 2026 (day 1)

Both Meta models verified live against the real API from this repo's code
(`scripts/smoke-live.mjs`, `src/providers.js`). All test data synthetic.

## API surface (verified)
- Base URL: https://api.meta.ai/v1, Bearer key auth, OpenAI-compatible.
- Models on this account: muse-spark-1.3, muse-spark-1.3-contributor,
  muse-spark-1.2, muse-spark-1.2-contributor, muse-spark-1.1,
  muse-wonder-1.0, muse-image-1.0, muse-voice-transcribe-1.0, sam-3.1.
- Key note: the key as pasted in chat had a trailing "USD" that is NOT part
  of the key (auth failed with it, succeeded without). The working key is
  stored only in .env (mode 600, gitignored).

## Muse Spark 1.3 (chat completions)
- Works. ~2.2s latency on a small decision prompt.
- Reasoning model: reasoning tokens count against max_tokens. At
  max_tokens 300 the answer came back empty (finish_reason "length",
  298 reasoning tokens). At reasoning_effort "minimal" it still spends
  ~180-240 reasoning tokens. Rule: max_tokens >= 1200 for decision calls.
- Mandate-following is literal and correct: a binary mandate ("release only
  if all 10 present") produced hold / 0% on 9-of-10 evidence; a percentage
  mandate produced partial-hold / 90% with an accurate reason. The mandate
  clauses we write drive the decision bands, as designed.
- Cost per decision call: ~340 total tokens, about $0.002 at Standard list
  prices; drawn from hackathon credits while active.

## SAM 3.1 (Responses API, streaming)
- Endpoint: POST /v1/responses, model "sam-3.1", input message with
  input_text (concept phrase) + input_image (data URI works), stream true,
  metadata {"mask_encoding": "one_bit"}. There is no /v1/segment* path
  (five candidates probed, all 404).
- Output text carries one box record + encoded mask per instance:
  <|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..|> — parsed by regex in
  src/providers.js.
- Accuracy on the synthetic test image (test-assets/ten-boxes.png, 10 drawn
  boxes): count 10 of 10, box coordinates within 1px of ground truth.
- Latency ~1.6s per image. Usage reports images_processed: 1.
  List price $2.50 per 1,000 images ($0.0025 per check).

## Verdict
The build's highest-risk dependency (Lane C risk 1, SAM access and behavior)
is cleared on day 1. The full loop — photo in, SAM count, Spark decision with
mandate-driven release math — runs end to end through production code.
