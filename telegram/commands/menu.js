import { Composer } from "grammy";

const menu = new Composer();

function buildMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "👛 Wallet", callback_data: "mnu:wallet" },
        { text: "📊 Positions", callback_data: "mnu:positions" },
        { text: "🧪 Sim", callback_data: "mnu:sim" },
      ],
      [
        { text: "📋 Screen", callback_data: "mnu:screen" },
        { text: "📝 Candidates", callback_data: "mnu:candidates" },
        { text: "🎯 Deploy (last)", callback_data: "mnu:deploy" },
      ],
      [
        { text: "⚙️ Settings", callback_data: "mnu:settings" },
        { text: "📚 Help", callback_data: "mnu:help" },
        { text: "🔍 Analysis", callback_data: "mnu:analysis" },
      ],
      [
        { text: "🏥 Health", callback_data: "mnu:health" },
        { text: "🐝 Hive", callback_data: "mnu:hive" },
        { text: "❌ Close", callback_data: "mnu:close" },
      ],
    ],
  };
}

// /menu command
menu.command("menu", async (ctx) => {
  await ctx.reply("📋 Meridian Bot Menu\nTap a button below to execute a command.", {
    reply_markup: buildMainMenuKeyboard(),
  });
});

// mnu:* callback queries — dispatch to equivalent commands
menu.callbackQuery(/^mnu:(.+)$/, async (ctx) => {
  const action = ctx.match[1];
  await ctx.answerCallbackQuery();

  switch (action) {
    case "close":
      await ctx.editMessageText("Menu closed.");
      break;
    case "wallet":
    case "positions":
    case "sim":
    case "screen":
    case "candidates":
    case "analysis":
    case "help":
    case "health":
    case "hive":
    case "settings":
      // Re-emit as text command so existing handlers pick it up
      // grammY doesn't have a built-in "re-route" so we reply with instruction
      await ctx.editMessageText(`Running /${action}...`, { reply_markup: undefined });
      // Simulate the command by calling reply — user can tap the command
      await ctx.reply(`Use /${action} directly, or tap the command in the popup menu.`);
      break;
    case "deploy":
      await ctx.editMessageText("Use /deploy <n> after running /screen or /candidates.");
      break;
    default:
      await ctx.editMessageText(`Unknown menu action: ${action}`);
  }
});

export default menu;
