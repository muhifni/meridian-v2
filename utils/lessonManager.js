/**
 * Lesson Scoring & Auto-Pruning Manager
 * 
 * Adds feedback loop to HiveMind lessons:
 * - Scores lessons based on subsequent performance outcomes
 * - Auto-prunes low-value or stale lessons
 * - Prioritizes high-score lessons in prompts
 * 
 * This makes the swarm learning more Darwinian / intelligent over time.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LESSONS_FILE = path.join(__dirname, "../lessons.json");

// Config defaults (can be overridden via user-config.json later)
const DEFAULTS = {
  minScore: 25,           // below this = candidate for prune
  maxLessons: 150,        // hard cap after pruning
  scoreBoostGood: 8,      // points added on good outcome match
  scorePenaltyBad: 12,    // points removed on bad outcome match
  recencyDecayDays: 45,   // lessons older than this get decay
};

function loadData() {
  if (!fs.existsSync(LESSONS_FILE)) {
    return { lessons: [], performance: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(LESSONS_FILE, "utf8"));
  } catch {
    return { lessons: [], performance: [] };
  }
}

function saveData(data) {
  fs.writeFileSync(LESSONS_FILE, JSON.stringify(data, null, 2));
}

/**
 * Ensure every lesson has scoring fields (migration for old lessons)
 */
export function ensureScoringFields(lesson) {
  if (!lesson) return lesson;
  return {
    ...lesson,
    score: Number.isFinite(lesson.score) ? lesson.score : (lesson.confidence ? Math.round(lesson.confidence * 70) : 50),
    usageCount: lesson.usageCount || 0,
    successCount: lesson.successCount || 0,
    lastUsed: lesson.lastUsed || null,
    created_at: lesson.created_at || new Date().toISOString(),
  };
}

/**
 * Apply initial scoring when a new lesson is created
 */
export function initializeLessonScore(lesson, outcome = "neutral") {
  const base = lesson.confidence || 0.5;
  let score = Math.round(base * 65);

  if (outcome === "good" || outcome === "worked") score += 15;
  if (outcome === "bad" || outcome === "failed") score += 5; // bad lessons still useful for AVOID

  return {
    ...lesson,
    score: Math.max(10, Math.min(95, score)),
    usageCount: 0,
    successCount: 0,
    lastUsed: null,
  };
}

/**
 * Update score of lessons that are relevant to a new performance record.
 * Simple but effective heuristic: match by pool or overlapping tags.
 */
export function applyPerformanceFeedback(perf, recentLessons = []) {
  if (!perf || !recentLessons.length) return { updated: 0 };

  const data = loadData();
  let updated = 0;

  const perfTags = new Set([
    perf.strategy,
    perf.pool_name,
    `volatility_${Math.round(perf.volatility || 0)}`,
    perf.close_reason,
  ].filter(Boolean).map(t => String(t).toLowerCase()));

  for (let i = 0; i < data.lessons.length; i++) {
    const lesson = data.lessons[i];
    const l = ensureScoringFields(lesson);
    const lessonTags = new Set((l.tags || []).map(t => String(t).toLowerCase()));
    const ruleLower = (l.rule || "").toLowerCase();

    // Relevance check
    const poolMatch = l.pool && perf.pool && l.pool === perf.pool;
    const tagOverlap = [...perfTags].some(t => lessonTags.has(t) || ruleLower.includes(t));

    if (!poolMatch && !tagOverlap) continue;

    const isGoodOutcome = perf.pnl_pct >= 3 || (perf.fees_earned_usd || 0) >= 4;
    const isBadOutcome = perf.pnl_pct <= -8 || (perf.range_efficiency || 0) < 25;

    if (isGoodOutcome) {
      l.score = Math.min(95, (l.score || 50) + DEFAULTS.scoreBoostGood);
      l.successCount = (l.successCount || 0) + 1;
    } else if (isBadOutcome) {
      l.score = Math.max(5, (l.score || 50) - DEFAULTS.scorePenaltyBad);
    }

    l.usageCount = (l.usageCount || 0) + 1;
    l.lastUsed = new Date().toISOString();
    data.lessons[i] = l; // ← write back mutated copy to array
    updated++;
  }

  if (updated > 0) {
    saveData(data);
    log("lessons", `Scored ${updated} lessons from performance feedback`);
  }
  return { updated };
}

/**
 * Auto-prune low value or stale lessons.
 * Keeps high-score + recently used + pinned lessons.
 */
export function pruneLessons(options = {}) {
  const { minScore = DEFAULTS.minScore, maxKeep = DEFAULTS.maxLessons } = options;

  const data = loadData();
  const before = data.lessons.length;

  if (before === 0) return { pruned: 0, kept: 0 };

  const now = Date.now();
  const decayMs = DEFAULTS.recencyDecayDays * 24 * 60 * 60 * 1000;

  // Score with recency and pinned bonus
  const scored = data.lessons.map(l => {
    const ll = ensureScoringFields(l);
    const ageDays = (now - new Date(ll.created_at || now).getTime()) / (1000 * 3600 * 24);
    const recencyBonus = Math.max(0, 15 - ageDays / 3); // newer = better
    const pinnedBonus = ll.pinned ? 25 : 0;
    const finalScore = (ll.score || 40) + recencyBonus + pinnedBonus;
    return { ...ll, _finalScore: finalScore };
  });

  // Sort by final score desc
  scored.sort((a, b) => b._finalScore - a._finalScore);

  // Keep top + pinned + high score; prune stale unused lessons
  const keptLessons = scored
    .filter((l, idx) => {
      if (l.pinned) return true;
      // Prune: unused lessons older than 7 days (never contributed to any decision)
      const ageDays = (now - new Date(l.created_at || now).getTime()) / (1000 * 3600 * 24);
      if ((l.usageCount || 0) === 0 && ageDays > 7) return false;
      if (l.score >= minScore) return true;
      if (idx < Math.floor(maxKeep * 0.6)) return true; // always keep top 60%
      return false;
    })
    .slice(0, maxKeep)
    .map(({ _finalScore, ...rest }) => rest); // remove temp field

  data.lessons = keptLessons;
  saveData(data);

  const pruned = before - keptLessons.length;
  if (pruned > 0) {
    log("lessons", `Auto-pruned ${pruned} low-value/stale lessons (kept ${keptLessons.length})`);
  }

  return { pruned, kept: keptLessons.length };
}

/**
 * Get lessons sorted by score (for prompt injection or inspection)
 */
export function getScoredLessons(limit = 50) {
  const data = loadData();
  return [...data.lessons]
    .map(ensureScoringFields)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, limit);
}

/**
 * Call this periodically (e.g. every 10-15 closes) or on demand
 */
export function runMaintenance() {
  const pruneResult = pruneLessons();
  return { ...pruneResult, timestamp: new Date().toISOString() };
}

export default {
  ensureScoringFields,
  initializeLessonScore,
  applyPerformanceFeedback,
  pruneLessons,
  getScoredLessons,
  runMaintenance,
};