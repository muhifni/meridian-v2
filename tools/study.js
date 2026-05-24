/**
 * Top LPer Study — via LPAgent Open API
 *
 * Previously used Agent Meridian API (agentMeridianJson) which is now dead.
 * Now uses LPAgent Open API directly: GET /pools/{poolId}/top-lpers (Premium plan required).
 *
 * Fallback: if LPAGENT_API_KEY not set, returns empty result gracefully.
 */

import { getTopLPers, getApiKey } from "./lpagent.js";
import { log } from "../logger.js";

/**
 * Study top LPers for a given pool.
 *
 * @param {{ pool_address: string, limit?: number }} params
 * @returns {{ pool, pool_name, message, patterns, lpers }}
 */
export async function studyTopLPers({ pool_address, limit = 6 }) {
  if (!getApiKey()) {
    return {
      pool: pool_address,
      message: "LPAGENT_API_KEY not configured — LP study disabled.",
      patterns: {},
      lpers: [],
    };
  }

  try {
    const { data } = await getTopLPers(pool_address, {
      limit: Math.max(1, limit),
      order_by: "win_rate",
      sort_order: "desc",
    });

    if (!data.length) {
      return {
        pool: pool_address,
        message: "No top LPer data found for this pool.",
        patterns: {},
        lpers: [],
      };
    }

    // Build pool name from first entry's token symbols (if available)
    const first = data[0];
    const poolName = `${first.token0_symbol || "TOKEN"}-${first.token1_symbol || "SOL"}`;

    // Map LPAgent response to our internal format
    const lpers = data.map((entry) => ({
      owner: entry.owner,
      owner_short: `${entry.owner.slice(0, 8)}...`,
      signal_tags: buildSignalTags(entry),
      summary: {
        total_positions: entry.total_lp ?? 0,
        avg_hold_hours: round(entry.avg_age_hour ?? 0, 2),
        avg_open_pnl_pct: round(pnlPercent(entry), 2),
        avg_fee_per_tvl_24h_pct: round(entry.fee_percent ?? 0, 2),
        total_pnl_usd: round(entry.total_pnl ?? 0, 2),
        total_balance_usd: round(entry.total_inflow ?? 0, 2),
        avg_range_width_pct: null,
        avg_distance_to_active_pct: null,
        win_rate: round(entry.win_rate ?? 0, 4),
        roi: round(entry.roi ?? 0, 4),
        fee_pct_of_capital: round(entry.fee_percent ?? 0, 2),
        preferred_strategy: inferStrategy(entry),
        preferred_range_style: inferRangeStyle(entry),
      },
      positions: [], // LPAgent top-lpers doesn't return individual positions
    }));

    const patterns = buildPatterns(data, poolName);

    return {
      pool: pool_address,
      pool_name: poolName,
      message: `LPAgent Open API — ${data.length} top LPers ranked by win_rate.`,
      patterns,
      lpers,
    };
  } catch (err) {
    log("study", `LPAgent studyTopLPers failed for ${pool_address.slice(0, 8)}: ${err.message}`);
    return {
      pool: pool_address,
      message: `LPAgent API error: ${err.message}`,
      patterns: {},
      lpers: [],
    };
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function buildSignalTags(entry) {
  const tags = [];
  if (entry.avg_age_hour != null) {
    if (entry.avg_age_hour < 1) tags.push("style:scalper");
    else if (entry.avg_age_hour < 4) tags.push("style:swing");
    else tags.push("style:holder");
  }
  if (entry.win_rate >= 0.8) tags.push("quality:high_winrate");
  if (entry.roi >= 0.5) tags.push("quality:high_roi");
  return tags;
}

function buildPatterns(data, poolName) {
  const avgHold = avg(data.map((d) => d.avg_age_hour).filter(isNum));
  const avgWinRate = avg(data.map((d) => d.win_rate).filter(isNum));
  const avgRoi = avg(data.map((d) => d.roi).filter(isNum));
  const avgFeePct = avg(data.map((d) => d.fee_percent).filter(isNum));

  const scalpers = data.filter((d) => (d.avg_age_hour || 0) < 1).length;
  const holders = data.filter((d) => (d.avg_age_hour || 0) >= 4).length;

  return {
    top_lper_count: data.length,
    study_mode: "lpagent_open_api",
    pool_name: poolName,
    avg_hold_hours: round(avgHold, 2),
    avg_win_rate: round(avgWinRate, 4),
    avg_roi_pct: round(avgRoi * 100, 2),
    avg_fee_percent: round(avgFeePct, 2),
    best_win_rate: data[0] ? round(data[0].win_rate, 4) : null,
    best_roi: data[0] ? round(data[0].roi, 4) : null,
    scalper_count: scalpers,
    holder_count: holders,
    total_lpers_in_pool: data.length,
  };
}

function pnlPercent(entry) {
  // Calculate PnL as percentage of inflow
  if (!entry.total_inflow || entry.total_inflow === 0) return 0;
  return ((entry.total_pnl ?? 0) / entry.total_inflow) * 100;
}

function inferStrategy(entry) {
  // Heuristic: scalpers tend to use BidAsk, holders use Spot
  const hours = entry.avg_age_hour ?? 2;
  if (hours < 1) return "BidAsk";
  if (hours < 4) return "Spot";
  return "Spot";
}

function inferRangeStyle(entry) {
  const hours = entry.avg_age_hour ?? 2;
  if (hours < 1) return "tight";
  if (hours < 6) return "moderate";
  return "wide";
}

function avg(values) {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

function round(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(digits));
}

function isNum(value) {
  return Number.isFinite(Number(value));
}
