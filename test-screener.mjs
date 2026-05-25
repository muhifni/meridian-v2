import "dotenv/config";
import { agentLoop } from "./agent.js";

console.log("=== Testing SCREENER Agent Loop ===\n");

const result = await agentLoop(
  `SCREENING CYCLE\nStrategy: evil-panda\nPositions: 0/3 | SOL: 0.002 | Deploy: 0.15 SOL\n\nPRE-LOADED CANDIDATES (0 pools):\n\nSTEPS:\n1. Decide if any candidate is actually worth deploying.\n2. Pick the best candidate.\n3. Call deploy_position.\n4. Report results.`,
  18,
  [],
  "SCREENER",
  "deepseek-v4-pro-combo",
  2048
);

console.log("\n=== Result ===");
console.log(result);
