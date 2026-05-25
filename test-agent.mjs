import OpenAI from "openai";

const client = new OpenAI({
  baseURL: process.env.LLM_BASE_URL || "http://localhost:20128/v1",
  apiKey: process.env.LLM_API_KEY || "sk-450aec8df60db8ec-ugf8ut-de49481f",
  timeout: 5 * 60 * 1000,
});

function withTimeout(promise, ms) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function testAgentLoop() {
  console.log("Before agentLoop");
  const start = Date.now();
  
  try {
    const result = await withTimeout(
      client.chat.completions.create({
        model: "deepseek-v4-pro-combo",
        messages: [
          { role: "system", content: "You are a screener." },
          { role: "user", content: "Say hi and call get_top_candidates tool" }
        ],
        tools: [
          { type: "function", function: { name: "get_top_candidates", description: "Get pools", parameters: { type: "object", properties: {} } } }
        ],
        tool_choice: "auto",
        temperature: 0.35,
        max_tokens: 2048,
      }).then(response => {
        console.log("Response received:", JSON.stringify(response.choices[0].message).slice(0,200));
        return { content: response.choices[0].message.content || "done" };
      }),
      180000
    );
    
    console.log("After withTimeout, result:", result);
    console.log("Elapsed:", (Date.now() - start) / 1000, "s");
    
    if (!result) {
      console.log("TIMEOUT!");
    }
  } catch (err) {
    console.log("ERROR:", err.message);
  }
}

testAgentLoop();
