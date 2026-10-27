// Read-only rail check: derive the treasury address from the key file and
// read its Base balances. The key value is never printed.
import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, formatUnits } from "viem";
import { base } from "viem/chains";

const keyPath = process.env.TREASURY_KEY_PATH || "/home/hatch/workspace/survival/treasury.key";
const raw = readFileSync(keyPath, "utf8").trim();
const account = privateKeyToAccount(raw.startsWith("0x") ? raw : `0x${raw}`);
console.log("derived address:", account.address);
console.log("matches recorded treasury:", account.address.toLowerCase() === "0xfa0f087225711972b3e19fcf3cb2bee06ec3192d");

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const erc20 = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }];
for (const rpc of ["https://mainnet.base.org", "https://base-rpc.publicnode.com"]) {
  try {
    const client = createPublicClient({ chain: base, transport: http(rpc) });
    const usdc = await client.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [account.address] });
    const eth = await client.getBalance({ address: account.address });
    console.log(`rpc ${rpc}: USDC ${formatUnits(usdc, 6)} | ETH ${formatUnits(eth, 18)}`);
    break;
  } catch (e) {
    console.log(`rpc ${rpc} failed: ${String(e.shortMessage || e.message).slice(0, 120)}`);
  }
}
