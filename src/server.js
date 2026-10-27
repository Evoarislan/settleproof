import { createServer } from "node:http";
import { ReceiptChain } from "./receipts.js";
import { providerMode } from "./providers.js";
import { createMandate } from "./mandate.js";
import { Escrow } from "./escrow.js";
import { evaluateDelivery } from "./engine.js";
import { selectRail } from "./rail.js";

// Load .env if present (no dependency; tiny parser).
import { readFileSync, existsSync } from "node:fs";
if (existsSync(new URL("../.env", import.meta.url))) {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.startsWith("#")) {
      process.env[line.slice(0, i).trim()] ??= line.slice(i + 1).trim();
    }
  }
}

const port = Number(process.env.PORT || 3004);

// Payment rail: mock by default; the live Base USDC rail engages only when
// SETTLEPROOF_RAIL=live with a treasury key path and seller address set.
const rail = await selectRail();

let chain;
let orders;
let orderSeq;
function resetState() {
  chain = new ReceiptChain();
  chain.append("boot", { app: "settleproof", synthetic: true });
  orders = new Map();
  orderSeq = 0;
}
resetState();

// Demo protection (audit F2/F3): body cap, basic per-IP rate limits on the
// spend routes, an order capacity cap, and a shared operator token on the
// state-changing routes (/demo/*, approve, reject). The token gate is active
// only when DEMO_TOKEN is set; local development without it stays open.
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 12 * 1024 * 1024);
const MAX_ORDERS = Number(process.env.MAX_ORDERS || 200);
const RATE_ORDERS_PER_MIN = Number(process.env.RATE_LIMIT_ORDERS_PER_MIN || 30);
const RATE_EVIDENCE_PER_MIN = Number(process.env.RATE_LIMIT_EVIDENCE_PER_MIN || 10);
const DEMO_TOKEN = process.env.DEMO_TOKEN || "";

const buckets = new Map();
function rateOk(key, limit, windowMs = 60000) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    buckets.set(key, arr);
    return false;
  }
  arr.push(now);
  buckets.set(key, arr);
  return true;
}
function clientIp(req) {
  // Key on the LAST X-Forwarded-For entry: the one appended by the proxy
  // closest to this server. The first entry is whatever the client claims
  // and is trivially forged, which would let a caller rotate fake IPs and
  // never hit a rate limit (verified by probe, Oct 27 swarm loop).
  const xff = req.headers["x-forwarded-for"];
  if (xff) {
    const entries = String(xff).split(",").map((s) => s.trim()).filter(Boolean);
    if (entries.length) return entries[entries.length - 1];
  }
  return req.socket.remoteAddress || "unknown";
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on("data", (c) => {
      if (settled) return; // overflow: keep draining, discard, stay bounded
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        settled = true;
        const err = new Error("request body too large");
        err.status = 413;
        reject(err);
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", (e) => {
      if (!settled) {
        settled = true;
        reject(e);
      }
    });
  });
}

const ASSETS = {
  "real-ten.jpg": "image/jpeg",
  "real-nine.jpg": "image/jpeg",
  "real-damaged.jpg": "image/jpeg",
  "ten-boxes.png": "image/png",
  "nine-boxes.png": "image/png",
};

const server = createServer(async (req, res) => {
  const send = (code, obj) => {
    res.writeHead(code, {
      "content-type": "application/json",
      "x-content-type-options": "nosniff",
    });
    res.end(JSON.stringify(obj));
  };
  const url = new URL(req.url, "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);
  const ip = clientIp(req);
  const requireToken = () => {
    if (!DEMO_TOKEN) return true;
    if (req.headers["x-demo-token"] === DEMO_TOKEN) return true;
    send(401, { error: "demo operator token required" });
    return false;
  };

  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = readFileSync(new URL("../public/index.html", import.meta.url));
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "x-content-type-options": "nosniff",
        // The page is a single inline file; the CSP still fences it to
        // same-origin code and self/data/blob images (audit F5 hardening).
        "content-security-policy":
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'",
      });
      return res.end(html);
    }
    if (req.method === "GET" && parts[0] === "assets" && ASSETS[parts[1]]) {
      const data = readFileSync(new URL(`../test-assets/${parts[1]}`, import.meta.url));
      res.writeHead(200, {
        "content-type": ASSETS[parts[1]],
        "x-content-type-options": "nosniff",
      });
      return res.end(data);
    }
    if (req.method === "GET" && url.pathname === "/health") {
      return send(200, { ok: true, providers: providerMode(), rail: rail.mode || "mock", chain: chain.verify() });
    }
    if (req.method === "GET" && url.pathname === "/receipts") {
      return send(200, { receipts: chain.receipts, verify: chain.verify() });
    }

    // Demo controls: tamper rewrites a past decision receipt so visitors can
    // watch the chain break; reset restores a clean demo state.
    if (req.method === "POST" && url.pathname === "/demo/tamper") {
      if (!requireToken()) return;
      const target = [...chain.receipts].reverse().find((r) => r.kind === "decision");
      if (!target) return send(400, { error: "no decision receipt to tamper with yet" });
      target.data.releasePct = target.data.releasePct === 100 ? 55 : 100;
      return send(200, { tamperedSeq: target.seq, verify: chain.verify() });
    }
    if (req.method === "POST" && url.pathname === "/demo/reset") {
      if (!requireToken()) return;
      resetState();
      return send(200, { ok: true });
    }

    // Create an order: mandate written, escrow funded. Demo amounts are
    // synthetic test value only.
    if (req.method === "POST" && url.pathname === "/orders") {
      if (!rateOk(`orders:${ip}`, RATE_ORDERS_PER_MIN)) {
        return send(429, { error: "rate limit exceeded" });
      }
      if (orders.size >= MAX_ORDERS) {
        return send(429, { error: "demo order capacity reached" });
      }
      const body = await readBody(req);
      const id = body.id || `order-${++orderSeq}`;
      if (orders.has(id)) return send(409, { error: `order ${id} exists` });
      const mandate = createMandate({
        id,
        buyer: body.buyer || "buyer-demo",
        seller: body.seller || "seller-demo",
        concept: body.concept,
        expectedCount: body.expectedCount,
        totalAmount: body.totalAmount,
        currency: body.currency || "USD-TEST",
      });
      const escrow = new Escrow(mandate, chain, rail);
      escrow.fund();
      orders.set(id, escrow);
      return send(201, escrow.snapshot());
    }

    if (parts[0] === "orders" && parts[1]) {
      const escrow = orders.get(parts[1]);
      if (!escrow) return send(404, { error: "order not found" });

      if (req.method === "GET" && parts.length === 2) {
        const receipts = chain.receipts.filter(
          (r) => r.data && r.data.mandateId === parts[1]
        );
        return send(200, { ...escrow.snapshot(), receipts, chainValid: chain.verify().ok });
      }

      if (req.method === "POST" && parts[2] === "evidence") {
        if (!rateOk(`evidence:${ip}`, RATE_EVIDENCE_PER_MIN)) {
          return send(429, { error: "rate limit exceeded" });
        }
        const body = await readBody(req);
        if (!body.imageDataUri) return send(400, { error: "imageDataUri required" });
        const decision = await evaluateDelivery(escrow, body.imageDataUri);
        return send(200, { state: escrow.state, decision });
      }

      if (req.method === "POST" && parts[2] === "approve") {
        if (!requireToken()) return;
        const body = await readBody(req);
        // With a token configured, the recorded approver is the server-side
        // operator identity, never free text from the request body (F3).
        const approver = DEMO_TOKEN ? "demo-operator" : body.approver || "human-demo";
        const settlement = await escrow.approve(approver);
        return send(200, { state: escrow.state, settlement });
      }

      if (req.method === "POST" && parts[2] === "reject") {
        if (!requireToken()) return;
        const body = await readBody(req);
        const rejector = DEMO_TOKEN ? "demo-operator" : body.rejector || "human-demo";
        escrow.reject(rejector, body.reason || "");
        return send(200, { state: escrow.state });
      }
    }

    return send(404, { error: "not found" });
  } catch (err) {
    const msg = String(err.message || err);
    if (err.status) return send(err.status, { error: msg });
    // Upstream provider bodies stay server-side (audit F8): the client
    // gets a generic 502, never the raw Meta API error text.
    if (/^(sam|spark) http \d+/.test(msg)) {
      console.error("provider error:", msg);
      return send(502, { error: "upstream provider error" });
    }
    return send(500, { error: msg });
  }
});

server.listen(port, () => {
  console.log(`settleproof listening on ${port} (providers: ${providerMode()}, rail: ${rail.mode || "mock"})`);
});
