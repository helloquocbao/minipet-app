import { AggregatorClient } from "@cetusprotocol/aggregator-sdk";

async function main() {
  console.log("Initializing AggregatorClient for Testnet...");
  
  // Set up clients
  const client = new AggregatorClient({
    endpoint: "https://api-sui.cetus.zone/router_v3/find_routes",
    env: 1, // Env.Testnet
    signer: "0x0000000000000000000000000000000000000000000000000000000000000000" // Dummy address for simulation
  });

  const fromToken = "0x2::sui::SUI";
  const toToken = "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC"; // Sui Testnet USDC
  const amount = "1000000000"; // 1 SUI (9 decimals)

  try {
    console.log(`Finding routes from SUI to USDC on Testnet for amount: ${amount}...`);
    const router = await client.findRouters({
      from: fromToken,
      target: toToken,
      amount: amount,
      byAmountIn: true,
    });

    console.log("Router found successfully:");
    console.log(JSON.stringify(router, null, 2));
  } catch (error) {
    console.error("Error finding router:", error);
  }
}

main();
