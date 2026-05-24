import { Composer } from "grammy";
import { getMyPositions, closePosition } from "../../tools/dlmm.js";
import { config } from "../../config.js";
import { getWalletBalances } from "../../tools/wallet.js";
import { setPositionInstruction } from "../../state.js";

const positions = new Composer();

// /wallet, /status
positions.command(["wallet", "status"], async (ctx) => {
  try {
    const [wallet, pos] = await Promise.all([getWalletBalances(), getMyPositions({ force: true })]);
    const suffix = ctx.message.text.startsWith("/status") && pos.total_positions
      ? "\n\nUse /positions for the numbered list."
      : "";
    await ctx.reply(`${formatWalletStatus(wallet, pos)}${suffix}`);
  } catch (e) {
    await ctx.reply(`Error: ${e.message}`);
  }
});

// /positions
positions.command("positions", async (ctx) => {
  try {
    const { positions: pos, total_positions } = await getMyPositions({ force: true });
    if (total_positions === 0) { await ctx.reply("No open positions."); return; }
    const cur = config.management.solMode ? "◎" : "$";
    const lines = pos.map((p, i) => {
      const pnl = p.pnl_usd >= 0 ? `+${cur}${p.pnl_usd}` : `-${cur}${Math.abs(p.pnl_usd)}`;
      const age = p.age_minutes != null ? `${p.age_minutes}m` : "?";
      const oor = !p.in_range ? " ⚠️OOR" : "";
      return `${i + 1}. ${p.pair} | ${cur}${p.total_value_usd} | PnL: ${pnl} | fees: ${cur}${p.unclaimed_fees_usd} | ${age}${oor}`;
    });
    await ctx.reply(`📊 Open Positions (${total_positions}):\n\n${lines.join("\n")}\n\n/close <n> to close | /set <n> <note> to set instruction`);
  } catch (e) { await ctx.reply(`Error: ${e.message}`); }
});

// /pool <n>
positions.hears(/^\/pool\s+(\d+)$/i, async (ctx) => {
  try {
    const idx = parseInt(ctx.match[1]) - 1;
    const { positions: pos } = await getMyPositions({ force: true });
    if (idx < 0 || idx >= pos.length) { await ctx.reply("Invalid number. Use /positions first."); return; }
    const p = pos[idx];
    await ctx.reply([
      `${idx + 1}. ${p.pair}`,
      `Pool: ${p.pool}`,
      `Position: ${p.position}`,
      `Range: ${p.lower_bin} → ${p.upper_bin} | active ${p.active_bin}`,
      `PnL: ${p.pnl_pct ?? "?"}% | fees: ${config.management.solMode ? "◎" : "$"}${p.unclaimed_fees_usd ?? "?"}`,
      `Value: ${config.management.solMode ? "◎" : "$"}${p.total_value_usd ?? "?"}`,
      `Age: ${p.age_minutes ?? "?"}m | ${p.in_range ? "IN RANGE" : `OOR ${p.minutes_out_of_range ?? 0}m`}`,
      p.instruction ? `Note: ${p.instruction}` : null,
    ].filter(Boolean).join("\n"));
  } catch (e) { await ctx.reply(`Error: ${e.message}`); }
});

// /close <n>
positions.hears(/^\/close\s+(\d+)$/i, async (ctx) => {
  try {
    const idx = parseInt(ctx.match[1]) - 1;
    const { positions: pos } = await getMyPositions({ force: true });
    if (idx < 0 || idx >= pos.length) { await ctx.reply("Invalid number. Use /positions first."); return; }
    const p = pos[idx];
    await ctx.reply(`Closing ${p.pair}...`);
    const result = await closePosition({ position_address: p.position });
    if (result.success) {
      const closeTxs = result.close_txs?.length ? result.close_txs : result.txs;
      const claimNote = result.claim_txs?.length ? `\nClaim txs: ${result.claim_txs.join(", ")}` : "";
      const cur = config.management.solMode ? "◎" : "$";
      await ctx.reply(`✅ Closed ${p.pair}\nPnL: ${cur}${result.pnl_usd ?? "?"} | close txs: ${closeTxs?.join(", ") || "n/a"}${claimNote}`);
    } else {
      await ctx.reply(`❌ Close failed: ${JSON.stringify(result)}`);
    }
  } catch (e) { await ctx.reply(`Error: ${e.message}`); }
});

// /closeall
positions.command("closeall", async (ctx) => {
  try {
    const { positions: pos } = await getMyPositions({ force: true });
    if (!pos.length) { await ctx.reply("No open positions."); return; }
    await ctx.reply(`Closing ${pos.length} position(s)...`);
    const results = [];
    for (const p of pos) {
      try {
        const result = await closePosition({ position_address: p.position });
        results.push(`${p.pair}: ${result.success ? "closed" : `failed (${result.error || "unknown"})`}`);
      } catch (error) {
        results.push(`${p.pair}: failed (${error.message})`);
      }
    }
    await ctx.reply(`Close-all finished.\n\n${results.join("\n")}`);
  } catch (e) { await ctx.reply(`Error: ${e.message}`); }
});

// /set <n> <note>
positions.hears(/^\/set\s+(\d+)\s+(.+)$/i, async (ctx) => {
  try {
    const idx = parseInt(ctx.match[1]) - 1;
    const note = ctx.match[2].trim();
    const { positions: pos } = await getMyPositions({ force: true });
    if (idx < 0 || idx >= pos.length) { await ctx.reply("Invalid number. Use /positions first."); return; }
    const p = pos[idx];
    setPositionInstruction(p.position, note);
    await ctx.reply(`✅ Note set for ${p.pair}:\n"${note}"`);
  } catch (e) { await ctx.reply(`Error: ${e.message}`); }
});

// ─── Helpers ─────────────────────────────────────────────────────
function formatWalletStatus(wallet, positions) {
  const sol = wallet?.sol ?? "?";
  const usd = wallet?.sol_usd ?? "?";
  const posCount = positions?.total_positions ?? 0;
  return `💰 Wallet: ${sol} SOL (~$${usd})\n📊 Positions: ${posCount}`;
}

export default positions;
