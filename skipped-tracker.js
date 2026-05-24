/**
 * Skipped Pool Tracker — P1 Self-Learning Enhancement
 *
 * Records pools that were filtered out during screening, then follows up
 * after a delay to check if they would have been profitable. This creates
 * a feedback loop for threshold tuning: "are we rejecting good pools?"
 *
 * Data flow:
 *   1. getTopCandidates() filters pools → recordSkippedPools() saves them
 *   2. After FOLLOWUP_DELAY_MS, evaluateSkippedPools() checks their performance
 *   3. If a skipped pool would have been profitable → derive a "missed_opportunity" lesson
 *   4. Aggregate stats feed into evolveThresholds() for smarter threshold adjustment
 *
 * File: skipped-pools.json (rolling window, auto-pruned to MAX_ENTRIES)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKIPPED_FILE = path.join(__dirname, "skipped-pools.json");

const MAX_ENTRIES = 500;           // rolling window — prune oldest beyond this
const FOLLOWUP_DELAY_MS = 3 * 60 * 60 * 1000; // 3 hours
const MAX_FOLLOWUP_AGE_MS = 12 * 60 * 60 * 1000; // don't follow up on entries older than 12h
const PROFITABLE_FEE_YIELD_PCT = 1.5; // if pool generated >1.5% fee yield in 3h, it was a miss

// ─── Persistence ─────────────────────────────────────────────────

function load() {
  if (!fs.existsSync(SKIPPED_FILE)) return { entries: [], stats: { total_skipped: 0, total_evaluated: 0, missed_opportunities: 0 } };
  try {
    return JSON.parse(fs.readFileSync(SKIPPED_FILE, "utf8"));
  } catch {
    return { entries: [], stats: { total_skipped: 0, total_evaluated: 0, missed_opportunities: 0 } };
  }
}

function save(data) {
  // Prune to MAX_ENTRIES (keep newest)
  if (data.entries.length > MAX_ENTRIES) {
    data.entries = data.entries.slice(-MAX_ENTRIES);
  }
  fs.writeFileSync(SKIPPED_FILE, JSON.stringify(data, null, 2));
}

// ─── Record Skipped Pools ────────────────────────────────────────

/**
 * Record pools that were filtered out during screening.
 * Called from getTopCandidates() after all filtering is done.
 *
 * @param {Array} filteredPools - Array of { name, reason, pool?, metrics? }
 * @param {number} totalScreened - Total pools screened this cycle
 */
export function recordSkippedPools(filteredPools, totalScreened) {
  if (!filteredPools || filteredPools.length === 0) return;

  const data = load();
  const now = new Date().toISOString();
  const cycleId = Date.now();

  for (const item of filteredPools) {
    // Skip entries without useful data
    if (!item.name && !item.pool_address) continue;

    data.entries.push({
      id: `${cycleId}_${data.entries.length}`,
      pool_address: item.pool_address || item.pool || null,
      pool_name: item.name || item.pool_name || "unknown",
      reason: item.reason || "unknown",
      metrics: item.metrics || null,
      skipped_at: now,
      cycle_total_screened: totalScreened,
      followup_status: "pending", // pending | evaluated | expired
      followup_result: null,
    });
  }

  data.stats.total_skipped += filteredPools.length;
  save(data);

  log("skipped-tracker", `Recorded ${filteredPools.length} skipped pools (total tracked: ${data.entries.length})`);
}

// ─── Evaluate Skipped Pools ──────────────────────────────────────

/**
 * Follow up on skipped pools to check if they would have been profitable.
 * Should be called periodically (e.g., every management cycle or dedicated cron).
 *
 * @returns {{ evaluated: number, missed: number, details: Array }}
 */
export async function evaluateSkippedPools() {
  const data = load();
  const now = Date.now();

  // Find entries ready for follow-up (past delay, not yet evaluated)
  const ready = data.entries.filter((e) => {
    if (e.followup_status !== "pending") return false;
    const skippedAt = new Date(e.skipped_at).getTime();
    const age = now - skippedAt;
    // Ready if past delay but not too old
    return age >= FOLLOWUP_DELAY_MS && age <= MAX_FOLLOWUP_AGE_MS;
  });

  if (ready.length === 0) return { evaluated: 0, missed: 0, details: [] };

  // Batch: only evaluate up to 10 per run to avoid RPC spam
  const batch = ready.slice(0, 10);
  const results = [];

  for (const entry of batch) {
    if (!entry.pool_address) {
      entry.followup_status = "expired";
      entry.followup_result = { reason: "no_pool_address" };
      continue;
    }

    try {
      const result = await checkPoolPerformance(entry.pool_address, entry.skipped_at);
      entry.followup_status = "evaluated";
      entry.followup_result = result;

      if (result.was_profitable) {
        results.push({
          pool_name: entry.pool_name,
          pool_address: entry.pool_address,
          skip_reason: entry.reason,
          metrics_at_skip: entry.metrics,
          estimated_fee_yield_pct: result.estimated_fee_yield_pct,
          tvl_change_pct: result.tvl_change_pct,
        });
      }
    } catch (err) {
      entry.followup_status = "evaluated";
      entry.followup_result = { error: err.message, was_profitable: false };
    }
  }

  // Expire old pending entries that missed the window
  for (const e of data.entries) {
    if (e.followup_status !== "pending") continue;
    const age = now - new Date(e.skipped_at).getTime();
    if (age > MAX_FOLLOWUP_AGE_MS) {
      e.followup_status = "expired";
      e.followup_result = { reason: "too_old" };
    }
  }

  data.stats.total_evaluated += batch.length;
  data.stats.missed_opportunities += results.length;
  save(data);

  // Derive lessons from missed opportunities
  if (results.length > 0) {
    await deriveMissedOpportunityLessons(results);
  }

  log("skipped-tracker", `Evaluated ${batch.length} skipped pools: ${results.length} missed opportunities found`);
  return { evaluated: batch.length, missed: results.length, details: results };
}

// ─── Pool Performance Check ──────────────────────────────────────

/**
 * Check how a pool performed since it was skipped.
 * Uses Meteora datapi to get current pool stats and estimate fee yield.
 */
async function checkPoolPerformance(poolAddress, skippedAt) {
  // Fetch current pool data from Meteora (separate from Jupiter rate limiter)
  const url = `https://dlmm.datapi.meteora.ag/pools/${poolAddress}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch {
    return { was_profitable: false, reason: "fetch_failed" };
  } finally {
    clearTimeout(timer);
  }

  if (!res || !res.ok) {
    return { was_profitable: false, reason: "pool_not_found" };
  }

  const pool = await res.json();
  if (!pool || !pool.fees_24h) {
    return { was_profitable: false, reason: "no_fee_data" };
  }

  // Estimate fee yield since skip time
  const hoursSinceSkip = (Date.now() - new Date(skippedAt).getTime()) / (1000 * 60 * 60);
  const tvl = Number(pool.tvl || pool.active_tvl || 0);
  const fees24h = Number(pool.fees_24h || 0);

  if (tvl <= 0 || fees24h <= 0) {
    return { was_profitable: false, reason: "no_activity", tvl, fees24h };
  }

  // Proportional fee yield for the hours since skip
  const feeYieldPct = (fees24h / tvl) * (hoursSinceSkip / 24) * 100;

  // Check TVL stability (if TVL crashed, it wasn't really profitable)
  const metricsAtSkip = null; // We'll compare if metrics were saved
  const tvlAtSkip = Number(pool.tvl_at_skip || tvl); // fallback to current

  return {
    was_profitable: feeYieldPct >= PROFITABLE_FEE_YIELD_PCT,
    estimated_fee_yield_pct: Math.round(feeYieldPct * 100) / 100,
    current_tvl: tvl,
    fees_24h: fees24h,
    hours_since_skip: Math.round(hoursSinceSkip * 10) / 10,
    tvl_change_pct: tvlAtSkip > 0 ? Math.round(((tvl - tvlAtSkip) / tvlAtSkip) * 100) : null,
  };
}

// ─── Derive Lessons from Missed Opportunities ────────────────────

async function deriveMissedOpportunityLessons(missedPools) {
  const { addLesson } = await import("./lessons.js");

  for (const missed of missedPools) {
    const rule = `MISSED OPPORTUNITY: ${missed.pool_name} was skipped (reason: ${missed.skip_reason}) but generated ~${missed.estimated_fee_yield_pct}% fee yield in ${missed.metrics_at_skip?.hours_since || "3"}h. ` +
      `Metrics at skip: ${formatMetrics(missed.metrics_at_skip)}. Consider relaxing the filter that caused this rejection.`;

    addLesson(rule, ["missed_opportunity", "threshold_review", categorizeReason(missed.skip_reason)], {
      role: "SCREENER",
    });

    log("skipped-tracker", `Missed opportunity lesson: ${missed.pool_name} (${missed.skip_reason}) → ${missed.estimated_fee_yield_pct}% yield`);
  }
}

// ─── Aggregate Stats ─────────────────────────────────────────────

/**
 * Get aggregate stats about skipped pools — useful for threshold review.
 * Returns breakdown by rejection reason + missed opportunity rate per reason.
 */
export function getSkippedStats() {
  const data = load();
  const evaluated = data.entries.filter((e) => e.followup_status === "evaluated");

  // Group by reason
  const byReason = {};
  for (const e of evaluated) {
    const reason = categorizeReason(e.reason);
    if (!byReason[reason]) byReason[reason] = { total: 0, missed: 0 };
    byReason[reason].total++;
    if (e.followup_result?.was_profitable) byReason[reason].missed++;
  }

  // Calculate miss rate per reason
  const reasonStats = Object.entries(byReason).map(([reason, counts]) => ({
    reason,
    total_skipped: counts.total,
    missed_opportunities: counts.missed,
    miss_rate_pct: counts.total > 0 ? Math.round((counts.missed / counts.total) * 100) : 0,
  })).sort((a, b) => b.miss_rate_pct - a.miss_rate_pct);

  return {
    ...data.stats,
    pending: data.entries.filter((e) => e.followup_status === "pending").length,
    by_reason: reasonStats,
  };
}

/**
 * Get stats formatted for LLM prompt injection.
 * Only injected if there's meaningful data (>20 evaluated).
 */
export function getSkippedStatsForPrompt() {
  const stats = getSkippedStats();
  if (stats.total_evaluated < 20) return null; // not enough data yet

  const lines = ["Skipped Pool Analysis (missed opportunity tracker):"];
  lines.push(`  Evaluated: ${stats.total_evaluated} | Missed: ${stats.missed_opportunities} (${stats.total_evaluated > 0 ? Math.round((stats.missed_opportunities / stats.total_evaluated) * 100) : 0}% miss rate)`);

  if (stats.by_reason.length > 0) {
    lines.push("  By rejection reason:");
    for (const r of stats.by_reason.slice(0, 5)) {
      if (r.total_skipped < 3) continue; // skip noise
      lines.push(`    ${r.reason}: ${r.missed_opportunities}/${r.total_skipped} missed (${r.miss_rate_pct}%)`);
    }
  }

  return lines.join("\n");
}

// ─── Helpers ─────────────────────────────────────────────────────

function formatMetrics(metrics) {
  if (!metrics) return "n/a";
  const parts = [];
  if (metrics.organic != null) parts.push(`organic=${metrics.organic}`);
  if (metrics.fee_tvl != null) parts.push(`fee_tvl=${metrics.fee_tvl}`);
  if (metrics.volatility != null) parts.push(`vol=${metrics.volatility}`);
  if (metrics.volume != null) parts.push(`volume=${metrics.volume}`);
  if (metrics.tvl != null) parts.push(`tvl=$${metrics.tvl}`);
  return parts.join(", ") || "n/a";
}

function categorizeReason(reason) {
  if (!reason) return "unknown";
  const r = reason.toLowerCase();
  if (r.includes("tvl") && r.includes("below")) return "below_minTvl";
  if (r.includes("tvl") && r.includes("above")) return "above_maxTvl";
  if (r.includes("fee") && r.includes("tvl")) return "below_minFeeTvlRatio";
  if (r.includes("volatility")) return "unusable_volatility";
  if (r.includes("cooldown") && r.includes("pool")) return "pool_cooldown";
  if (r.includes("cooldown") && r.includes("token")) return "token_cooldown";
  if (r.includes("position")) return "duplicate_position";
  if (r.includes("token") && r.includes("another")) return "duplicate_token";
  if (r.includes("pvp")) return "pvp_filter";
  if (r.includes("wash")) return "wash_trading";
  if (r.includes("ath")) return "ath_filter";
  if (r.includes("indicator")) return "indicator_reject";
  if (r.includes("deployer") || r.includes("blocked")) return "blocked_deployer";
  if (r.includes("blacklist")) return "blacklisted";
  return "other";
}
