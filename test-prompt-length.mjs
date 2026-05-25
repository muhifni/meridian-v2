
import { buildSystemPrompt } from "./prompt.js";

const prompt = buildSystemPrompt("SCREENER", {sol: 0.00194}, {total_positions: 0, positions: []}, null, null, null, null, null);
console.log("Prompt length:", prompt.length, "chars");
console.log("Estimated tokens:", Math.round(prompt.length / 4), "tokens");
