import { Composer } from "grammy";
import { config } from "../../config.js";
import {
  isHiveMindEnabled,
  ensureAgentId,
  getHiveMindPullMode,
  registerHiveMindAgent,
  pullHiveMindLessons,
  pullHiveMindPresets,
} from "../../hivemind.js";

const hive = new Composer();

// /hive, /hive pull
hive.hears(/^\/hive(\s+pull)?$/i, async (ctx) => {
  try {
    const enabled = isHiveMindEnabled();
    const agentId = ensureAgentId();
    if (!enabled) {
      await ctx.reply(`HiveMind: disabled\nAgent ID: ${agentId}\nSet hiveMindApiKey to connect.`);
      return;
    }
    const isManualPull = ctx.match[1]?.trim() === "pull";
    const pullMode = getHiveMindPullMode();
    const [registerResult, lessons, presets] = await Promise.all([
      registerHiveMindAgent({ reason: isManualPull ? "telegram_pull" : "telegram_status" }),
      (pullMode === "auto" || isManualPull) ? pullHiveMindLessons(12) : Promise.resolve(null),
      (pullMode === "auto" || isManualPull) ? pullHiveMindPresets() : Promise.resolve(null),
    ]);
    await ctx.reply([
      "HiveMind: enabled",
      `Agent ID: ${agentId}`,
      `URL: ${config.hiveMind.url}`,
      `Pull mode: ${pullMode}`,
      `Register: ${registerResult ? "ok" : "warn"}`,
      `Shared lessons: ${Array.isArray(lessons) ? lessons.length : (pullMode === "manual" ? "manual" : 0)}`,
      `Presets: ${Array.isArray(presets) ? presets.length : (pullMode === "manual" ? "manual" : 0)}`,
      isManualPull ? "Manual pull: completed" : null,
    ].filter(Boolean).join("\n"));
  } catch (e) {
    await ctx.reply(`HiveMind error: ${e.message}`);
  }
});

export default hive;
