import { Composer } from "grammy";

const help = new Composer();

const HELP_TEXT = `🎛 Meridian Bot Commands

/menu — Inline command menu
/positions — List open positions
/close <idx> — Close position by index
/closeall — Close all positions
/pool <addr> — Pool detail
/set <key> <val> — Quick config set

/screen — Refresh candidate list
/candidates — Show last candidates
/deploy <idx> — Deploy to candidate

/config — Show runtime config
/settings — Settings menu (inline)

/briefing — Morning briefing
/analysis — Deep analysis
/sim — Dry run stats

/health — Check all external services
/wallet — Wallet balance
/status — Bot status overview

/hive — HiveMind sync status
/hive pull — Manual HiveMind pull

/pause — Stop cron cycles
/resume — Resume cron cycles
/stop — Graceful shutdown

/help — This message`;

help.command("help", (ctx) => ctx.reply(HELP_TEXT));
help.command("start", (ctx) => ctx.reply(HELP_TEXT));

export default help;
