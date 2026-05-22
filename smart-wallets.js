import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WALLETS_PATH = path.join(__dirname, "smart-wallets.json");

function loadWallets() {
  if (!fs.existsSync(WALLETS_PATH)) return { wallets: [] };
  try {
    return JSON.parse(fs.readFileSync(WALLETS_PATH, "utf8"));
  } catch {
    return { wallets: [] };
  }
}

function saveWallets(data) {
  try {
    fs.writeFileSync(WALLETS_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    log("smart_wallets_warn", `Failed to save smart-wallets.json: ${err.message}`);
  }
}

/**
 * Ensure smart-wallets.json exists with an empty wallet list.
 * Called on startup to avoid permission errors on first write.
 */
export function initSmartWalletsFile() {
  if (!fs.existsSync(WALLETS_PATH)) {
    try {
      fs.writeFileSync(WALLETS_PATH, JSON.stringify({ wallets: [] }, null, 2));
      log("smart_wallets", "Created empty smart-wallets.json");
    } catch (err) {
      log("smart_wallets_warn", `Could not create smart-wallets.json: ${err.message}. Smart wallet tracking will be disabled.`);
    }
  }
}

const SOLANA_PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function addSmartWallet({ name, address, category = "alpha", type = "lp", source = "manual", stats = null }) {
  if (!SOLANA_PUBKEY_RE.test(address)) {
    return { success: false, error: "Invalid Solana address format" };
  }
  const data = loadWallets();
  const existing = data.wallets.find((w) => w.address === address);
  if (existing) {
    return { success: false, error: `Already tracked as "${existing.name}"` };
  }
  const entry = { name, address, category, type, source, addedAt: new Date().toISOString() };
  if (stats) entry.stats = stats;
  data.wallets.push(entry);
  saveWallets(data);
  log("smart_wallets", `Added wallet: ${name} (${category}, type=${type}, source=${source})`);
  return { success: true, wallet: { name, address, category, type, source } };
}

export function removeSmartWallet({ address }) {
  const data = loadWallets();
  const wallet = data.wallets.find((w) => w.address === address);
  if (!wallet) return { success: false, error: "Wallet not found" };
  data.wallets = data.wallets.filter((w) => w.address !== address);
  saveWallets(data);
  log("smart_wallets", `Removed wallet: ${wallet.name}`);
  return { success: true, removed: wallet.name };
}

export function listSmartWallets() {
  const { wallets } = loadWallets();
  return { total: wallets.length, wallets };
}

// Cache wallet positions for 5 minutes to avoid hammering RPC
const _cache = new Map(); // address -> { positions, fetchedAt }
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Get a confidence score for a wallet based on data quantity.
 * The more positions observed, the more we trust its stats.
 * Helps avoid giving overweighted confidence to wallets with only 2-3 positions.
 */
export function getWalletConfidence(wallet) {
  const stats = wallet.stats || {};
  const positions = stats.total_positions_observed ?? 0;
  const lastSeen = stats.last_seen ? new Date(stats.last_seen).getTime() : Date.now();
  const daysSinceSeen = (Date.now() - lastSeen) / (24 * 60 * 60 * 1000);

  // Base confidence from sample size
  let confidence = 0.2; // minimum floor
  if (positions >= 20) confidence = 1.0;
  else if (positions >= 10) confidence = 0.9;
  else if (positions >= 5) confidence = 0.75;
  else if (positions >= 3) confidence = 0.5;

  // Decay for stale data
  if (daysSinceSeen > 14) confidence *= 0.7;
  if (daysSinceSeen > 30) confidence *= 0.3;

  return confidence;
}

export async function checkSmartWalletsOnPool({ pool_address }) {
  const { wallets: allWallets } = loadWallets();
  // Check ALL tracked wallets — both LP-type (have positions to check) and
  // holder-type (monitored for early alpha, no positions expected in target pool)
  // Also include "kol" and "insider" types
  const wallets = allWallets.filter((w) => !w.type || w.type === "lp" || w.type === "holder" || w.type === "kol" || w.type === "insider");
  if (wallets.length === 0) {
    return {
      pool: pool_address,
      tracked_wallets: 0,
      in_pool: [],
      confidence_boost: false,
      avg_confidence: 0,
      signal: "No smart wallets tracked yet — neutral signal",
    };
  }

  const { getWalletPositions } = await import("./tools/dlmm.js");

  // Serialize wallet position fetches to avoid RPC 429 burst.
  // Each getWalletPositions() calls getProgramAccounts (heavy RPC).
  // Parallel = instant rate limit on Helius free tier.
  const results = [];
  for (const wallet of wallets) {
    try {
      const cached = _cache.get(wallet.address);
      if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
        results.push({ wallet, positions: cached.positions });
        continue;
      }
      const { positions } = await getWalletPositions({ wallet_address: wallet.address });
      _cache.set(wallet.address, { positions: positions || [], fetchedAt: Date.now() });
      results.push({ wallet, positions: positions || [] });
    } catch {
      results.push({ wallet, positions: [] });
    }
  }

  const inPool = results
    .filter((r) => r.positions.some((p) => p.pool === pool_address))
    .map((r) => ({
      name: r.wallet.name,
      category: r.wallet.category,
      type: r.wallet.type,
      address: r.wallet.address,
      confidence: getWalletConfidence(r.wallet),
    }));

  const avgConfidence = wallets.length > 0
    ? wallets.reduce((s, w) => s + getWalletConfidence(w), 0) / wallets.length
    : 0;

  return {
    pool: pool_address,
    tracked_wallets: wallets.length,
    in_pool: inPool,
    confidence_boost: inPool.length > 0,
    avg_confidence: parseFloat(avgConfidence.toFixed(2)),
    signal: inPool.length > 0
      ? `${inPool.length}/${wallets.length} smart wallet(s) are in this pool: ${inPool.map((w) => `${w.name} (conf:${w.confidence.toFixed(2)})`).join(", ")} — STRONG signal`
      : `0/${wallets.length} smart wallets in this pool — neutral, rely on fundamentals`,
  };
}
