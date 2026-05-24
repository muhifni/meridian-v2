import { Composer } from "grammy";
import { generateBriefing } from "../../briefing.js";
import { getVirtualSummary } from "../../dry-run-simulator.js";
import { getCausalAnalysisSummary } from "../../causal-analysis.js";

const reporting = new Composer();

// /briefing
reporting.command("briefing", async (ctx) => {
  try {
    const briefing = await generateBriefing();
    await ctx.reply(briefing, { parse_mode: "HTML" });
  } catch (e) {
    await ctx.reply(`Error: ${e.message}`);
  }
});

// /sim
reporting.command("sim", async (ctx) => {
  await ctx.reply(getVirtualSummary());
});

// /analysis
reporting.command("analysis", async (ctx) => {
  await ctx.reply(getCausalAnalysisSummary());
});

export default reporting;
