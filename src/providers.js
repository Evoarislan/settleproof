// Provider seams for the Meta Model API (https://api.meta.ai/v1).
// Shapes verified live in the Oct 26, 2026 smoke test (docs/SMOKE_TEST.md).
// With no META_API_KEY set, mock implementations run at zero spend.

const BASE = "https://api.meta.ai/v1";
const hasKey = () => Boolean(process.env.META_API_KEY);

export const providerMode = () => (hasKey() ? "live" : "mock");

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.META_API_KEY}`,
    "Content-Type": "application/json",
  };
}

// Muse Spark decision call. Spark is a reasoning model: even at minimal
// effort it spends ~240 reasoning tokens before answering, and reasoning
// tokens count against max_tokens. Keep max_tokens generous (>=1200) or the
// answer comes back empty with finish_reason "length".
export async function sparkChat(messages, { maxTokens = 1200 } = {}) {
  if (!hasKey()) return null;
  const resp = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      model: "muse-spark-1.3",
      max_tokens: maxTokens,
      reasoning_effort: "minimal",
      messages,
    }),
  });
  if (!resp.ok) throw new Error(`spark http ${resp.status}: ${await resp.text()}`);
  const json = await resp.json();
  return {
    content: json.choices?.[0]?.message?.content ?? null,
    usage: json.usage ?? null,
    model: json.model,
  };
}

// Muse Spark condition check (vision). SAM counts items but cannot grade
// their condition from a text concept (verified Oct 27, 2026: damage prompts
// segment every box). Spark reads the photo and reports how many items are
// visibly damaged, with locations. The engine treats this as an assessment
// input to the deterministic band, disclosed as spark-vision in receipts.
export async function sparkCondition(imageDataUri) {
  if (!hasKey()) {
    return { provider: "mock-spark-vision", damagedCount: 0, totalVisible: null, notes: "mock condition check" };
  }
  const out = await sparkChat([
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "This is a delivery photo of items inside a shipping carton. Count how many of the items are visibly damaged (crushed, torn, dented, punctured, or soaked). Reply with a JSON object only: {\"damagedCount\": number, \"totalVisible\": number, \"notes\": string}. No other text.",
        },
        { type: "image_url", image_url: { url: imageDataUri } },
      ],
    },
  ]);
  let parsed = null;
  try {
    parsed = JSON.parse(out.content);
  } catch {
    const s = out.content?.indexOf("{");
    const e = out.content?.lastIndexOf("}");
    if (s >= 0 && e > s) {
      try {
        parsed = JSON.parse(out.content.slice(s, e + 1));
      } catch {
        parsed = null;
      }
    }
  }
  if (!parsed || typeof parsed.damagedCount !== "number") {
    throw new Error("spark condition check returned no usable JSON");
  }
  return { provider: "muse-spark-1.3-vision", ...parsed };
}

export async function sparkDecide(input) {
  if (!hasKey()) {
    return {
      provider: "mock-spark",
      decision: "hold",
      explanation:
        "Mock decision: evidence has not been checked by a live model yet.",
    };
  }
  const out = await sparkChat([{ role: "user", content: input.prompt }]);
  return { provider: "muse-spark-1.3", raw: out.content, usage: out.usage };
}

// SAM 3.1 evidence check via the Responses API (streaming). The output text
// carries one "<|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..|>" record plus an
// encoded one-bit mask per detected instance. The count of box records is
// the item count, and it is deterministic law in the decision engine: it
// overrides any language-model first impression.
export async function samCount(imageDataUri, concept) {
  if (!hasKey()) {
    return { provider: "mock-sam", count: null, boxes: [], masks: [] };
  }
  const resp = await fetch(`${BASE}/responses`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      model: "sam-3.1",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: concept },
            { type: "input_image", image_url: imageDataUri },
          ],
        },
      ],
      stream: true,
      metadata: { mask_encoding: "one_bit" },
    }),
  });
  if (!resp.ok) throw new Error(`sam http ${resp.status}: ${await resp.text()}`);
  const raw = await resp.text();
  let text = "";
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      const evt = JSON.parse(line.slice(6));
      if (evt.type === "response.output_text.delta") text += evt.delta || "";
    } catch {
      // ignore non-JSON stream lines
    }
  }
  const boxes = [];
  const re = /<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)\|>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    boxes.push({
      x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4], w: +m[5], h: +m[6],
    });
  }
  return { provider: "sam-3.1", count: boxes.length, boxes, rawText: text };
}
