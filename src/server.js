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

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
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
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  const url = new URL(req.url, "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);

  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = readFileSync(new URL("../public/index.html", import.meta.url));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    }
    if (req.method === "GET" && parts[0] === "assets" && ASSETS[parts[1]]) {
      const data = readFileSync(new URL(`../test-assets/${parts[1]}`, import.meta.url));
      res.writeHead(200, { "content-type": ASSETS[parts[1]] });
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
      const target = [...chain.receipts].reverse().find((r) => r.kind === "decision");
      if (!target) return send(400, { error: "no decision receipt to tamper with yet" });
      target.data.releasePct = target.data.releasePct === 100 ? 55 : 100;
      return send(200, { tamperedSeq: target.seq, verify: chain.verify() });
    }
    if (req.method === "POST" && url.pathname === "/demo/reset") {
      resetState();
      return send(200, { ok: true });
    }

    // Create an order: mandate written, escrow funded. Demo amounts are
    // synthetic test value only.
    if (req.method === "POST" && url.pathname === "/orders") {
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
        const body = await readBody(req);
        if (!body.imageDataUri) return send(400, { error: "imageDataUri required" });
        const decision = await evaluateDelivery(escrow, body.imageDataUri);
        return send(200, { state: escrow.state, decision });
      }

      if (req.method === "POST" && parts[2] === "approve") {
        const body = await readBody(req);
        const settlement = await escrow.approve(body.approver || "human-demo");
        return send(200, { state: escrow.state, settlement });
      }

      if (req.method === "POST" && parts[2] === "reject") {
        const body = await readBody(req);
        escrow.reject(body.rejector || "human-demo", body.reason || "");
        return send(200, { state: escrow.state });
      }
    }

    return send(404, { error: "not found" });
  } catch (err) {
    return send(500, { error: String(err.message || err) });
  }
});

server.listen(port, () => {
  console.log(`settleproof listening on ${port} (providers: ${providerMode()}, rail: ${rail.mode || "mock"})`);
});
