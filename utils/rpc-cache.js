/**
 * RPC Response Cache + Failover — wraps @solana/web3.js Connection with:
 * 1. TTL cache for read-only methods (reduces RPC calls)
 * 2. Automatic failover: primary → fallback on 429/5xx errors
 *
 * Cached methods:
 * - getAccountInfo (60s TTL)
 * - getMultipleAccountsInfo (60s TTL)
 * - getParsedAccountInfo (60s TTL)
 * - getProgramAccounts (30s TTL)
 * - getBalance (30s TTL)
 * - getTokenAccountsByOwner (30s TTL)
 *
 * Write operations (sendTransaction, simulateTransaction, etc.) are NEVER cached.
 * Failover applies to ALL methods (read + write).
 *
 * ENV:
 *   RPC_URL          — primary RPC (Alchemy)
 *   RPC_URL_FALLBACK — fallback RPC (Helius)
 */

import { Connection } from "@solana/web3.js";
import { log } from "../logger.js";

const DEFAULT_TTL_MS = 60_000; // 60s for account data
const SHORT_TTL_MS = 30_000;   // 30s for balance/program accounts
const MAX_CACHE_SIZE = 500;    // max entries before LRU eviction
const FAILOVER_COOLDOWN_MS = 60_000; // stay on fallback for 60s before retrying primary

class LRUCache {
  constructor(maxSize = MAX_CACHE_SIZE) {
    this._max = maxSize;
    this._map = new Map();
    this._hits = 0;
    this._misses = 0;
  }

  get(key) {
    const entry = this._map.get(key);
    if (!entry) {
      this._misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this._map.delete(key);
      this._misses++;
      return undefined;
    }
    // Move to end (most recently used)
    this._map.delete(key);
    this._map.set(key, entry);
    this._hits++;
    return entry.value;
  }

  set(key, value, ttlMs) {
    if (this._map.size >= this._max) {
      const firstKey = this._map.keys().next().value;
      this._map.delete(firstKey);
    }
    this._map.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  get size() { return this._map.size; }
  get stats() { return { hits: this._hits, misses: this._misses, size: this._map.size }; }

  clear() {
    this._map.clear();
    this._hits = 0;
    this._misses = 0;
  }
}

const _cache = new LRUCache(MAX_CACHE_SIZE);

// Stats logging every 5 minutes
let _lastStatsLog = 0;
function maybeLogStats() {
  const now = Date.now();
  if (now - _lastStatsLog > 300_000) {
    const s = _cache.stats;
    const hitRate = s.hits + s.misses > 0
      ? ((s.hits / (s.hits + s.misses)) * 100).toFixed(1)
      : "0.0";
    log("rpc-cache", `stats: ${s.hits} hits, ${s.misses} misses (${hitRate}% hit rate), ${s.size} entries`);
    _lastStatsLog = now;
  }
}

// Failover state
let _usingFallback = false;
let _fallbackSwitchedAt = 0;
let _failoverCount = 0;

function isRetryableError(err) {
  const msg = err?.message || "";
  return msg.includes("429") || msg.includes("Too Many Requests")
    || msg.includes("503") || msg.includes("502") || msg.includes("500")
    || msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT")
    || msg.includes("fetch failed");
}

/**
 * Create a cached Connection with automatic failover.
 * Primary: RPC_URL (Alchemy), Fallback: RPC_URL_FALLBACK (Helius)
 */
export function createCachedConnection(rpcUrl, commitmentOrConfig = "confirmed") {
  const fallbackUrl = process.env.RPC_URL_FALLBACK;
  const primaryConn = new Connection(rpcUrl, commitmentOrConfig);
  const fallbackConn = fallbackUrl ? new Connection(fallbackUrl, commitmentOrConfig) : null;

  function getActiveConnection() {
    if (!_usingFallback) return primaryConn;
    // Check if cooldown expired — try primary again
    if (Date.now() - _fallbackSwitchedAt > FAILOVER_COOLDOWN_MS) {
      _usingFallback = false;
      log("rpc-failover", `Switching back to primary RPC`);
      return primaryConn;
    }
    return fallbackConn || primaryConn;
  }

  function switchToFallback(err) {
    if (!fallbackConn || _usingFallback) return;
    _usingFallback = true;
    _fallbackSwitchedAt = Date.now();
    _failoverCount++;
    log("rpc-failover", `Primary RPC error (${err?.message?.slice(0, 60)}), switching to fallback (#${_failoverCount})`);
  }

  async function withFailover(fn) {
    try {
      return await fn(getActiveConnection());
    } catch (err) {
      if (isRetryableError(err) && fallbackConn) {
        switchToFallback(err);
        // Retry on fallback
        return await fn(fallbackConn);
      }
      throw err;
    }
  }

  // Proxy: intercept specific methods for caching + failover
  return new Proxy(primaryConn, {
    get(target, prop, receiver) {
      // Cache getAccountInfo
      if (prop === "getAccountInfo") {
        return async (publicKey, config2) => {
          const key = `gai:${publicKey.toString()}`;
          const cached = _cache.get(key);
          if (cached !== undefined) { maybeLogStats(); return cached; }
          const result = await withFailover(conn => conn.getAccountInfo(publicKey, config2));
          _cache.set(key, result, DEFAULT_TTL_MS);
          maybeLogStats();
          return result;
        };
      }

      // Cache getMultipleAccountsInfo
      if (prop === "getMultipleAccountsInfo") {
        return async (publicKeys, config2) => {
          const keys = publicKeys.map(pk => `gai:${pk.toString()}`);
          const allCached = keys.every(k => _cache.get(k) !== undefined);
          if (allCached) {
            maybeLogStats();
            return keys.map(k => _cache.get(k));
          }
          const results = await withFailover(conn => conn.getMultipleAccountsInfo(publicKeys, config2));
          for (let i = 0; i < publicKeys.length; i++) {
            _cache.set(`gai:${publicKeys[i].toString()}`, results[i], DEFAULT_TTL_MS);
          }
          maybeLogStats();
          return results;
        };
      }

      // Cache getParsedAccountInfo
      if (prop === "getParsedAccountInfo") {
        return async (publicKey, config2) => {
          const key = `gpai:${publicKey.toString()}`;
          const cached = _cache.get(key);
          if (cached !== undefined) { maybeLogStats(); return cached; }
          const result = await withFailover(conn => conn.getParsedAccountInfo(publicKey, config2));
          _cache.set(key, result, DEFAULT_TTL_MS);
          maybeLogStats();
          return result;
        };
      }

      // Cache getBalance (shorter TTL)
      if (prop === "getBalance") {
        return async (publicKey, config2) => {
          const key = `gb:${publicKey.toString()}`;
          const cached = _cache.get(key);
          if (cached !== undefined) { maybeLogStats(); return cached; }
          const result = await withFailover(conn => conn.getBalance(publicKey, config2));
          _cache.set(key, result, SHORT_TTL_MS);
          maybeLogStats();
          return result;
        };
      }

      // Cache getProgramAccounts (shorter TTL)
      if (prop === "getProgramAccounts") {
        return async (programId, configOrCommitment) => {
          const filterKey = configOrCommitment
            ? JSON.stringify(configOrCommitment.filters || configOrCommitment)
            : "";
          const key = `gpa:${programId.toString()}:${filterKey}`;
          const cached = _cache.get(key);
          if (cached !== undefined) { maybeLogStats(); return cached; }
          const result = await withFailover(conn => conn.getProgramAccounts(programId, configOrCommitment));
          _cache.set(key, result, SHORT_TTL_MS);
          maybeLogStats();
          return result;
        };
      }

      // Cache getTokenAccountsByOwner (shorter TTL)
      if (prop === "getTokenAccountsByOwner") {
        return async (ownerAddress, filter, commitment) => {
          const filterStr = JSON.stringify(filter);
          const key = `gtabo:${ownerAddress.toString()}:${filterStr}`;
          const cached = _cache.get(key);
          if (cached !== undefined) { maybeLogStats(); return cached; }
          const result = await withFailover(conn => conn.getTokenAccountsByOwner(ownerAddress, filter, commitment));
          _cache.set(key, result, SHORT_TTL_MS);
          maybeLogStats();
          return result;
        };
      }

      // Non-cached methods: still get failover
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function") {
        // Wrap with failover for methods that hit RPC
        const rpcMethods = [
          "sendTransaction", "sendRawTransaction", "confirmTransaction",
          "simulateTransaction", "getLatestBlockhash", "getSlot",
          "getMinimumBalanceForRentExemption", "getSignatureStatuses",
          "getTransaction", "getSignaturesForAddress", "sendAndConfirmTransaction",
          "getAddressLookupTable",
        ];
        if (rpcMethods.includes(prop)) {
          return async (...args) => {
            return withFailover(conn => conn[prop](...args));
          };
        }
        return value.bind(target);
      }
      return value;
    }
  });
}

/**
 * Get cache + failover stats
 */
export function getRpcCacheStats() {
  return { ..._cache.stats, usingFallback: _usingFallback, failoverCount: _failoverCount };
}

/**
 * Clear the RPC cache (e.g. after a transaction is sent)
 */
export function clearRpcCache() {
  _cache.clear();
}
