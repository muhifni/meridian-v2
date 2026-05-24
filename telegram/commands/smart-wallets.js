import { Composer } from "grammy";
import { listSmartWallets } from "../../smart-wallets.js";

const smartWallets = new Composer();

// /smart_wallets
smartWallets.command("smart_wallets", async (ctx) => {
  try {
    const { wallets, total } = listSmartWallets();
    if (total === 0) {
      await ctx.reply("No smart wallets tracked yet.\nUse the agent to add wallets via study data.");
      return;
    }
    const lines = wallets.map((w, i) => {
      const sourceIcon = w.source === "auto" ? "🤖" : w.source === "twitter_kol" ? "🐦" : "👤";
      const typeIcon = w.type === "holder" || w.type === "kol" ? "👁️" : "💰";
      let stats;
      if (w.type === "holder" || w.type === "kol") {
        const trend = w.stats?.cluster_trend || "unknown";
        const holding = w.stats?.holding_pct ? `${w.stats.holding_pct}%` : "N/A";
        stats = ` | 👁️ holder | trend=${trend} | holding=${holding}`;
      } else if (w.stats?.total_positions_observed) {
        const wr = w.stats.win_rate != null ? `${(w.stats.win_rate * 100).toFixed(0)}%` : "?";
        const pnl = w.stats.avg_pnl_pct != null ? `avg+${w.stats.avg_pnl_pct.toFixed(1)}%` : "";
        stats = ` | ${typeIcon} ${wr} | ${w.stats.total_positions_observed}pos | ${pnl}`;
      } else {
        stats = "";
      }
      return `${i + 1}. ${sourceIcon} ${w.name} (${w.category})\n   ${w.address.slice(0, 8)}...${w.address.slice(-4)}${stats}`;
    });
    const autoCount = wallets.filter(w => w.source === "auto").length;
    const twitterCount = wallets.filter(w => w.source === "twitter_kol").length;
    const manualCount = total - autoCount - twitterCount;
    await ctx.reply(
      `👛 Smart Wallets (${total} total — 🤖 ${autoCount} auto, 🐦 ${twitterCount} twitter, 👤 ${manualCount} manual)\n\n` +
      lines.join("\n\n")
    );
  } catch (e) {
    await ctx.reply(`Error: ${e.message}`);
  }
});

export default smartWallets;
