import { createHash } from "node:crypto";

// Tamper-evident receipt chain: each receipt links to the previous hash.
// Editing any earlier receipt breaks verification of the whole chain.
export class ReceiptChain {
  constructor() {
    this.receipts = [];
  }

  static hashPayload(payload) {
    return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  }

  append(kind, data) {
    const prevHash = this.receipts.length
      ? this.receipts[this.receipts.length - 1].hash
      : "GENESIS";
    const seq = this.receipts.length + 1;
    const body = { seq, kind, data, prevHash };
    const hash = ReceiptChain.hashPayload(body);
    const receipt = { ...body, hash };
    this.receipts.push(receipt);
    return receipt;
  }

  verify() {
    let prevHash = "GENESIS";
    for (const r of this.receipts) {
      const expected = ReceiptChain.hashPayload({
        seq: r.seq,
        kind: r.kind,
        data: r.data,
        prevHash: r.prevHash,
      });
      if (r.prevHash !== prevHash || r.hash !== expected) {
        return { ok: false, brokenAt: r.seq };
      }
      prevHash = r.hash;
    }
    return { ok: true, length: this.receipts.length };
  }
}
