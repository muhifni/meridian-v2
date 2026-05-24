import { bot, registerCommands, TOKEN } from "./bot.js";
import { ownerOnly } from "./middleware/auth.js";
import { logUpdates } from "./middleware/logging.js";
import { log } from "../logger.js";

// Commands
import help from "./commands/help.js";
import health from "./commands/health.js";
import positions from "./commands/positions.js";
import configCmd from "./commands/config.js";
import screening from "./commands/screening.js";
import reporting from "./commands/reporting.js";
import smartWallets from "./commands/smart-wallets.js";
import hive from "./commands/hive.js";
import control, { bindCronControls } from "./commands/control.js";

// ─── Middleware stack (order matters) ────────────────────────────
bot.use(ownerOnly);
bot.use(logUpdates);

// ─── Register command handlers ───────────────────────────────────
bot.use(help);
bot.use(health);
bot.use(positions);
bot.use(configCmd);
bot.use(screening);
bot.use(reporting);
bot.use(smartWallets);
bot.use(hive);
bot.use(control);

// ─── Launch ──────────────────────────────────────────────────────
export async function startBot() {
  if (!TOKEN) {
    log("telegram_warn", "Bot disabled — no TELEGRAM_BOT_TOKEN");
    return;
  }
  await registerCommands();
  bot.start({
    onStart: () => log("telegram", "grammY bot polling started"),
    drop_pending_updates: true,
  });
}

export function stopBot() {
  bot.stop();
}

export { bot, bindCronControls };
