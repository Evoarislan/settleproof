// Payment rails. The escrow calls one seam: settle({amount, currency, to,
// memo}) -> {txRef, ...}. Two implementations:
//
// - mockRail: records the intent and returns a reference. This is the default
//   everywhere, including the public demo, so clicking around never spends.
// - liveRail: moves real USDC on Base from the treasury wallet to the demo
//   seller wallet. Enabled only when SETTLEPROOF_RAIL=live and the treasury
//   key path and seller address are set. Demo amounts are converted at
//   DEMO_USDC_RATE (default 0.01: a $120.00 order settles 1.2 USDC), and the
//   rate and real amount are returned so they land in the receipt. Nothing
//   about the conversion is hidden.
//
// The treasury key is read from a file path outside this repo and is never
// logged or receipted.

import { readFileSync, existsSync } from "node:fs";
import { mockRail } from "./escrow.js";

export { mockRail };

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
];

export async function createLiveRail({ keyPath, sellerAddress, rate = 0.01, rpcUrl }) {
  // Loaded lazily so mock mode (and the public image) never needs viem.
  const { createWalletClient, createPublicClient, http, parseUnits } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const { base } = await import("viem/chains");

  const raw = readFileSync(keyPath, "utf8").trim();
  const account = privateKeyToAccount(raw.startsWith("0x") ? raw : `0x${raw}`);
  const transport = http(rpcUrl || "https://mainnet.base.org");
  const wallet = createWalletClient({ account, chain: base, transport });
  const pub = createPublicClient({ chain: base, transport });

  return {
    mode: "live",
    async settle({ amount, memo }) {
      const usdcAmount = Math.round(amount * rate * 1e6) / 1e6;
      if (usdcAmount <= 0) {
        return { txRef: null, usdcAmount: 0, rate, note: "amount below live rail minimum" };
      }
      const hash = await wallet.writeContract({
        address: USDC_BASE,
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [sellerAddress, parseUnits(usdcAmount.toFixed(6), 6)],
      });
      const receipt = await pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error(`live rail transfer failed on chain: ${hash}`);
      }
      return {
        txRef: hash,
        usdcAmount,
        rate,
        chain: "base",
        from: account.address,
        to: sellerAddress,
        memo,
      };
    },
  };
}

// Rail selection from the environment. Anything short of a fully configured
// live setup falls back to the mock rail.
export async function selectRail(env = process.env) {
  const keyPath = env.TREASURY_KEY_PATH;
  const sellerAddress = env.SELLER_ADDRESS;
  if (env.SETTLEPROOF_RAIL === "live" && keyPath && sellerAddress && existsSync(keyPath)) {
    const rate = Number(env.DEMO_USDC_RATE || 0.01);
    return createLiveRail({ keyPath, sellerAddress, rate, rpcUrl: env.BASE_RPC_URL });
  }
  return { ...mockRail, mode: "mock" };
}
