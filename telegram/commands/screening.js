import { Composer } from "grammy";
import { getTopCandidates } from "../../tools/screening.js";
import { getWalletBalances } from "../../tools/wallet.js";
import { checkSmartWalletsOnPool } from "../../smart-wallets.js";
import { getTokenNarrative, getTokenInfo } from "../../tools/token.js";
import { executeTool } from "../../tools/executor.js";
import { config, computeDeployAmount } from "../../config.js";
import { appendDecision } from "../../decision-log.js";
import { setLatestCandidates, getLatestCandidates, getLatestCandidatesMeta } from "../shared-state.js";

const screening = new Composer();

// /screen
screening.command("screen", async (ctx) => {
  try {
    await ctx.reply(await runDeterministicScreen(5));
  } catch (e) {
    await ctx.reply(`Error: ${e.message}`);
  }
});

// /candidates
screening.command("candidates", async (ctx) => {
  await ctx.reply(describeLatestCandidates(5));
});

// /deploy <n>
screening.hears(/^\/deploy\s+(\d+)$/i, async (ctx) => {
  try {
    const idx = parseInt(ctx.match[1]) - 1;
    const { candidate, result, deployAmount, binsBelow } = await deployLatestCandidate(idx);
    const coverage = result.range_coverage
      ? `Range: ${fmtPct(result.range_coverage.downside_pct)} downside | ${fmtPct(result.range_coverage.upside_pct)} upside`
      : `Strategy: ${config.strategy.strategy} | binsBelow: ${binsBelow}`;
    await ctx.reply([
      `✅ Deployed ${candidate.name}`,
      `Pool: ${candidate.pool}`,
      `Amount: ${deployAmount} SOL`,
      coverage,
      `Position: ${result.position || "n/a"}`,
      result.txs?.length ? `Tx: ${result.txs[0]}` : null,
    ].filter(Boolean).join("\n"));
  } catch (e) {
    await ctx.reply(`Error: ${e.message}`);
  }
});

// ─── Internal functions ──────────────────────────────────────────
async function runDeterministicScreen(limit = 5) {
  const top = await getTopCandidates({ limit });
  const candidates = (top?.candidates || top?.pools || []).slice(0, limit);
  setLatestCandidates(candidates);
  if (candidates.length > 0) {
    const lines = candidates.map((pool, i) => {
      const feeTvl = pool.fee_active_tvl_ratio ?? pool.fee_tvl_ratio ?? "?";
      const vol = pool.volume_window ?? pool.volume_24h ?? "?";
      return `${i + 1}. ${pool.name} | ${pool.pool}\n   fee/aTVL ${feeTvl}% | vol $${vol} | organic ${pool.organic_score ?? "?"}`;
    });
    return `Top candidates (${candidates.length})\n\n${lines.join("\n")}`;
  }
  const examples = (top?.filtered_examples || []).slice(0, 3)
    .map((entry) => `- ${entry.name}: ${entry.reason}`)
    .join("\n");
  return examples
    ? `No candidates available.\nFiltered examples:\n${examples}`
    : "No candidates available right now.";
}

function describeLatestCandidates(limit = 5) {
  const candidates = getLatestCandidates();
  const meta = getLatestCandidatesMeta();
  if (!candidates.length) return "No cached candidates yet. Run /screen first.";
  const lines = candidates.slice(0, limit).map((pool, i) => {
    const feeTvl = pool.fee_active_tvl_ratio ?? pool.fee_tvl_ratio ?? "?";
    const vol = pool.volume_window ?? pool.volume_24h ?? "?";
    const active = pool.active_pct ?? "?";
    const organic = pool.organic_score ?? "?";
    return `${i + 1}. ${pool.name} | fee/aTVL ${feeTvl}% | vol $${vol} | in-range ${active}% | organic ${organic}`;
  });
  const age = meta.updatedAt ? new Date(meta.updatedAt).toLocaleString("en-US", { hour12: false }) : "unknown";
  return `Latest candidates (${candidates.length}) — updated ${age}\n\n${lines.join("\n")}`;
}

async function deployLatestCandidate(index) {
  const candidates = getLatestCandidates();
  const candidate = candidates[index];
  if (!candidate) {
    throw new Error("Invalid candidate index. Run /screen first.");
  }
  if (candidates.length === 1) {
    const mint = candidate.base?.mint || candidate.base_mint || null;
    const [smartWallets, narrative, tokenInfo] = await Promise.allSettled([
      checkSmartWalletsOnPool({ pool_address: candidate.pool }),
      mint ? getTokenNarrative({ mint }) : Promise.resolve(null),
      mint ? getTokenInfo({ query: mint }) : Promise.resolve(null),
    ]);
    const context = {
      pool: candidate,
      sw: smartWallets.status === "fulfilled" ? smartWallets.value : null,
      n: narrative.status === "fulfilled" ? narrative.value : null,
      ti: tokenInfo.status === "fulfilled" ? tokenInfo.value?.results?.[0] : null,
    };
    const skipReason = getLoneCandidateSkipReason(context);
    if (skipReason) {
      appendDecision({
        type: "no_deploy",
        actor: "SCREENER",
        summary: "Single cached candidate skipped",
        reason: skipReason,
        pool: candidate.pool,
        pool_name: candidate.name,
      });
      throw new Error(`NO DEPLOY: only cached candidate ${candidate.name} is not worth deploying — ${skipReason}`);
    }
  }
  const deployAmount = computeDeployAmount((await getWalletBalances()).sol);
  const binsBelow = computeBinsBelow(candidate.volatility);
  const result = await executeTool("deploy_position", {
    pool_address: candidate.pool,
    amount_y: deployAmount,
    strategy: config.strategy.strategy,
    bins_below: binsBelow,
    bins_above: 0,
    pool_name: candidate.name,
    base_mint: candidate.base?.mint || candidate.base_mint || null,
    bin_step: candidate.bin_step,
    base_fee: candidate.base_fee,
    volatility: candidate.volatility,
    fee_tvl_ratio: candidate.fee_active_tvl_ratio ?? candidate.fee_tvl_ratio,
    organic_score: candidate.organic_score,
    initial_value_usd: candidate.tvl ?? candidate.active_tvl ?? null,
  });
  if (result?.success === false || result?.error) {
    throw new Error(result.error || "Deploy failed");
  }
  return { result, candidate, deployAmount, binsBelow };
}

function getLoneCandidateSkipReason({ pool, sw, n, ti } = {}) {
  if (!pool) return "missing candidate data";
  const smartWalletCount = Math.max(sw?.in_pool?.length ?? 0, Number(pool.gmgn_smart_wallets ?? 0) || 0);
  const tokenInfo = ti || {};
  const hasNarrative = !!n?.narrative;
  const globalFeesSol = Number(tokenInfo.global_fees_sol ?? pool.gmgn_total_fee_sol);
  const top10Pct = Number(tokenInfo.audit?.top_holders_pct ?? pool.gmgn_token_info_top10_pct ?? pool.gmgn_top10_holder_pct);
  const botPct = Number(tokenInfo.audit?.bot_holders_pct ?? pool.gmgn_bot_degen_pct);
  if (pool.is_wash) return "wash trading was flagged";
  if (pool.is_rugpull && smartWalletCount === 0) return "rugpull risk was flagged and no smart wallets offset it";
  if (pool.is_pvp && smartWalletCount === 0) return "PVP symbol conflict and no smart-wallet confirmation";
  if (Number.isFinite(globalFeesSol) && globalFeesSol < config.screening.minTokenFeesSol) {
    return `token fees ${globalFeesSol} SOL below minimum ${config.screening.minTokenFeesSol} SOL`;
  }
  if (Number.isFinite(top10Pct) && top10Pct > config.screening.maxTop10Pct) {
    return `top10 concentration ${top10Pct}% above maximum ${config.screening.maxTop10Pct}%`;
  }
  if (Number.isFinite(botPct) && botPct > config.screening.maxBotHoldersPct) {
    return `bot holders ${botPct}% above maximum ${config.screening.maxBotHoldersPct}%`;
  }
  if (!hasNarrative && smartWalletCount === 0) return "only candidate has no narrative and no smart-wallet confirmation";
  return null;
}

function computeBinsBelow(volatility) {
  const parsedVolatility = Number(volatility);
  if (!Number.isFinite(parsedVolatility) || parsedVolatility <= 0) {
    throw new Error(`Invalid volatility ${volatility ?? "unknown"} — refusing volatility-scaled deploy.`);
  }
  const lo = config.strategy.minBinsBelow;
  const hi = config.strategy.maxBinsBelow;
  return Math.max(lo, Math.min(hi, Math.round(lo + (parsedVolatility / 5) * (hi - lo))));
}

function fmtPct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : "?";
}

export default screening;
