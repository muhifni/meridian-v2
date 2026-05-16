/**
 * Shared rate limiter for Jupiter Data API (datapi.jup.ag)
 * Ensures max 1 request/second across all callers (token.js, screening.js, etc.)
 *
 * Uses a promise queue so concurrent callers are serialized — not just
 * time-gated. Without the queue, parallel Promise.allSettled calls can
 * all pass the elapsed check simultaneously and burst the API.
 */

import { getJupiterApiKey } from "./jupiter-keys.js";

const MIN_INTERVAL_MS = 1100; // slightly above 1s to be safe
let _queue = Promise.resolve();

export async function rateLimitedDataPiFetch(url, options = {}) {
  // Chain onto the shared queue so every caller is serialized
  const result = _queue.then(async () => {
    const start = Date.now();
    const res = await fetch(url, {
      ...options,
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
  });
  // Advance the queue pointer (swallow errors so queue never stalls)
  _queue = result.catch(() => {});
  return result;
}
