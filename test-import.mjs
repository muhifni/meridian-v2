console.log("Before imports");
import "dotenv/config";
console.log("After dotenv");
import { agentLoop } from "./agent.js";
console.log("After agent import");
console.log("LLM_BASE_URL:", process.env.LLM_BASE_URL);
console.log("LLM_API_KEY:", process.env.LLM_API_KEY ? "SET" : "NOT SET");
console.log("LLM_MODEL:", process.env.LLM_MODEL);
console.log("Done");
