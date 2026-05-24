/**
 * Shared candidate state — accessible from both index.js and telegram command handlers.
 */
let _latestCandidates = [];
let _latestCandidatesAt = null;

export function setLatestCandidates(candidates = []) {
  _latestCandidates = Array.isArray(candidates) ? candidates : [];
  _latestCandidatesAt = new Date().toISOString();
}

export function getLatestCandidates() {
  return _latestCandidates;
}

export function getLatestCandidatesMeta() {
  return {
    candidates: _latestCandidates,
    count: _latestCandidates.length,
    updatedAt: _latestCandidatesAt,
  };
}
