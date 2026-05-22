/**
 * twitter-wallet.js — Twitter/KOL Wallet Discovery
 *
 * Uses twitter-cli to scan KOL tweets for Solana addresses,
 * then discovers wallet holders from those tokens via OKX clusters.
 *
 * Strategy:
 *   1. Fetch recent tweets from known KOL accounts via twitter-cli
 *   2. Extract Solana addresses (token mints, pool addresses) from tweet text
 *   3. For each address, check OKX cluster data for KOL-associated wallets
 *   4. Cross-reference with current smart-wallets.json to avoid dupes
 *   5. Return discovery candidates for auto-adding as "holder" wallets
 *
 * Known KOLs (Evil Panda strategy):
 *   - @EvilPanda, @arip13741167, @4thinfected
 *
 * Requires: twitter-cli installed (~/.local/bin/twitter) with valid cookies
 *   and TWITTER_AUTH_TOKEN + TWITTER_CT0 env vars sourced.
 */

import { log } from "./logger.js";
import { execSync } from "child_process";

// ─── Known KOL Twitter Handles ───────────────────────────────────
const DEFAULT_KOLS = [
  "EvilPanda",
  "arip13741167",
  "4thinfected",
];

// Solana address regex — matches base58 addresses (mints, pools, wallets)
const SOLANA_ADDR_RE = /solana:([1-9A-HJ-NP-Za-km-z]{32,44})/g;

// Also match bare addresses that look like Solana tokens
const BARE_ADDR_RE = /\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/g;

// Known false positives — program IDs, system accounts
const KNOWN_NON_TOKENS = new Set([
  "So11111111111111111111111111111111111111112", // wSOL
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // Token Program
  "ATokenGPvbdGVxr1b2hvZbsiqW5xr25ix9fJhJbRq21N", // ATA
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s", // Metadata
  "ComputeBudget111111111111111111111111111111", // Budget
  "11111111111111111111111111111111", // System Program
  "5QU99Tf3nbNL7BQcMSfoiVEqZx6cVqrfGxNu1hT4pump", // pump.fun
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", // pump.fun
]);

/**
 * Fetch tweets from a KOL via twitter-cli search command.
 * Searches for tweets mentioning "solana:" prefix to find token/address mentions.
 * @param {string} handle - Twitter handle (without @)
 * @param {number} count - Max tweets
 * @returns {Promise<Array>} Array of tweet objects with .text field
 */
async function fetchKolTweets(handle, count = 15) {
  try {
    const stdout = execSync(
      `source ~/.twitter-env 2>/dev/null; twitter search "from:${handle} solana:" --json 2>/dev/null`,
      { encoding: "utf8", timeout: 20000, shell: "/bin/bash" }
    );
    const parsed = JSON.parse(stdout);
    if (!parsed.ok || !Array.isArray(parsed.data)) return [];
    return parsed.data.slice(0, count);
  } catch (err) {
    log("twitter_wallet", `twitter-cli search failed for @${handle}: ${err.message}`);
    return [];
  }
}

/**
 * Extract Solana addresses from tweet text.
 * First tries `solana:ADDRESS` format (from EvilPanda-style tweets),
 * then falls back to bare addresses.
 */
function extractSolanaAddresses(text) {
  if (!text) return [];

  const addresses = new Set();

  // Priority: solana:ADDRESS format (explicit token mentions)
  const solanaPrefix = text.matchAll(SOLANA_ADDR_RE);
  for (const match of solanaPrefix) {
    if (!KNOWN_NON_TOKENS.has(match[1])) {
      addresses.add({ address: match[1], source: "solana_prefix" });
    }
  }

  // Fallback: bare addresses that look like tokens
  if (addresses.size === 0) {
    const bare = text.matchAll(BARE_ADDR_RE);
    for (const match of bare) {
      if (KNOWN_NON_TOKENS.has(match[1])) continue;
      // Filter out very long addresses (probably not tokens)
      if (match[1].length > 44 || match[1].length < 32) continue;
      addresses.add({ address: match[1], source: "bare" });
    }
  }

  return [...addresses];
}

/**
 * Discover holder wallets from a token address using OKX cluster data.
 * @param {string} tokenAddress - Token mint address
 * @returns {Promise<Array>} Array of holder candidate objects
 */
async function discoverHolderCandidates(tokenAddress) {
  const candidates = [];
  try {
    const { getAdvancedInfo, getClusterList } = await import("./tools/okx.js");
    const [adv, clusters] = await Promise.all([
      getAdvancedInfo(tokenAddress).catch(() => null),
      getClusterList(tokenAddress).catch(() => []),
    ]);

    // From KOL clusters
    if (clusters?.length) {
      for (const cluster of clusters) {
        if (cluster.has_kol && cluster.wallets?.length) {
          for (const wallet of cluster.wallets.slice(0, 3)) {
            candidates.push({
              address: wallet.address || wallet,
              cluster_trend: cluster.trend || "unknown",
              holding_pct: cluster.holding_pct || null,
            });
          }
        }
      }
    }

    // Smart money dev
    if (adv?.smart_money_buy && adv?.creator) {
      candidates.push({
        address: adv.creator,
        cluster_trend: "smart_money_dev",
        holding_pct: null,
      });
    }
  } catch {
    // non-critical
  }
  return candidates;
}

/**
 * Main function: scan KOL tweets for Solana addresses and discover smart wallets.
 *
 * @param {object} options
 * @param {string[]} [options.kolHandles] - List of KOL Twitter handles
 * @param {number} [options.tweetsPerKol] - Tweets to fetch per KOL (default: 10)
 * @returns {Promise<{addressesFound: number, candidates: Array, tweets: Array, errors: string[]}>}
 */
export async function discoverWalletsFromKolTweets({
  kolHandles = DEFAULT_KOLS,
  tweetsPerKol = 10,
} = {}) {
  log("twitter_wallet", `Scanning ${kolHandles.length} KOL(s) via twitter-cli...`);
  const errors = [];
  const allTweets = [];
  const addressSet = new Map(); // address -> { sourceKol, tweetText }

  for (const handle of kolHandles) {
    const tweets = await fetchKolTweets(handle, tweetsPerKol);
    log("twitter_wallet", `@${handle}: ${tweets.length} tweets fetched`);
    allTweets.push(...tweets);

    for (const tweet of tweets) {
      const found = extractSolanaAddresses(tweet.text);
      for (const { address, source } of found) {
        if (!addressSet.has(address)) {
          addressSet.set(address, {
            sourceKol: handle,
            sourceType: source,
            tweetText: tweet.text.slice(0, 150),
            tweetId: tweet.id,
          });
        }
      }
    }
  }

  if (addressSet.size === 0) {
    log("twitter_wallet", "No Solana addresses found in KOL tweets");
    return { addressesFound: 0, candidates: [], tweets: allTweets, errors: [] };
  }

  log("twitter_wallet", `Found ${addressSet.size} unique Solana address(es) in tweets`);
  for (const [addr, info] of addressSet) {
    log("twitter_wallet", `  ${addr.slice(0, 12)}... → from @${info.sourceKol} (${info.sourceType})`);
  }

  // Check which are Meteora pools
  const { listSmartWallets } = await import("./smart-wallets.js");
  const { wallets: existingWallets } = listSmartWallets();
  const existingAddresses = new Set(existingWallets.map((w) => w.address));

  const candidates = [];

  for (const [address, info] of addressSet) {
    if (existingAddresses.has(address)) continue;

    // Discover holder wallets from OKX clusters for this token
    const holderCandidates = await discoverHolderCandidates(address);
    const poolName = info.tweetText.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);

    for (const hc of holderCandidates) {
      if (existingAddresses.has(hc.address)) continue;

      const name = `kol_${poolName}_${hc.address.slice(0, 6)}`;
      candidates.push({
        address: hc.address,
        name,
        category: "kol",
        type: "holder",
        source: "twitter_kol",
        stats: {
          discovered_from_token: address,
          discovered_by: info.sourceKol,
          cluster_trend: hc.cluster_trend || null,
          holding_pct: hc.holding_pct || null,
          tweet_id: info.tweetId,
          discovered_at: new Date().toISOString(),
        },
      });
      log("twitter_wallet", `  → Candidate: ${name} (${hc.address.slice(0, 8)}..., trend=${hc.cluster_trend})`);
    }
  }

  log("twitter_wallet", `Discovery complete: ${candidates.length} candidate(s) from ${addressSet.size} address(es)`);
  return {
    addressesFound: addressSet.size,
    candidates,
    tweets: allTweets,
    errors: errors.length ? errors : undefined,
  };
}

/**
 * Quick scan: just list Solana addresses from KOL tweets (no holder discovery).
 * Faster for pool address detection.
 */
export async function scanKolPools({ kolHandles = DEFAULT_KOLS, tweetsPerKol = 10 } = {}) {
  const addresses = [];

  for (const handle of kolHandles) {
    const tweets = await fetchKolTweets(handle, tweetsPerKol);
    for (const tweet of tweets) {
      const found = extractSolanaAddresses(tweet.text);
      for (const { address } of found) {
        addresses.push({
          address,
          kol: handle,
          tweet: tweet.text.slice(0, 120),
        });
      }
    }
  }

  return addresses;
}
