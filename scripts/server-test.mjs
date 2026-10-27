// Server protection tests (audit F2/F3): body cap, per-IP rate limits, and
// the demo operator token gate. Boots a real server in mock mode on a test
// port with tightened limits. Run: node scripts/server-test.mjs
import assert from "node:assert";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3210;
const BASE = `http://localhost:${PORT}`;
const TOKEN = "test-token";

const child = spawn("node", ["src/server.js"], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(PORT),
    META_API_KEY: "", // force mock providers: zero spend
    DEMO_TOKEN: TOKEN,
    MAX_BODY_BYTES: "1024",
    MAX_ORDERS: "50",
    RATE_LIMIT_ORDERS_PER_MIN: "3",
    RATE_LIMIT_EVIDENCE_PER_MIN: "2",
  },
  stdio: "pipe",
});

async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not come up");
}

async function post(path, body, headers = {}) {
  const resp = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await resp.json();
  } catch {
    // no body
  }
  return { status: resp.status, json };
}

try {
  await waitUp();
  const health = await (await fetch(`${BASE}/health`)).json();
  assert.equal(health.providers, "mock");
  console.log("0. server up in mock mode: ok");

  // 1. Body cap: an oversized body is rejected 413 before any processing.
  const big = JSON.stringify({ concept: "x".repeat(2000), expectedCount: 10, totalAmount: 120 });
  const r413 = await post("/orders", big);
  assert.equal(r413.status, 413);
  console.log("1. body cap 413: ok");

  // 2. Orders rate limit (3/min): two creates succeed, the next is 429.
  //    (The oversized request above consumed the first slot.)
  const o1 = await post("/orders", { concept: "white product box", expectedCount: 10, totalAmount: 120 });
  assert.equal(o1.status, 201);
  const o2 = await post("/orders", { concept: "white product box", expectedCount: 10, totalAmount: 120 });
  assert.equal(o2.status, 201);
  const o3 = await post("/orders", { concept: "white product box", expectedCount: 10, totalAmount: 120 });
  assert.equal(o3.status, 429);
  console.log("2. orders rate limit 429: ok");

  // 3. Token gate: approve without the token is 401; with the token the
  //    request reaches the state machine (funded order cannot approve yet).
  const id1 = o1.json.mandate.id;
  const noTok = await post(`/orders/${id1}/approve`, { approver: "mallory" });
  assert.equal(noTok.status, 401);
  const withTok = await post(`/orders/${id1}/approve`, {}, { "x-demo-token": TOKEN });
  assert.notEqual(withTok.status, 401);
  assert.match(String(withTok.json.error || ""), /cannot approve/);
  console.log("3. approve token gate: ok");

  // 4. Evidence rate limit (2/min): first call runs (mock decision), the
  //    third call in the window is 429.
  const id2 = o2.json.mandate.id;
  const evBody = { imageDataUri: "data:image/png;base64,stub" };
  const e1 = await post(`/orders/${id2}/evidence`, evBody);
  assert.equal(e1.status, 200);
  await post(`/orders/${id2}/evidence`, evBody); // decided already; consumes budget
  const e3 = await post(`/orders/${id2}/evidence`, evBody);
  assert.equal(e3.status, 429);
  console.log("4. evidence rate limit 429: ok");

  // 5. Demo controls are gated: reset without token 401, with token 200.
  const rsNo = await post("/demo/reset", {});
  assert.equal(rsNo.status, 401);
  const rsYes = await post("/demo/reset", {}, { "x-demo-token": TOKEN });
  assert.equal(rsYes.status, 200);
  console.log("5. demo reset token gate: ok");

  console.log("server tests: all passed");
} finally {
  child.kill("SIGKILL");
}
