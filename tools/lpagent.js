/**
 * LPAgent Open API Client
 *
 * Direct integration with https://api.lpagent.io/open-api/v1
 * Requires LPAGENT_API_KEY in .env (Premium plan for /top-lpers)
 *
 * Endpoints used:
 *   - GET /pools/discover         — pool discovery with filters (Basic+)
 *   - GET /pools/{poolId}/top-lpers — ranked LPers per pool (Premium+)
 *   - GET /pools/{poolId}/info     — pool detail + active bin (Basic+)
 *   - GET /lp-positions/opening    — open positions for a wallet (Basic+)
 *   - GET /lp-positions/historical — closed positions for a wallet (Basic+)
 *   - GET /lp-positions/overview   — portfolio metrics for a wallet (Basic+)
 */

import { log } from "../logger.js";

const LPAGENT_BASE = "https://api.lpagent.io/open-api/v1";

function getApiKey() {
  return process.env.LPAGENT_API_KEY || "";
}

/**
 * Generic LPAgent API call with retry + timeout.
 */
async function lpagentFetch(path, { params = {}, timeoutMs = 12000, retries = 2 } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("LPAGENT_API_KEY not set in .env");
  }

  const url = new URL(`${LPAGENT_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") url.searchParams.set(k, String(v));
  }

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url.toString(), {
        headers: { "x-api-key": apiKey },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status === 429) {
        // Rate limited — wait and retry
        const retryAfter = Number(res.headers.get("retry-after") || 2);
        log("lpagent", `Rate limited (429), waiting ${retryAfter}s...`);
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        lastError = new Error(`429 Too Many Requests`);
        continue;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`LPAgent ${path} HTTP ${res.status}: ${body.slice(0, 200)}`);
      }

      const json = await res.json();
      return json;
    } catch (e) {
      clearTimeout(timer);
      lastError = e;
      if (e.name === "AbortError") {
        lastError = new Error(`LPAgent ${path} timeout after ${timeoutMs}ms`);
      }
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  throw lastError;
}

// ─── Pool Discovery ─────────────────────────────────────────────

/**
 * Discover pools with LPAgent filters.
 * @param {object} filters - Query params matching LPAgent /pools/discover
 * @returns {{ data: object[], pagination: object }}
 */
export async function discoverPools(filters = {}) {
  const defaults = {
    chain: "SOL",
    sortBy: "fee_tvl_ratio",
    sortOrder: "desc",
    pageSize: 10,
    page: 1,
    feeTVLInterval: "5m",
    type: "meteora", // DLMM only
  };
  const params = { ...defaults, ...filters };
  const result = await lpagentFetch("/pools/discover", { params });
  return {
    data: result.data || [],
    pagination: result.pagination || {},
  };
}

// ─── Top LPers (Premium) ────────────────────────────────────────

/**
 * Get top LPers for a specific pool.
 * REQUIRES Premium plan ($20/month).
 *
 * @param {string} poolAddress
 * @param {{ limit?: number, page?: number, order_by?: string, sort_order?: string }} options
 * @returns {{ data: object[], pagination: object }}
 */
export async function getTopLPers(poolAddress, { limit = 20, page = 1, order_by = "win_rate", sort_order = "desc" } = {}) {
  const result = await lpagentFetch(`/pools/${poolAddress}/top-lpers`, {
    params: { limit, page, order_by, sort_order },
  });
  return {
    data: result.data || [],
    pagination: result.pagination || {},
  };
}

// ─── Pool Info ──────────────────────────────────────────────────

/**
 * Get detailed pool info (active bin, liquidity visualization, token data).
 * @param {string} poolAddress
 */
export async function getPoolInfo(poolAddress) {
  const result = await lpagentFetch(`/pools/${poolAddress}/info`);
  return result.data || result;
}

// ─── Pool On-Chain Stats ────────────────────────────────────────

/**
 * Get on-chain statistics for a pool (total positions, input values, unique users).
 * @param {string} poolAddress
 */
export async function getPoolOnchainStats(poolAddress) {
  const result = await lpagentFetch(`/pools/${poolAddress}/onchain-stats`);
  return result.data || result;
}

// ─── Position Tracking ──────────────────────────────────────────

/**
 * Get open LP positions for a wallet.
 * @param {string} owner - Wallet address
 */
export async function getOpenPositions(owner) {
  const result = await lpagentFetch("/lp-positions/opening", { params: { owner } });
  return result.data || [];
}

/**
 * Get historical (closed) LP positions for a wallet.
 * @param {string} owner - Wallet address
 * @param {{ page?: number, limit?: number }} options
 */
export async function getHistoricalPositions(owner, { page = 1, limit = 20 } = {}) {
  const result = await lpagentFetch("/lp-positions/historical", {
    params: { owner, page, limit },
  });
  return {
    data: result.data || [],
    pagination: result.pagination || {},
  };
}

/**
 * Get portfolio overview metrics for a wallet.
 * @param {string} owner - Wallet address
 */
export async function getPositionOverview(owner) {
  const result = await lpagentFetch("/lp-positions/overview", { params: { owner } });
  return result.data || result;
}

/**
 * Get revenue/PnL data over time for a wallet.
 * @param {string} owner - Wallet address
 * @param {"7D"|"1M"} range
 */
export async function getPositionRevenue(owner, range = "7D") {
  const result = await lpagentFetch(`/lp-positions/revenue/${owner}`, { params: { range } });
  return result.data || result;
}

// ─── Wallet Validation (for smart wallet system) ────────────────

/**
 * Validate a smart wallet by checking their actual LP performance via LPAgent.
 * Returns structured stats useful for wallet-evolution.js qualification.
 *
 * @param {string} walletAddress
 * @param {string} [poolAddress] - Optional: check performance on specific pool
 * @returns {{ win_rate, total_lp, avg_age_hour, total_pnl, total_fee, roi, apr, fee_percent, last_activity }}
 */
export async function validateWalletPerformance(walletAddress, poolAddress = null) {
  if (poolAddress) {
    // Check this wallet's ranking on a specific pool
    try {
      const { data } = await getTopLPers(poolAddress, { limit: 100 });
      const entry = data.find((d) => d.owner === walletAddress);
      if (entry) {
        return {
          found: true,
          source: "pool_top_lpers",
          pool: poolAddress,
          ...extractWalletStats(entry),
        };
      }
      return { found: false, source: "pool_top_lpers", pool: poolAddress };
    } catch (e) {
      log("lpagent", `validateWallet pool check failed: ${e.message}`);
      return { found: false, error: e.message };
    }
  }

  // General: check their historical positions
  try {
    const { data } = await getHistoricalPositions(walletAddress, { limit: 50 });
    if (!data.length) return { found: false, source: "historical" };

    // Compute stats from historical positions
    let wins = 0, total = data.length, totalPnl = 0, totalFee = 0;
    for (const pos of data) {
      const pnl = pos.total_pnl ?? pos.total_pnl_native ?? 0;
      if (pnl > 0) wins++;
      totalPnl += pnl;
      totalFee += pos.total_fee ?? pos.total_fee_native ?? 0;
    }

    return {
      found: true,
      source: "historical_positions",
      win_rate: total > 0 ? wins / total : 0,
      total_lp: total,
      total_pnl: totalPnl,
      total_fee: totalFee,
      avg_pnl: total > 0 ? totalPnl / total : 0,
      last_activity: data[0]?.last_activity || null,
    };
  } catch (e) {
    log("lpagent", `validateWallet historical check failed: ${e.message}`);
    return { found: false, error: e.message };
  }
}

function extractWalletStats(entry) {
  return {
    win_rate: entry.win_rate ?? 0,
    win_rate_native: entry.win_rate_native ?? 0,
    total_lp: entry.total_lp ?? 0,
    avg_age_hour: entry.avg_age_hour ?? 0,
    total_pnl: entry.total_pnl ?? 0,
    total_pnl_native: entry.total_pnl_native ?? 0,
    total_fee: entry.total_fee ?? 0,
    total_fee_native: entry.total_fee_native ?? 0,
    total_inflow: entry.total_inflow ?? 0,
    roi: entry.roi ?? 0,
    apr: entry.apr ?? 0,
    fee_percent: entry.fee_percent ?? 0,
    first_activity: entry.first_activity || null,
    last_activity: entry.last_activity || null,
  };
}

export { lpagentFetch, getApiKey, LPAGENT_BASE };
