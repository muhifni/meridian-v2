/**
 * Shared rate limiter for Jupiter Data API (datapi.jup.ag)
 * Ensures max 1 request/second across all callers (token.js, screening.js, etc.)
 *
 * Uses a promise queue so concurrent callers are serialized — not just
 * time-gated. Without the queue, parallel Promise.allSettled calls can
 * all pass the elapsed check simultaneously and burst the API.
 *
 * Includes 15s timeout per request via AbortController to prevent
 * hanging the queue when a downstream API stalls.
 */

import { getJupiterApiKey } from "./jupiter-keys.js";

const MIN_INTERVAL_MS = 1100; // slightly above 1s to be safe
const FETCH_TIMEOUT_MS = 15_000; // 15s max per request
let _queue = Promise.resolve();

export async function rateLimitedDataPiFetch(url, options = {}) {
  // Chain onto the shared queue so every caller is serialized
  const result = _queue.then(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const start = Date.now();
    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          "x-api-key": getJupiterApiKey(),
          ...options.headers,
        },
      });
      // Enforce minimum interval before next request
      const elapsed = Date.now() - start;
      if (elapsed < MIN_INTERVAL_MS) {
        await new Promise(r => setTimeout(r, MIN_INTERVAL_MS - elapsed));
      }
      return res;
    } finally {
      clearTimeout(timer);
    }
  });
  // Advance the queue pointer (swallow errors so queue never stalls)
  _queue = result.catch(() => {});
  return result;
}
