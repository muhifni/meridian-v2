/**
 * Shared rate limiter for Jupiter Data API (datapi.jup.ag)
 * Ensures max 1 request/second across all callers (token.js, screening.js, etc.)
 */

let _lastCall = 0;
const MIN_INTERVAL_MS = 1100; // slightly above 1s to be safe

export async function rateLimitedDataPiFetch(url) {
  const now = Date.now();
  const elapsed = now - _lastCall;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  _lastCall = Date.now();
  return fetch(url);
}
