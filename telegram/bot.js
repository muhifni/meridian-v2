import { Bot, session } from "grammy";
import { log } from "../logger.js";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  log("telegram_error", "TELEGRAM_BOT_TOKEN not set — bot disabled");
}

const bot = new Bot(TOKEN || "dummy");

// ─── Session ─────────────────────────────────────────────────────
bot.use(session({
  initial: () => ({
    candidates: [],
    lastBriefing: null,
    step: "idle",
  }),
}));

// ─── Auto-sync command popup on boot ─────────────────────────────
async function registerCommands() {
  if (!TOKEN) return;
  try {
    await bot.api.setMyCommands([
      { command: "menu", description: "Inline command menu" },
      { command: "positions", description: "List open positions" },
      { command: "health", description: "Check all external services" },
      { command: "config", description: "Show runtime config" },
      { command: "screen", description: "Refresh candidate list" },
      { command: "summary", description: "Agent-generated summary" },
      { command: "briefing", description: "Morning briefing" },
      { command: "sim", description: "Dry run stats" },
      { command: "wallet", description: "Wallet balance" },
      { command: "hive", description: "HiveMind sync status" },
      { command: "help", description: "Show all commands" },
    ]);
    log("telegram", "Commands registered via setMyCommands");
  } catch (e) {
    log("telegram_warn", `setMyCommands failed: ${e.message}`);
  }
}

// ─── Global error handler ────────────────────────────────────────
bot.catch((err) => {
  const ctx = err.ctx;
  const updateType = ctx?.update?.message ? "message" : ctx?.update?.callback_query ? "callback_query" : "unknown";
  log("telegram_error", `[${updateType}] ${err.error?.message || err.message || "unknown error"}`);
});

export { bot, registerCommands, TOKEN };
