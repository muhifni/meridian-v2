
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: process.env.LLM_BASE_URL || "http://localhost:20128/v1",
  apiKey: process.env.LLM_API_KEY || "sk-450aec8df60db8ec-ugf8ut-de49481f",
  timeout: 5 * 60 * 1000,
});

// Simulate a long system prompt like Meridian
const longPrompt = `
You are an autonomous DLMM LP agent for Meteora on Solana.
Your task is to screen pools and deploy positions.
Current portfolio: 0 positions, 0.00194 SOL.
Lessons learned: none.
Performance: no data.
`.repeat(20); // Make it long

const tools = [
  { type: "function", function: { name: "deploy_position", description: "Deploy LP", parameters: { type: "object", properties: { pool_address: { type: "string" } }, required: ["pool_address"] } } },
  { type: "function", function: { name: "get_top_candidates", description: "Get candidates", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_token_holders", description: "Get holders", parameters: { type: "object", properties: { mint: { type: "string" } }, required: ["mint"] } } },
  { type: "function", function: { name: "get_token_narrative", description: "Get narrative", parameters: { type: "object", properties: { mint: { type: "string" } }, required: ["mint"] } } },
  { type: "function", function: { name: "get_token_info", description: "Get info", parameters: { type: "object", properties: { mint: { type: "string" } }, required: ["mint"] } } },
  { type: "function", function: { name: "search_pools", description: "Search pools", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
  { type: "function", function: { name: "get_pool_memory", description: "Get memory", parameters: { type: "object", properties: { pool_address: { type: "string" } }, required: ["pool_address"] } } },
  { type: "function", function: { name: "check_smart_wallets_on_pool", description: "Check smart wallets", parameters: { type: "object", properties: { pool_address: { type: "string" } }, required: ["pool_address"] } } },
  { type: "function", function: { name: "get_wallet_balance", description: "Get balance", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_my_positions", description: "Get positions", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_active_bin", description: "Get active bin", parameters: { type: "object", properties: { pool_address: { type: "string" } }, required: ["pool_address"] } } },
];

async function test() {
  console.log("Starting complex test...");
  const start = Date.now();
  try {
    const response = await client.chat.completions.create({
      model: "deepseek-v4-pro-combo",
      messages: [
        { role: "system", content: longPrompt },
        { role: "user", content: "Screen for pools and deploy into the best candidate" }
      ],
      tools: tools,
      tool_choice: "auto",
      temperature: 0.35,
      max_tokens: 2048,
    });
    console.log("SUCCESS! Time:", (Date.now() - start) / 1000, "s");
    console.log("Model:", response.model);
    console.log("Content:", response.choices[0].message.content?.slice(0,100));
    console.log("Tool calls:", response.choices[0].message.tool_calls?.length || 0);
  } catch (err) {
    console.log("ERROR! Time:", (Date.now() - start) / 1000, "s");
    console.log("Error:", err.message);
    console.log("Code:", err.code);
  }
}

test();
