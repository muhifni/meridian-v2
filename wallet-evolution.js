/**
 * Smart Wallet Evolution
 *
 * Automatically discovers high-quality LP wallets from study data AND
 * high-quality holder wallets from token holder analysis.
 * Prunes underperforming ones. Runs at the end of each screening cycle.
 *
 * Add criteria (LP discovery):
 *   - win_rate >= 0.70
 *   - total_positions >= 3  (increased from 2 — need more data to trust)
 *   - avg_pnl_pct >= 20%
 *
 * Add criteria (Holder discovery):
 *   - Found in KOL cluster or OKX smart money
 *   - Associated with a pool that passed screening
 *
 * Confidence scoring:
 *   - Wallets with < 5 positions get a confidence penalty
 *   - Wallets with >= 10 positions are highly trusted
 *   - Stale (>30d) wallets get de-prioritized
 *
 * Remove criteria:
 *   - win_rate < 0.40 AND total_positions_observed >= 5
 *   - not seen in any pool for > 30 days (stale)
 *
 * Limits:
 *   - Max 30 wallets total for LP type
 *   - Max 20 wallets total for holder type
 *   - Manually-added wallets (source !== "auto") are never auto-removed
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "./logger.js";
import { addSmartWallet, removeSmartWallet, listSmartWallets, getWalletConfidence } from "./smart-wallets.js";
import { studyTopLPers } from "./tools/study.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WALLETS_PATH = path.join(__dirname, "smart-wallets.json");

const MAX_LP_WALLETS     = 30;
const MAX_HOLDER_WALLETS = 20;
const MIN_WIN_RATE_ADD   = 0.70;
const MIN_POSITIONS_ADD  = 3;   // Increased from 2 — need at least 3 data points
const MIN_AVG_PNL_ADD    = 20;  // percent
const MAX_WIN_RATE_REMOVE  = 0.40;
const MIN_POSITIONS_REMOVE = 5; // enough data before removing
const STALE_DAYS           = 30;

/**
 * Run wallet evolution for a list of pool addresses (top candidates from screening).
 * Discovers new LP wallets from study data, plus holder wallets from token analysis.
 *
 * @param {string[]} poolAddresses - Pool addresses to study (top 3 from screening)
 * @param {object[]} [candidatePools] - Full candidate pool objects (for holder discovery via token analysis)
 * @returns {{ added: string[], removed: string[], skipped: number }}
 */
export async function evolveSmartWallets(poolAddresses = [], candidatePools = []) {
  const result = { added: [], removed: [], skipped: 0 };

  // ── 1. Discover LP wallet candidates from LPAgent study data ──
  if (poolAddresses.length) {
    const lpResult = await discoverLpWallets(poolAddresses);
    result.added.push(...lpResult.added);
    result.skipped += lpResult.skipped;
  }

  // ── 2. Discover holder wallet candidates from token analysis ──
  if (candidatePools.length) {
    const holderResult = await discoverHolderWallets(candidatePools);
    result.added.push(...holderResult.added);
    result.skipped += holderResult.skipped;
  }

  // ── 3. Prune underperforming / stale wallets ──
  const pruneResult = pruneBadWallets();
  result.removed.push(...pruneResult);

  const totalAfter = listSmartWallets().wallets.length;
  if (result.added.length || result.removed.length) {
    log("wallet_evo", `Evolution complete — added: ${result.added.length}, removed: ${result.removed.length}, total: ${totalAfter}`);
  }

  return result;
}

/**
 * Discover LP wallets from LPAgent study data.
 */
async function discoverLpWallets(poolAddresses) {
  const result = { added: [], skipped: 0 };
  const discovered = new Map(); // address → best summary seen across pools

  for (const poolAddr of poolAddresses.slice(0, 3)) {
    try {
      const study = await studyTopLPers({ pool_address: poolAddr, limit: 6 });
      for (const lper of study.lpers || []) {
        const s = lper.summary;
        if (!lper.owner) continue;

        const existing = discovered.get(lper.owner);
        // Keep the entry with the most positions seen (most data)
        if (!existing || s.total_positions > existing.total_positions) {
          discovered.set(lper.owner, {
            address: lper.owner,
            win_rate: s.win_rate ?? 0,
            total_positions: s.total_positions ?? 0,
            avg_pnl_pct: s.avg_open_pnl_pct ?? 0,
            preferred_strategy: s.preferred_strategy,
            pool: poolAddr,
            pool_name: study.pool_name,
          });
        }
      }
    } catch (err) {
      log("wallet_evo", `Study failed for ${poolAddr.slice(0, 8)}: ${err.message}`);
    }
  }

  // Check which qualify
  const { wallets: current } = listSmartWallets();
  const currentAddresses = new Set(current.map((w) => w.address));

  for (const [address, data] of discovered) {
    if (currentAddresses.has(address)) {
      // Already tracked — update stats silently
      _updateWalletStats(address, data);
      result.skipped++;
      continue;
    }

    // Stricter qualification: require win_rate and positions, BUT
    // also apply confidence penalty — wallets with < 5 positions
    // get their effective win rate discounted to avoid false positives
    const effectiveWinRate = data.total_positions >= 5
      ? data.win_rate
      : data.win_rate * 0.85; // 15% discount for thin data

    const qualifies =
      effectiveWinRate >= MIN_WIN_RATE_ADD &&
      data.total_positions >= MIN_POSITIONS_ADD &&
      data.avg_pnl_pct >= MIN_AVG_PNL_ADD;

    if (!qualifies) continue;

    // Check capacity (LP type cap)
    const { wallets: fresh } = listSmartWallets();
    const lpCount = fresh.filter((w) => !w.type || w.type === "lp").length;
    if (lpCount >= MAX_LP_WALLETS) {
      log("wallet_evo", `LP wallet list full (${MAX_LP_WALLETS}) — skipping ${address.slice(0, 8)}`);
      break;
    }

    const safeName = (data.pool_name || "pool").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10);
    const name = `auto_${safeName}_${address.slice(0, 6)}`;

    // Calculate confidence
    const totalPositions = data.total_positions;

    const addResult = addSmartWallet({
      name,
      address,
      category: "alpha",
      type: "lp",
      source: "auto",
      stats: {
        win_rate: data.win_rate,
        effective_win_rate: effectiveWinRate,
        total_positions_observed: totalPositions,
        avg_pnl_pct: data.avg_pnl_pct,
        preferred_strategy: data.preferred_strategy,
        first_seen_pool: data.pool,
        last_seen: new Date().toISOString(),
      },
    });

    if (addResult.success) {
      log("wallet_evo", `Added ${name} — win_rate=${(data.win_rate * 100).toFixed(0)}%, eff_win_rate=${(effectiveWinRate * 100).toFixed(0)}%, positions=${totalPositions}, avg_pnl=${data.avg_pnl_pct.toFixed(1)}%`);
      result.added.push(name);
    }
  }

  return result;
}

/**
 * Discover holder-type wallets from token holder analysis.
 * Checks OKX clusters for KOL-associated wallets in candidate pools.
 */
async function discoverHolderWallets(candidatePools) {
  const result = { added: [], skipped: 0 };
  const { getAdvancedInfo, getClusterList } = await import("./tools/okx.js");
  const { wallets: current } = listSmartWallets();
  const currentAddresses = new Set(current.map((w) => w.address));

  for (const pool of candidatePools.slice(0, 3)) {
    const baseMint = pool.base?.mint || pool.base_mint || null;
    if (!baseMint) continue;

    try {
      const [adv, clusters] = await Promise.all([
        getAdvancedInfo(baseMint).catch(() => null),
        getClusterList(baseMint).catch(() => []),
      ]);

      if (!clusters?.length && (!adv || adv?.smart_money_buy !== "yes")) continue;

      const poolName = pool.name || pool.base?.symbol || "pool";
      let holderCandidates = [];

      // From KOL clusters
      if (clusters?.length) {
        for (const cluster of clusters) {
          if (cluster.has_kol && cluster.wallets?.length) {
            for (const wallet of cluster.wallets.slice(0, 3)) {
              const addr = wallet.address || wallet;
              if (currentAddresses.has(addr)) continue;
              holderCandidates.push({
                address: addr,
                cluster_trend: cluster.trend || "unknown",
                holding_pct: cluster.holding_pct || null,
              });
            }
          }
        }
      }

      // From smart money dev
      if (adv?.smart_money_buy === "yes" && adv?.creator) {
        if (!currentAddresses.has(adv.creator)) {
          holderCandidates.push({
            address: adv.creator,
            cluster_trend: "smart_money_dev",
            holding_pct: null,
          });
        }
      }

      for (const hc of holderCandidates) {
        // Check holder-type capacity
        const { wallets: fresh } = listSmartWallets();
        const holderCount = fresh.filter((w) => w.type === "holder").length;
        if (holderCount >= MAX_HOLDER_WALLETS) {
          log("wallet_evo", `Holder wallet list full (${MAX_HOLDER_WALLETS}) — skipping ${hc.address.slice(0, 8)}`);
          break;
        }

        const safeName = poolName.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8);
        const name = `holder_${safeName}_${hc.address.slice(0, 6)}`;

        const addResult = addSmartWallet({
          name,
          address: hc.address,
          category: "alpha",
          type: "holder",
          source: "auto",
          stats: {
            win_rate: null, // No LP data for holders
            effective_win_rate: null,
            total_positions_observed: 0,
            avg_pnl_pct: null,
            cluster_trend: hc.cluster_trend,
            holding_pct: hc.holding_pct,
            discovered_from_pool: poolName,
            last_seen: new Date().toISOString(),
          },
        });

        if (addResult.success) {
          log("wallet_evo", `Added holder ${name} — trend=${hc.cluster_trend}, pool=${poolName}`);
          result.added.push(name);
        }
      }
    } catch (err) {
      log("wallet_evo", `Holder discovery failed for ${poolName || baseMint.slice(0, 8)}: ${err.message}`);
    }
  }

  return result;
}

/**
 * Prune underperforming and stale wallet entries.
 * @returns {string[]} Names of removed wallets
 */
function pruneBadWallets() {
  const removed = [];
  const { wallets: afterAdd } = listSmartWallets();
  const staleThreshold = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;

  for (const wallet of afterAdd) {
    // Never auto-remove manually-added wallets
    if (wallet.source !== "auto") continue;

    const stats = wallet.stats || {};
    const positions = stats.total_positions_observed ?? 0;
    const winRate   = stats.win_rate ?? 1; // default to good if no data yet
    const lastSeen  = stats.last_seen ? new Date(stats.last_seen).getTime() : Date.now();

    const isUnderperforming = winRate < MAX_WIN_RATE_REMOVE && positions >= MIN_POSITIONS_REMOVE;
    const isStale = lastSeen < staleThreshold;

    // Holder wallets with no positions observed and stale get pruned faster (14 days)
    const isHolderStale = wallet.type === "holder" && positions === 0 &&
      (Date.now() - lastSeen) > 14 * 24 * 60 * 60 * 1000;

    if (isUnderperforming || isStale || isHolderStale) {
      const reason = isUnderperforming
        ? `win_rate ${(winRate * 100).toFixed(0)}% < ${MAX_WIN_RATE_REMOVE * 100}% after ${positions} positions`
        : isHolderStale
          ? `holder wallet not seen in 14 days`
          : `not seen in ${STALE_DAYS} days`;
      log("wallet_evo", `Removing ${wallet.name} — ${reason}`);
      removeSmartWallet({ address: wallet.address });
      removed.push(wallet.name);
    }
  }

  return removed;
}

/**
 * Update stats on an already-tracked auto wallet when we see it again in study data.
 * Merges new observations using a rolling weighted average.
 */
function _updateWalletStats(address, newData) {
  try {
    if (!fs.existsSync(WALLETS_PATH)) return;
    const data = JSON.parse(fs.readFileSync(WALLETS_PATH, "utf8"));
    const wallet = data.wallets.find((w) => w.address === address);
    if (!wallet || wallet.source !== "auto") return;

    const stats = wallet.stats || {};
    const prevN = stats.total_positions_observed ?? 0;
    const newN  = newData.total_positions;
    if (newN <= prevN) return; // no new data

    // Rolling weighted average — weight toward newer data proportionally
    const weight = newN / (prevN + newN);
    stats.win_rate    = _lerp(stats.win_rate    ?? newData.win_rate,    newData.win_rate,    weight);
    stats.avg_pnl_pct = _lerp(stats.avg_pnl_pct ?? newData.avg_pnl_pct, newData.avg_pnl_pct, weight);
    stats.total_positions_observed = Math.max(prevN, newN);
    // Recompute effective_win_rate
    const totalP = stats.total_positions_observed ?? 0;
    stats.effective_win_rate = totalP >= 5
      ? stats.win_rate
      : (stats.win_rate ?? 1) * 0.85;
    stats.last_seen = new Date().toISOString();
    wallet.stats = stats;

    fs.writeFileSync(WALLETS_PATH, JSON.stringify(data, null, 2));
  } catch { /* non-critical — don't break screening */ }
}

function _lerp(a, b, t) {
  return Number(((1 - t) * (a ?? b) + t * b).toFixed(4));
}

/**
 * Feedback loop: update smart wallet stats based on position outcome.
 * Called when a virtual (or live) position closes — adjusts win_rate and avg_pnl
 * for wallets that were present in the pool at deploy time.
 *
 * @param {string[]} walletAddresses - Wallet addresses that were in the pool at deploy
 * @param {object} outcome - { pnl_pct, close_reason, pool_name }
 */
export function feedbackToWallets(walletAddresses, outcome) {
  if (!walletAddresses?.length) return;
  if (!fs.existsSync(WALLETS_PATH)) return;

  try {
    const data = JSON.parse(fs.readFileSync(WALLETS_PATH, "utf8"));
    let updated = 0;

    for (const addr of walletAddresses) {
      const wallet = data.wallets.find((w) => w.address === addr && w.source === "auto");
      if (!wallet) continue;

      const stats = wallet.stats || {};
      const prevPositions = stats.total_positions_observed ?? 0;
      const newPositions = prevPositions + 1;

      // Update win_rate with new outcome
      const isWin = (outcome.pnl_pct ?? 0) >= 1; // same threshold as /sim
      const prevWins = Math.round((stats.win_rate ?? 0.7) * prevPositions);
      const newWins = prevWins + (isWin ? 1 : 0);
      const newWinRate = newPositions > 0 ? newWins / newPositions : stats.win_rate ?? 0.7;

      // Update avg_pnl with rolling average
      const prevAvgPnl = stats.avg_pnl_pct ?? 0;
      const newAvgPnl = prevPositions > 0
        ? (prevAvgPnl * prevPositions + (outcome.pnl_pct ?? 0)) / newPositions
        : outcome.pnl_pct ?? 0;

      stats.win_rate = Number(newWinRate.toFixed(4));
      stats.avg_pnl_pct = Number(newAvgPnl.toFixed(2));
      stats.total_positions_observed = newPositions;
      stats.effective_win_rate = newPositions >= 5
        ? stats.win_rate
        : stats.win_rate * 0.85;
      stats.last_feedback = new Date().toISOString();
      stats.last_feedback_pnl = outcome.pnl_pct;
      stats.last_feedback_pool = outcome.pool_name || null;

      wallet.stats = stats;
      updated++;

      log("wallet_evo", `Feedback: ${wallet.name} — pnl=${outcome.pnl_pct?.toFixed(1)}%, new win_rate=${(stats.win_rate * 100).toFixed(0)}%, positions=${newPositions}`);
    }

    if (updated > 0) {
      fs.writeFileSync(WALLETS_PATH, JSON.stringify(data, null, 2));
    }
  } catch (e) {
    log("wallet_evo", `Feedback error: ${e.message}`);
  }
}
