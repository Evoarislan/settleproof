// Read-only: print the demo seller wallet's USDC balance on Base.
import { createPublicClient, http, formatUnits } from "viem";
import { base } from "viem/chains";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const SELLER = "0x4BC04F353D14d4d7F956c13638a031988Edc9330";
const abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
];
const client = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
const bal = await client.readContract({
  address: USDC,
  abi,
  functionName: "balanceOf",
  args: [SELLER],
});
console.log("seller USDC balance:", formatUnits(bal, 6));
