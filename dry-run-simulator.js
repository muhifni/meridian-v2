/**
 * Dry Run Simulator — "Demo Account" mode
 *
 * When DRY_RUN=true, this module tracks virtual positions using real market
 * data. Every management cycle evaluates virtual PnL against the same rules
 * as live positions. When a virtual position closes, it feeds into the full
 * learning pipeline (lessons, threshold evolution, pool memory, Darwin weights)
 * so all data is ready when you go live.
 *
 * Virtual positions are stored in state.json with { virtual: true }.
 * They are invisible to the real position tracker and never sent on-chain.
 *
 * Config optimizer: after every 5 virtual closes, analyze performance and
 * suggest config adjustments calibrated to the current wallet balance.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "./logger.js";
import { logPositionClose, initLogger } from "./position-logger.js";
import { config } from "./config.js";
import { recordPerformance } from "./lessons.js";
import { addToBlacklist } from "./token-blacklist.js";
import { blockDev } from "./dev-blocklist.js";
import { addPoolNote } from "./pool-memory.js";
import { appendDecision } from "./decision-log.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE  = path.join(__dirname, "state.json");
const VIRTUAL_LOG = path.join(__dirname, "virtual-positions.json");

// ─── Thresholds (mirror management config) ────────────────────
const stopLossPct        = () => config.management.stopLossPct   ?? -28;
const takeProfitPct      = () => config.management.takeProfitPct ?? 12;
const trailingTriggerPct = () => config.management.trailingTriggerPct ?? 4;
const trailingDropPct    = () => config.management.trailingDropPct    ?? 1.5;
const oorWaitMinutes     = () => config.management.outOfRangeWaitMinutes ?? 25;
const minFeePerTvl       = () => config.management.minFeePerTvl24h ?? 8;
const minAgeYieldCheck   = () => config.management.minAgeBeforeYieldCheck ?? 60;

// ─── SOL/USD price with caching ─────────────────────────────────
let _cachedSolPrice = null;
let _solPriceFetchedAt = 0;
const SOL_PRICE_TTL = 15 * 60 * 1000; // 15 minutes

async function _getSolPrice() {
  const now = Date.now();
  if (_cachedSolPrice && (now - _solPriceFetchedAt) < SOL_PRICE_TTL) return _cachedSolPrice;
  try {
    const { getWalletBalances } = await import("./tools/wallet.js");
    const bal = await getWalletBalances();
    if (bal?.sol_price > 0) {
      _cachedSolPrice = bal.sol_price;
      _solPriceFetchedAt = now;
      return _cachedSolPrice;
    }
  } catch { /* fall through */ }
  _cachedSolPrice = config.management?.solPrice ?? 85;
  _solPriceFetchedAt = now;
  return _cachedSolPrice;
}

// ─── State helpers ─────────────────────────────────────────────

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { positions: {}, recentEvents: [] };
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return { positions: {}, recentEvents: [] }; }
}

function saveState(state) {
  state.lastUpdated = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function loadVirtualLog() {
  if (!fs.existsSync(VIRTUAL_LOG)) return { positions: [] };
  try { return JSON.parse(fs.readFileSync(VIRTUAL_LOG, "utf8")); } catch { return { positions: [] }; }
}

function saveVirtualLog(data) {
  fs.writeFileSync(VIRTUAL_LOG, JSON.stringify(data, null, 2));
}

// ─── Register a virtual position after dry-run deploy ─────────

/**
 * Called by index.js after a dry-run deploy_position result.
 * Stores the virtual position in state.json so management cycles can track it.
 *
 * @param {Object} deployResult  - Result from deploy_position (dry_run=true)
 * @param {Object} poolCandidate - Pool candidate data from screening
 * @param {number} deployAmount  - SOL amount deployed
 */
export async function registerVirtualPosition(deployResult, poolCandidate, deployAmount) {
  if (!deployResult?.dry_run) return null;

  const positionId = `virtual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const solPrice = await _getSolPrice();

  const state = loadState();

  const virtualPos = {
    position: positionId,
    pool: poolCandidate?.pool || deployResult.would_deploy?.pool_address,
    pool_name: poolCandidate?.name || deployResult.would_deploy?.pool_address?.slice(0, 8),
    base_mint: poolCandidate?.base?.mint || null,
    strategy: deployResult.would_deploy?.strategy || poolCandidate?.strategy || config.strategy.strategy || "bid_ask",
    bin_range: {
      min: deployResult.would_deploy?.lower_bin ?? null,
      max: deployResult.would_deploy?.upper_bin ?? null,
      active: deployResult.would_deploy?.active_bin ?? null,
    },
    amount_sol: deployAmount,
    bin_step: poolCandidate?.bin_step ?? null,
    volatility: poolCandidate?.volatility ?? null,
    fee_tvl_ratio: poolCandidate?.fee_active_tvl_ratio ?? null,
    organic_score: poolCandidate?.organic_score ?? null,
    initial_price: deployResult.would_deploy?.price ?? null,
    initial_value_usd: deployAmount * solPrice,
    deployed_at: now,
    out_of_range_since: null,
    peak_pnl_pct: 0,
    trailing_active: false,
    closed: false,
    notes: [],
    virtual: true,
    signal_snapshot: {
      fee_tvl_ratio: poolCandidate?.fee_active_tvl_ratio,
      organic_score: poolCandidate?.organic_score,
      volatility: poolCandidate?.volatility,
      smart_wallets: poolCandidate?.smart_wallets_count ?? 0,
      smart_wallet_addresses: poolCandidate?._sw_at_deploy || [],
      narrative: poolCandidate?.has_narrative ?? false,
    },
  };

  state.positions[positionId] = virtualPos;

  // 💰 Virtual wallet: deduct deploy cost + gas to mirror real SOL balance
  const dryRunCfg = config.dryRun;
  state.virtualSolBalance = (state.virtualSolBalance ?? dryRunCfg.initialVirtualBalance) - deployAmount - dryRunCfg.gasFeePerDeploy;
  state.virtualTotalDeployed = (state.virtualTotalDeployed ?? 0) + deployAmount;
  state.virtualTotalFees = (state.virtualTotalFees ?? 0) + dryRunCfg.gasFeePerDeploy;

  saveState(state);

  log("simulator", `Virtual position registered: ${positionId} | ${virtualPos.pool_name} | ${deployAmount} SOL | initial_price=${virtualPos.initial_price}`);
  return positionId;
}

// ─── Evaluate virtual positions each management cycle ─────────

/**
 * Called by runManagementCycle() when DRY_RUN=true.
 * Fetches real market data and evaluates each virtual position against
 * the same exit rules as live positions.
 *
 * @returns {Array} Array of close events (for Telegram reporting)
 */
export async function evaluateVirtualPositions() {
  const state = loadState();
  const virtualPositions = Object.values(state.positions).filter(
    (p) => p.virtual && !p.closed
  );

  if (virtualPositions.length === 0) return [];

  const closeEvents = [];

  for (const pos of virtualPositions) {
    try {
      const evaluation = await _evaluatePosition(pos);

      if (evaluation.shouldClose) {
        await _closeVirtualPosition(pos, evaluation);
        closeEvents.push({
          pool_name: pos.pool_name,
          reason: evaluation.reason,
          pnl_pct: evaluation.pnl_pct,
          pnl_usd: evaluation.pnl_usd,
          fees_usd: evaluation.fees_usd,
          minutes_held: evaluation.minutes_held,
        });
      } else {
        // Reload state fresh to avoid stale reference
        const freshState = loadState();
        const freshPos = freshState.positions[pos.position];
        if (!freshPos) continue;

        // Update peak PnL for trailing TP tracking
        if (evaluation.pnl_pct > (freshPos.peak_pnl_pct ?? 0)) {
          freshPos.peak_pnl_pct = evaluation.pnl_pct;
          if (freshPos.peak_pnl_pct >= trailingTriggerPct()) {
            freshPos.trailing_active = true;
          }
        }
        // Update OOR state
        if (!evaluation.in_range && !freshPos.out_of_range_since) {
          freshPos.out_of_range_since = new Date().toISOString();
        } else if (evaluation.in_range && freshPos.out_of_range_since) {
          freshPos.out_of_range_since = null;
        }
        saveState(freshState);
      }
    } catch (err) {
      log("simulator_warn", `Failed to evaluate virtual position ${pos.position}: ${err.message}`);
    }
  }

  return closeEvents;
}

// ─── Fetch real market data and compute virtual PnL ───────────

async function _evaluatePosition(pos) {
  const { getPoolDetail } = await import("./tools/screening.js");
  let poolData = null;
  try {
    poolData = await getPoolDetail({ pool_address: pos.pool, timeframe: "1h" });
  } catch { /* use fallback */ }

  const now = Date.now();
  const deployedAt = new Date(pos.deployed_at).getTime();
  const minutes_held = Math.floor((now - deployedAt) / 60000);
  const hours_held = minutes_held / 60;

  // ── Fee estimation ────────────────────────────────────────────
  // fee_active_tvl_ratio is per-timeframe (5m). Convert to per-hour:
  // 5m timeframe → 12 periods/hour → hourly_fee_tvl = ratio * 12
  // Then scale by hours held with a realistic capture rate (0.7 = 70% of fees go to LPs)
  const currentFeeTvl = poolData?.fee_active_tvl_ratio ?? pos.fee_tvl_ratio ?? 0;
  const periodsPerHour = 12; // for 5m timeframe
  const hourlyFeeTvl = currentFeeTvl * periodsPerHour;
  const estimated_fee_pct = Math.min(hourlyFeeTvl * hours_held * 0.7, 80);
  const fees_usd = (pos.initial_value_usd ?? 0) * (estimated_fee_pct / 100);

  // ── Price change estimation ───────────────────────────────────
  // Priority: 
  // 1. Real price change from initial_price (stored at deploy) to current price from API
  // 2. price_change_pct from pool API (last 5m change) as fallback
  // 3. stats_1h.price_change if available
  // 4. Simulation as last resort (biased toward realistic behavior)
  let priceChangePct = 0;
  let priceSource = "none";

  // Try to get current price from pool and compute real price change since open
  const currentPoolPrice = poolData?.price;
  const initialPrice = pos.initial_price;

  if (currentPoolPrice != null && initialPrice != null && initialPrice > 0) {
    // Calculate real price change since position was opened
    priceChangePct = ((currentPoolPrice - initialPrice) / initialPrice) * 100;
    priceSource = "real_from_api";
  } else if (poolData?.price_change_pct != null) {
    // Fallback: use the API's price change (last 5m period)
    priceChangePct = Number(poolData.price_change_pct);
    priceSource = "api_5m";
  } else if (poolData?.stats_1h?.price_change != null) {
    priceChangePct = Number(poolData.stats_1h.price_change);
    priceSource = "api_1h";
  } else {
    // Last resort: simulation with more realistic parameters
    // Use pool's volatility to make simulation more accurate
    const volatility = poolData?.volatility ?? pos.volatility ?? 2;
    priceChangePct = _simulatePriceChange(pos, volatility, minutes_held, now);
    priceSource = "simulation";
  }

  // Clamp to reasonable bounds (can't lose more than 100% in single-sided LP)
  priceChangePct = Math.max(-95, Math.min(200, priceChangePct));

  // For single-sided SOL bid_ask: IL is asymmetric.
  // Simplified: PnL = fees - IL, where IL ≈ 0.5 * |priceChange| for concentrated liquidity
  const ilPct = Math.max(0, Math.abs(priceChangePct) * 0.5 - estimated_fee_pct * 0.3);
  const pnl_pct = estimated_fee_pct - ilPct + (priceChangePct > 0 ? priceChangePct * 0.1 : 0);
  const pnl_usd = (pos.initial_value_usd ?? 0) * (pnl_pct / 100);

  // Determine if in range
  const binStep = pos.bin_step ?? 100;
  const binsBelow = config.strategy.defaultBinsBelow ?? 69;
  const maxDownsidePct = binsBelow * binStep * 0.0001 * 100;
  const in_range = Math.abs(priceChangePct) < maxDownsidePct;

  // OOR duration
  const state = loadState();
  const freshPos = state.positions[pos.position];
  const oorMinutes = freshPos?.out_of_range_since
    ? Math.floor((now - new Date(freshPos.out_of_range_since).getTime()) / 60000)
    : 0;

  const peakPnl = freshPos?.peak_pnl_pct ?? 0;
  const trailingActive = freshPos?.trailing_active ?? false;

  // ── Exit rule evaluation ──────────────────────────────────────
  let shouldClose = false;
  let reason = null;

  if (pnl_pct <= stopLossPct()) {
    shouldClose = true;
    reason = `stop_loss: PnL ${pnl_pct.toFixed(1)}% <= ${stopLossPct()}%`;
  } else if (pnl_pct >= takeProfitPct()) {
    shouldClose = true;
    reason = `take_profit: PnL ${pnl_pct.toFixed(1)}% >= ${takeProfitPct()}%`;
  } else if (trailingActive) {
    const dropFromPeak = peakPnl - pnl_pct;
    if (dropFromPeak >= trailingDropPct()) {
      shouldClose = true;
      reason = `trailing_tp: peak ${peakPnl.toFixed(1)}% -> current ${pnl_pct.toFixed(1)}% (drop ${dropFromPeak.toFixed(1)}%)`;
    }
  } else if (!in_range && oorMinutes >= oorWaitMinutes()) {
    shouldClose = true;
    reason = `oor: out of range ${oorMinutes}m >= ${oorWaitMinutes()}m`;
  } else if (minutes_held >= Math.max(minAgeYieldCheck(), 180) && estimated_fee_pct < 1.0) {
    shouldClose = true;
    reason = `low_yield: cumulative fee ${estimated_fee_pct.toFixed(2)}% < 1.0% in ${minutes_held}m`;
  }

  return {
    shouldClose, reason,
    pnl_pct: Math.round(pnl_pct * 100) / 100,
    pnl_usd: Math.round(pnl_usd * 100) / 100,
    fees_usd: Math.round(fees_usd * 100) / 100,
    minutes_held, in_range,
    fee_tvl_ratio: currentFeeTvl,
    price_change_pct: Math.round(priceChangePct * 100) / 100,
    price_source: priceSource,
  };
}

/**
 * Simulate price change using an unbiased random walk.
 * Uses time-varying seed (bucketed to 12-min intervals) so each
 * management cycle gets a different but reproducible result.
 */
function _simulatePriceChange(pos, volatility, minutes_held, now = Date.now()) {
  const posSeed = pos.position.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  // Bucket time to 12-minute intervals so result changes each management cycle
  const timeBucket = Math.floor(now / (12 * 60 * 1000));
  const seed = posSeed + timeBucket;
  const steps = Math.min(minutes_held, 120);
  let price = 0;
  for (let i = 0; i < steps; i++) {
    // Unbiased: shock centered at 0, no mean reversion bias
    const s = _lcg(seed + i * 7919); // prime multiplier for better distribution
    const shock = (s - 0.5) * 2 * volatility * 0.4;
    price += shock;
  }
  return Math.max(-95, Math.min(200, price));
}

function _lcg(seed) {
  const s = ((seed * 1664525 + 1013904223) & 0xffffffff) >>> 0;
  return s / 0xffffffff;
}

// ─── Close a virtual position and feed into learning pipeline ──

async function _closeVirtualPosition(pos, evaluation) {
  const now = new Date().toISOString();

  // Mark closed in state
  const state = loadState();
  if (state.positions[pos.position]) {
    state.positions[pos.position].closed = true;
    state.positions[pos.position].closed_at = now;
    saveState(state);
  }

  // 💰 Virtual wallet: add back proceeds minus slippage & gas on close
  const dryRunCfg = config.dryRun;
  const solPrice = await _getSolPrice();
  const proceedsBeforeSlippage = pos.amount_sol || 0;
  const pnlInSol = proceedsBeforeSlippage > 0
    ? proceedsBeforeSlippage * (evaluation.pnl_pct / 100)
    : (evaluation.pnl_usd || 0) / (solPrice || 85);
  const slippageDeduction = proceedsBeforeSlippage * (dryRunCfg.slippagePct / 100);
  const returnedSol = Math.max(0, proceedsBeforeSlippage + pnlInSol - slippageDeduction - dryRunCfg.gasFeePerClose);

  const wState = loadState();
  wState.virtualSolBalance = (wState.virtualSolBalance ?? dryRunCfg.initialVirtualBalance) + returnedSol;
  wState.virtualTotalReturned = (wState.virtualTotalReturned ?? 0) + returnedSol;
  wState.virtualTotalFees = (wState.virtualTotalFees ?? 0) + slippageDeduction + dryRunCfg.gasFeePerClose;
  saveState(wState);

  // Archive to virtual-positions.json
  const vlog = loadVirtualLog();
  vlog.positions.push({
    ...pos,
    closed: true,
    closed_at: now,
    close_reason: evaluation.reason,
    final_pnl_pct: evaluation.pnl_pct,
    final_pnl_usd: evaluation.pnl_usd,
    fees_earned_usd: evaluation.fees_usd,
    minutes_held: evaluation.minutes_held,
  });
  saveVirtualLog(vlog);

  log("simulator", `Virtual close: ${pos.pool_name} | ${evaluation.reason} | PnL: ${evaluation.pnl_pct}%`);

  // ── Smart wallet feedback loop ─────────────────────────────────
  const swAddresses = pos.signal_snapshot?.smart_wallet_addresses || [];
  if (swAddresses.length) {
    try {
      const { feedbackToWallets } = await import("./wallet-evolution.js");
      feedbackToWallets(swAddresses, {
        pnl_pct: evaluation.pnl_pct,
        close_reason: evaluation.reason,
        pool_name: pos.pool_name,
      });
    } catch (e) {
      log("simulator_warn", `Wallet feedback error: ${e.message}`);
    }
  }

  // ── Feed into full learning pipeline ──────────────────────────
  await recordPerformance({
    position:          pos.position,
    pool:              pos.pool,
    pool_name:         pos.pool_name,
    base_mint:         pos.base_mint,
    strategy:          pos.strategy,
    bin_range:         pos.bin_range,
    bin_step:          pos.bin_step,
    volatility:        pos.volatility,
    fee_tvl_ratio:     pos.fee_tvl_ratio,
    organic_score:     pos.organic_score,
    amount_sol:        pos.amount_sol,
    fees_earned_usd:   evaluation.fees_usd,
    fees_earned_sol:   evaluation.fees_usd / await _getSolPrice(),
    final_value_usd:   (pos.initial_value_usd ?? 0) + evaluation.pnl_usd,
    initial_value_usd: pos.initial_value_usd ?? 0,
    minutes_in_range:  evaluation.in_range
      ? evaluation.minutes_held
      : Math.floor(evaluation.minutes_held * 0.4),
    minutes_held:      evaluation.minutes_held,
    close_reason:      evaluation.reason,
    deployed_at:       pos.deployed_at,
    virtual:           true,
  });

  // ── Auto-blacklist on suspected rug (fast stop loss) ──────────
  const isLikelyRug =
    evaluation.reason?.includes("stop_loss") &&
    evaluation.minutes_held < 30 &&
    evaluation.pnl_pct <= stopLossPct() * 0.8;

  if (isLikelyRug && pos.base_mint) {
    try {
      addToBlacklist({
        mint: pos.base_mint,
        reason: `[DRY RUN] Fast stop loss in ${evaluation.minutes_held}m — suspected rug`,
      });
      log("simulator", `Auto-blacklisted ${pos.base_mint} (fast stop loss in ${evaluation.minutes_held}m)`);
    } catch { /* non-critical */ }

    try {
      const { getTokenInfo } = await import("./tools/token.js");
      const info = await getTokenInfo({ query: pos.base_mint });
      const deployer = info?.results?.[0]?.dev?.address;
      if (deployer) {
        blockDev({
          address: deployer,
          reason: `[DRY RUN] Deployer of ${pos.pool_name} — fast rug in ${evaluation.minutes_held}m`,
        });
        log("simulator", `Auto-blocked deployer ${deployer.slice(0, 8)} from ${pos.pool_name}`);
      }
    } catch { /* non-critical */ }
  }

  // ── Pool note ──────────────────────────────────────────────────
  if (pos.pool) {
    const noteText = `[DRY RUN] ${evaluation.reason} | PnL: ${evaluation.pnl_pct}% | held: ${evaluation.minutes_held}m`;
    try { addPoolNote({ pool_address: pos.pool, note: noteText }); } catch { /* non-critical */ }
  }

  // ── Decision log ───────────────────────────────────────────────
  appendDecision({
    type: "close",
    actor: "SIMULATOR",
    summary: `Virtual close: ${pos.pool_name}`,
    reason: evaluation.reason,
    pool: pos.pool,
    pool_name: pos.pool_name,
    pnl_pct: evaluation.pnl_pct,
    virtual: true,
  });

  // ── Config optimizer (every 5 virtual closes) ─────────────────
  const freshLog = loadVirtualLog();
  if (freshLog.positions.length >= 5 && freshLog.positions.length % 5 === 0) {
    _optimizeConfig(freshLog.positions).catch(e =>
      log("simulator_warn", `Config optimizer error: ${e.message}`)
    );
  }

  // Log virtual close to SQLite journal
  initLogger();
  logPositionClose({
    positionId: pos.position,
    poolAddress: pos.pool,
    poolName: pos.pool_name,
    pnlPct: evaluation.pnl_pct,
    pnlUsd: evaluation.pnl_usd,
    feesUsd: evaluation.fees_usd,
    reason: evaluation.reason,
    minutesHeld: evaluation.minutes_held,
    dryRun: true,
    volatility: pos.volatility,
    feeTvlRatio: pos.fee_tvl_ratio,
    organicScore: pos.organic_score,
    signalSnapshot: pos.signal_snapshot,
  });
}

// ─── Config optimizer ─────────────────────────────────────────

async function _optimizeConfig(closedPositions) {
  try {
    const { addLesson } = await import("./lessons.js");
    const { getWalletBalances } = await import("./tools/wallet.js");
    const { computeDeployAmount } = await import("./config.js");

    const recent  = closedPositions.slice(-20);
    const wins    = recent.filter(p => (p.final_pnl_pct ?? 0) >= 1);
    const losses  = recent.filter(p => (p.final_pnl_pct ?? 0) < 0);
    const winDenom = wins.length + losses.length;
    const winRate = winDenom > 0 ? wins.length / winDenom : 0;
    const avgPnl  = recent.reduce((s, p) => s + (p.final_pnl_pct ?? 0), 0) / (recent.length || 1);
    const avgHeld = recent.reduce((s, p) => s + (p.minutes_held ?? 0), 0) / (recent.length || 1);

    let walletSol = 1.0;
    try {
      const bal = await getWalletBalances({});
      walletSol = bal?.sol ?? 1.0;
    } catch { /* use default */ }

    const suggestions = [];

    if (winRate < 0.4 && recent.length >= 10) {
      suggestions.push(
        `Win rate ${(winRate * 100).toFixed(0)}% is low — consider raising minOrganic to ${Math.min(config.screening.minOrganic + 5, 85)} or minTokenFeesSol to ${config.screening.minTokenFeesSol + 5}`
      );
    }

    if (winRate > 0.7 && recent.length >= 10) {
      suggestions.push(
        `Win rate ${(winRate * 100).toFixed(0)}% is strong — screening may be too conservative, consider loosening minFeeActiveTvlRatio slightly`
      );
    }

    if (avgHeld < 30 && recent.length >= 5) {
      suggestions.push(
        `Avg hold ${avgHeld.toFixed(0)}m is very short — consider increasing outOfRangeWaitMinutes or widening maxBinsBelow`
      );
    }

    const optimalDeploy = computeDeployAmount(walletSol);
    if (Math.abs(optimalDeploy - config.management.deployAmountSol) > 0.05) {
      suggestions.push(
        `Wallet is ${walletSol.toFixed(3)} SOL — optimal deploy amount is ${optimalDeploy} SOL (current: ${config.management.deployAmountSol} SOL)`
      );
    }

    const stopLossHits = losses.filter(p => p.close_reason?.includes("stop_loss")).length;
    if (stopLossHits > losses.length * 0.6 && losses.length >= 5) {
      suggestions.push(
        `${stopLossHits}/${losses.length} losses hit stop loss — consider widening stopLossPct from ${config.management.stopLossPct}% to ${config.management.stopLossPct - 5}%`
      );
    }

    if (suggestions.length > 0) {
      const summary = [
        `[CONFIG-OPTIMIZER @ ${closedPositions.length} virtual closes`,
        `wallet: ${walletSol.toFixed(3)} SOL`,
        `win: ${(winRate * 100).toFixed(0)}%`,
        `avgPnL: ${avgPnl.toFixed(1)}%]`,
        suggestions.join(" | "),
      ].join(" | ");
      // Dedup: replace existing CONFIG-OPTIMIZER lesson instead of creating duplicates
      const LESSONS_FILE = path.join(__dirname, "lessons.json");
      let lessonsData;
      try { lessonsData = JSON.parse(fs.readFileSync(LESSONS_FILE, "utf8")); } catch { lessonsData = { lessons: [] }; }
      const existingIdx = lessonsData.lessons.findIndex(l => l.rule && l.rule.startsWith("[CONFIG-OPTIMIZER"));
      if (existingIdx >= 0) {
        lessonsData.lessons[existingIdx].rule = summary;
        lessonsData.lessons[existingIdx].created_at = new Date().toISOString();
        lessonsData.lessons[existingIdx].score = 50; // reset score on update
        fs.writeFileSync(LESSONS_FILE, JSON.stringify(lessonsData, null, 2));
        log("simulator", `Config optimizer: updated existing lesson (${suggestions.length} suggestion(s))`);
      } else {
        addLesson(summary, ["config_optimizer", "dry_run", "self_tune"]);
        log("simulator", `Config optimizer: ${suggestions.length} suggestion(s) added to lessons`);
      }
    }
  } catch (err) {
    log("simulator_warn", `Config optimizer failed: ${err.message}`);
  }
}

// ─── Summary for Telegram / REPL ──────────────────────────────

export function getVirtualSummary() {
  const vlog  = loadVirtualLog();
  const state = loadState();

  const closed = vlog.positions;
  const open   = Object.values(state.positions).filter(p => p.virtual && !p.closed);

  if (closed.length === 0 && open.length === 0) {
    const w0 = getVirtualWalletSummary();
    return `No virtual positions yet.\n🪙 Virtual Wallet: ${w0.balance.toFixed(3)} SOL / ${w0.initial.toFixed(3)} SOL (${w0.netPnlPct >= 0 ? "+" : ""}${w0.netPnlPct}%)`;
  }

  const wins    = closed.filter(p => (p.final_pnl_pct ?? 0) >= 1);
  const losses  = closed.filter(p => (p.final_pnl_pct ?? 0) < 0);
  const neutral = closed.filter(p => (p.final_pnl_pct ?? 0) >= 0 && (p.final_pnl_pct ?? 0) < 1);
  const avgPnl = closed.length > 0
    ? closed.reduce((s, p) => s + (p.final_pnl_pct ?? 0), 0) / closed.length
    : 0;
  const totalFees = closed.reduce((s, p) => s + (p.fees_earned_usd ?? 0), 0);

  const wSummary = getVirtualWalletSummary();
  const walletLine = wSummary.initial > 0
    ? `🪙 Virtual Wallet: ${wSummary.balance.toFixed(3)} SOL / ${wSummary.initial.toFixed(3)} SOL (${wSummary.netPnlPct >= 0 ? "+" : ""}${wSummary.netPnlPct}%)`
    : `🪙 Virtual Wallet: ${wSummary.balance.toFixed(3)} SOL`;

  const lines = [
    `📊 Virtual Trading Summary (Dry Run)`,
    ``,
    walletLine,
    `Open: ${open.length} | Closed: ${closed.length}`,
  ];

  if (closed.length > 0) {
    const winDenom = wins.length + losses.length;
    const winRatePct = winDenom > 0 ? Math.round((wins.length / winDenom) * 100) : 0;
    lines.push(
      `Win rate: ${winRatePct}% (${wins.length}W / ${losses.length}L${neutral.length > 0 ? ` / ${neutral.length} neutral` : ""})`,
      `Avg PnL: ${avgPnl >= 0 ? "+" : ""}${avgPnl.toFixed(1)}%`,
      `Total fees simulated: $${totalFees.toFixed(2)}`
    );
  }

  if (open.length > 0) {
    lines.push(``, `Open virtual positions:`);
    open.forEach((p, i) => {
      const age = Math.floor((Date.now() - new Date(p.deployed_at).getTime()) / 60000);
      lines.push(`${i + 1}. ${p.pool_name} | ${p.amount_sol} SOL | ${age}m old`);
    });
  }

  if (closed.length > 0) {
    lines.push(``, `Last 5 closes:`);
    closed.slice(-5).reverse().forEach(p => {
      const sign = (p.final_pnl_pct ?? 0) >= 0 ? "+" : "";
      lines.push(`• ${p.pool_name}: ${sign}${p.final_pnl_pct?.toFixed(1)}% (${p.close_reason?.split(":")[0]})`);
    });
  }

  return lines.join("\n");
}

/**
 * Get virtual wallet balance summary.
 */
export function getVirtualWalletSummary() {
  const state = loadState();
  const dryRunCfg = config.dryRun;
  const initial = dryRunCfg.initialVirtualBalance;
  const balance = state.virtualSolBalance ?? initial;
  const totalDeployed = state.virtualTotalDeployed ?? 0;
  const totalReturned = state.virtualTotalReturned ?? 0;
  const totalFees = state.virtualTotalFees ?? 0;
  const netPnl = balance - initial;

  return {
    initial: parseFloat(initial.toFixed(3)),
    balance: parseFloat(balance.toFixed(3)),
    totalDeployed: parseFloat(totalDeployed.toFixed(3)),
    totalReturned: parseFloat(totalReturned.toFixed(3)),
    totalFees: parseFloat(totalFees.toFixed(4)),
    netPnl: parseFloat(netPnl.toFixed(3)),
    netPnlPct: initial > 0 ? ((netPnl / initial) * 100).toFixed(1) : "0.0",
  };
}
