/**
 * Causal Analysis Engine
 *
 * Analyzes WHY positions win or lose by finding statistically significant
 * correlations between entry conditions and outcomes. Goes deeper than
 * simple threshold evolution — identifies specific causal factors and
 * generates actionable lessons with config recommendations.
 *
 * Runs automatically after every 5 closes (same cadence as evolveThresholds).
 * Results are injected into lessons.json so the agent sees them in every cycle.
 *
 * Factors analyzed:
 *   - Token age at deploy (hours)
 *   - Smart wallets present (boolean)
 *   - Narrative quality (present/absent)
 *   - Volatility at deploy
 *   - fee_tvl_ratio at deploy
 *   - organic_score at deploy
 *   - Range efficiency
 *   - Hold duration vs outcome
 *   - Close reason patterns
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LESSONS_FILE  = path.join(__dirname, "lessons.json");
const ANALYSIS_FILE = path.join(__dirname, "causal-analysis.json");

const MIN_SAMPLES_FOR_ANALYSIS = 5;
const MIN_SAMPLES_PER_BUCKET   = 2;
const STRONG_EFFECT_THRESHOLD  = 0.25;

// ─── Data helpers ──────────────────────────────────────────────

function loadLessons() {
  if (!fs.existsSync(LESSONS_FILE)) return { lessons: [], performance: [] };
  try { return JSON.parse(fs.readFileSync(LESSONS_FILE, "utf8")); } catch { return { lessons: [], performance: [] }; }
}

function saveLessons(data) {
  fs.writeFileSync(LESSONS_FILE, JSON.stringify(data, null, 2));
}

function loadAnalysis() {
  if (!fs.existsSync(ANALYSIS_FILE)) return { runs: [], last_run: null };
  try { return JSON.parse(fs.readFileSync(ANALYSIS_FILE, "utf8")); } catch { return { runs: [], last_run: null }; }
}

function saveAnalysis(data) {
  try { fs.writeFileSync(ANALYSIS_FILE, JSON.stringify(data, null, 2)); } catch { /* non-critical */ }
}

// ─── Main entry point ──────────────────────────────────────────

export function runCausalAnalysis(perfData) {
  if (!perfData || perfData.length < MIN_SAMPLES_FOR_ANALYSIS) {
    return { lessons_added: 0, findings: [], recommendations: [] };
  }

  const findings = [];
  const recommendations = [];

  // 1. Smart wallet presence
  const swF = analyzeBoolean(
    perfData,
    p => p.signal_snapshot?.smart_wallets_present === true,
    "smart wallets present", "no smart wallets"
  );
  if (swF) {
    findings.push(swF);
    if (swF.effect > STRONG_EFFECT_THRESHOLD) {
      const better = swF.with_win_rate > swF.without_win_rate;
      recommendations.push({
        type: "screening",
        insight: `Smart wallets: ${(swF.with_win_rate * 100).toFixed(0)}% win rate WITH vs ${(swF.without_win_rate * 100).toFixed(0)}% WITHOUT (${swF.with_count + swF.without_count} samples).`,
        action: better
          ? "Smart wallet presence is a strong predictor. Prioritize pools with smart wallets."
          : "Smart wallet signal is not predictive in current data. Do not over-weight it.",
        confidence: "high",
      });
    }
  }

  // 2. Narrative quality
  const narF = analyzeBoolean(
    perfData,
    p => p.signal_snapshot?.narrative_quality === "present",
    "narrative present", "no narrative"
  );
  if (narF) {
    findings.push(narF);
    if (narF.effect > STRONG_EFFECT_THRESHOLD) {
      const better = narF.with_win_rate > narF.without_win_rate;
      recommendations.push({
        type: "screening",
        insight: `Narrative: ${(narF.with_win_rate * 100).toFixed(0)}% win WITH vs ${(narF.without_win_rate * 100).toFixed(0)}% WITHOUT (${narF.with_count + narF.without_count} samples).`,
        action: better
          ? "Narrative quality is a strong predictor. Maintain narrative requirement."
          : "Narrative requirement may be filtering good opportunities. Consider relaxing when other signals are strong.",
        confidence: "high",
      });
    }
  }

  // 3. Token age
  const ageBuckets = analyzeNumericBuckets(
    perfData, p => extractTokenAge(p),
    [
      { label: "very_new (<6h)",     min: 0,   max: 6   },
      { label: "new (6-24h)",        min: 6,   max: 24  },
      { label: "established (1-7d)", min: 24,  max: 168 },
      { label: "mature (>7d)",       min: 168, max: Infinity },
    ], "token_age_hours"
  );
  if (ageBuckets.length >= 2) {
    findings.push(...ageBuckets);
    const best  = ageBuckets.reduce((b, f) => f.win_rate > b.win_rate ? f : b, ageBuckets[0]);
    const worst = ageBuckets.reduce((w, f) => f.win_rate < w.win_rate ? f : w, ageBuckets[0]);
    if (best.win_rate - worst.win_rate > STRONG_EFFECT_THRESHOLD) {
      recommendations.push({
        type: "screening",
        insight: `Token age: ${best.label} → ${(best.win_rate * 100).toFixed(0)}% win rate vs ${worst.label} → ${(worst.win_rate * 100).toFixed(0)}%.`,
        action: worst.label.includes("very_new")
          ? "Avoid tokens under 6h old. Consider setting minTokenAgeHours=6."
          : `Best results with ${best.label} tokens. Adjust minTokenAgeHours/maxTokenAgeHours.`,
        config_suggestion: worst.label.includes("very_new") ? { minTokenAgeHours: 6 } : null,
        confidence: "high",
      });
    }
  }

  // 4. Volatility
  const volBuckets = analyzeNumericBuckets(
    perfData, p => p.volatility,
    [
      { label: "low (<1)",     min: 0, max: 1 },
      { label: "medium (1-3)", min: 1, max: 3 },
      { label: "high (3-5)",   min: 3, max: 5 },
      { label: "extreme (>5)", min: 5, max: Infinity },
    ], "volatility"
  );
  if (volBuckets.length >= 2) {
    findings.push(...volBuckets);
    const best  = volBuckets.reduce((b, f) => f.win_rate > b.win_rate ? f : b, volBuckets[0]);
    const worst = volBuckets.reduce((w, f) => f.win_rate < w.win_rate ? f : w, volBuckets[0]);
    if (best.win_rate - worst.win_rate > STRONG_EFFECT_THRESHOLD) {
      recommendations.push({
        type: "screening",
        insight: `Volatility sweet spot: ${best.label} → ${(best.win_rate * 100).toFixed(0)}% win rate. ${worst.label} → ${(worst.win_rate * 100).toFixed(0)}%.`,
        action: `Focus on ${best.label} volatility pools. Avoid ${worst.label} volatility.`,
        confidence: "medium",
      });
    }
  }

  // 5. fee_tvl_ratio
  const feeBuckets = analyzeNumericBuckets(
    perfData, p => p.fee_tvl_ratio,
    [
      { label: "low (<0.1)",       min: 0,   max: 0.1 },
      { label: "medium (0.1-0.3)", min: 0.1, max: 0.3 },
      { label: "high (0.3-0.5)",   min: 0.3, max: 0.5 },
      { label: "very_high (>0.5)", min: 0.5, max: Infinity },
    ], "fee_tvl_ratio"
  );
  if (feeBuckets.length >= 2) {
    findings.push(...feeBuckets);
    const best = feeBuckets.reduce((b, f) => f.win_rate > b.win_rate ? f : b, feeBuckets[0]);
    if (best.win_rate > 0.6 && best.sample_count >= MIN_SAMPLES_PER_BUCKET) {
      const minFee = best.label.includes("very_high") ? 0.5 : best.label.includes("high") ? 0.3 : 0.1;
      recommendations.push({
        type: "screening",
        insight: `fee_tvl_ratio ${best.label} → ${(best.win_rate * 100).toFixed(0)}% win rate (${best.sample_count} samples).`,
        action: `Consider raising minFeeActiveTvlRatio to ${minFee} to focus on higher-quality pools.`,
        config_suggestion: { minFeeActiveTvlRatio: minFee },
        confidence: "medium",
      });
    }
  }

  // 6. Range efficiency
  const rangeBuckets = analyzeNumericBuckets(
    perfData, p => p.range_efficiency,
    [
      { label: "poor (<30%)",   min: 0,  max: 30  },
      { label: "ok (30-60%)",   min: 30, max: 60  },
      { label: "good (60-80%)", min: 60, max: 80  },
      { label: "great (>80%)",  min: 80, max: 100 },
    ], "range_efficiency"
  );
  if (rangeBuckets.length >= 2) {
    findings.push(...rangeBuckets);
    const poor = rangeBuckets.find(f => f.label.includes("poor"));
    if (poor && poor.sample_count >= MIN_SAMPLES_PER_BUCKET && poor.win_rate < 0.3) {
      recommendations.push({
        type: "strategy",
        insight: `${poor.sample_count} positions had <30% range efficiency — ${(poor.win_rate * 100).toFixed(0)}% win rate.`,
        action: "Increase bins_below (maxBinsBelow) to widen range coverage. Consider raising minBinsBelow.",
        config_suggestion: { maxBinsBelow: 80 },
        confidence: "high",
      });
    }
  }

  // 7. Close reason patterns
  const closeReasons = analyzeCloseReasons(perfData);
  findings.push(...closeReasons);
  for (const cr of closeReasons) {
    if (cr.pct > 0.4 && cr.avg_pnl < -5) {
      recommendations.push({
        type: "management",
        insight: `${(cr.pct * 100).toFixed(0)}% of closes are "${cr.reason}" with avg PnL ${cr.avg_pnl.toFixed(1)}%.`,
        action: cr.reason === "oor"
          ? "High OOR rate. Consider: wider bins_below, shorter outOfRangeWaitMinutes, or stricter volatility filter."
          : cr.reason === "stop_loss"
          ? "High stop loss rate. Consider: tighter screening (higher organic/fee_tvl) or stricter token age filter."
          : `Review ${cr.reason} close pattern — may indicate systematic entry timing issue.`,
        confidence: "medium",
      });
    }
  }

  // 8. Hold duration
  const holdF = analyzeHoldDuration(perfData);
  if (holdF) {
    findings.push(holdF);
    if (holdF.optimal_range) {
      recommendations.push({
        type: "management",
        insight: `Best outcomes at ${holdF.optimal_range} hold time (${(holdF.optimal_win_rate * 100).toFixed(0)}% win rate, avg PnL ${holdF.optimal_avg_pnl.toFixed(1)}%).`,
        action: `Positions held ${holdF.optimal_range} tend to perform best. Avoid closing too early or holding too long.`,
        confidence: "medium",
      });
    }
  }

  // 9. Organic score
  const organicBuckets = analyzeNumericBuckets(
    perfData, p => p.organic_score,
    [
      { label: "low (60-65)",     min: 60, max: 65  },
      { label: "medium (65-75)",  min: 65, max: 75  },
      { label: "high (75-85)",    min: 75, max: 85  },
      { label: "very_high (>85)", min: 85, max: 100 },
    ], "organic_score"
  );
  if (organicBuckets.length >= 2) {
    findings.push(...organicBuckets);
    const best  = organicBuckets.reduce((b, f) => f.win_rate > b.win_rate ? f : b, organicBuckets[0]);
    const worst = organicBuckets.reduce((w, f) => f.win_rate < w.win_rate ? f : w, organicBuckets[0]);
    if (best.win_rate - worst.win_rate > STRONG_EFFECT_THRESHOLD) {
      const minOrganic = best.label.includes("very_high") ? 85 : best.label.includes("high") ? 75 : 65;
      recommendations.push({
        type: "screening",
        insight: `Organic score ${best.label} → ${(best.win_rate * 100).toFixed(0)}% win rate vs ${worst.label} → ${(worst.win_rate * 100).toFixed(0)}%.`,
        action: `Consider raising minOrganic to ${minOrganic} based on performance data.`,
        config_suggestion: { minOrganic },
        confidence: "high",
      });
    }
  }

  // Generate lessons
  const lessonsAdded = _generateLessons(findings, recommendations, perfData.length);

  // Persist run
  const analysisData = loadAnalysis();
  analysisData.last_run = new Date().toISOString();
  if (!analysisData.runs) analysisData.runs = [];
  analysisData.runs = analysisData.runs.slice(-10);
  analysisData.runs.push({
    timestamp: analysisData.last_run,
    sample_count: perfData.length,
    findings_count: findings.length,
    recommendations_count: recommendations.length,
    lessons_added: lessonsAdded,
    top_recommendations: recommendations.slice(0, 3).map(r => r.insight),
  });
  saveAnalysis(analysisData);

  log("causal", `Analysis: ${findings.length} findings, ${recommendations.length} recs, ${lessonsAdded} lessons added`);
  return { lessons_added: lessonsAdded, findings, recommendations };
}

// ─── Analysis helpers ──────────────────────────────────────────

function analyzeBoolean(perfData, predicate, withLabel, withoutLabel) {
  const withGroup    = perfData.filter(p => predicate(p));
  const withoutGroup = perfData.filter(p => !predicate(p));
  if (withGroup.length < MIN_SAMPLES_PER_BUCKET || withoutGroup.length < MIN_SAMPLES_PER_BUCKET) return null;
  const withWR    = winRate(withGroup);
  const withoutWR = winRate(withoutGroup);
  return {
    type: "boolean_comparison",
    factor: withLabel,
    with_label: withLabel,
    without_label: withoutLabel,
    with_count: withGroup.length,
    without_count: withoutGroup.length,
    with_win_rate: withWR,
    without_win_rate: withoutWR,
    with_avg_pnl: avgPnl(withGroup),
    without_avg_pnl: avgPnl(withoutGroup),
    effect: Math.abs(withWR - withoutWR),
    significant: Math.abs(withWR - withoutWR) > STRONG_EFFECT_THRESHOLD,
  };
}

function analyzeNumericBuckets(perfData, extractor, buckets, factorName) {
  return buckets
    .map(bucket => {
      const group = perfData.filter(p => {
        const val = extractor(p);
        return val != null && Number.isFinite(val) && val >= bucket.min && val < bucket.max;
      });
      if (group.length < MIN_SAMPLES_PER_BUCKET) return null;
      return {
        type: "bucket_analysis",
        factor: factorName,
        label: bucket.label,
        sample_count: group.length,
        win_rate: winRate(group),
        avg_pnl: avgPnl(group),
        avg_fees: avgFees(group),
      };
    })
    .filter(Boolean);
}

function analyzeCloseReasons(perfData) {
  const map = new Map();
  for (const p of perfData) {
    const r = normalizeCloseReason(p.close_reason);
    if (!map.has(r)) map.set(r, []);
    map.get(r).push(p);
  }
  return [...map.entries()]
    .filter(([, g]) => g.length >= MIN_SAMPLES_PER_BUCKET)
    .map(([reason, group]) => ({
      type: "close_reason_pattern",
      reason,
      count: group.length,
      pct: group.length / perfData.length,
      win_rate: winRate(group),
      avg_pnl: avgPnl(group),
      avg_hold_minutes: avg(group.map(p => p.minutes_held).filter(v => v != null)),
    }))
    .sort((a, b) => b.count - a.count);
}

function analyzeHoldDuration(perfData) {
  const buckets = [
    { label: "<30m",    min: 0,    max: 30   },
    { label: "30m-2h",  min: 30,   max: 120  },
    { label: "2h-6h",   min: 120,  max: 360  },
    { label: "6h-24h",  min: 360,  max: 1440 },
    { label: ">24h",    min: 1440, max: Infinity },
  ];
  const results = buckets
    .map(b => {
      const g = perfData.filter(p => p.minutes_held != null && p.minutes_held >= b.min && p.minutes_held < b.max);
      if (g.length < MIN_SAMPLES_PER_BUCKET) return null;
      return { label: b.label, win_rate: winRate(g), avg_pnl: avgPnl(g), count: g.length };
    })
    .filter(Boolean);
  if (results.length < 2) return null;
  const best = results.reduce((b, r) => r.win_rate > b.win_rate ? r : b, results[0]);
  return {
    type: "hold_duration_analysis",
    buckets: results,
    optimal_range: best.label,
    optimal_win_rate: best.win_rate,
    optimal_avg_pnl: best.avg_pnl,
  };
}

// ─── Lesson generation ─────────────────────────────────────────

function _generateLessons(findings, recommendations, sampleCount) {
  const data = loadLessons();
  const existingRules = new Set(data.lessons.map(l => l.rule));
  let added = 0;

  for (const rec of recommendations) {
    if (!rec.insight || !rec.action) continue;
    const rule = `[CAUSAL @ ${sampleCount} closes] ${rec.insight} → ${rec.action}`;
    const isDuplicate = [...existingRules].some(e => _similarity(e, rule) > 0.7);
    if (isDuplicate) continue;

    data.lessons.push({
      id: Date.now() + added,
      rule,
      tags: ["causal_analysis", rec.type, rec.confidence],
      outcome: "manual",
      sourceType: "causal_analysis",
      confidence: rec.confidence === "high" ? 0.85 : rec.confidence === "medium" ? 0.65 : 0.45,
      score: rec.confidence === "high" ? 72 : rec.confidence === "medium" ? 58 : 42,
      config_suggestion: rec.config_suggestion || null,
      created_at: new Date().toISOString(),
      pinned: false,
      role: rec.type === "management" ? "MANAGER" : "SCREENER",
    });
    existingRules.add(rule);
    added++;
  }

  if (added > 0) saveLessons(data);
  return added;
}

// ─── Utilities ─────────────────────────────────────────────────

function winRate(g) {
  return g.length ? g.filter(p => (p.pnl_pct ?? 0) > 0).length / g.length : 0;
}
function avgPnl(g) {
  return g.length ? Math.round(avg(g.map(p => p.pnl_pct ?? 0)) * 100) / 100 : 0;
}
function avgFees(g) {
  const v = g.map(p => p.fees_earned_usd ?? 0).filter(x => x != null);
  return v.length ? Math.round(avg(v) * 100) / 100 : 0;
}
function avg(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}
function normalizeCloseReason(r) {
  const s = String(r || "unknown").toLowerCase();
  if (s.includes("stop_loss") || s.includes("stop loss")) return "stop_loss";
  if (s.includes("trailing"))  return "trailing_tp";
  if (s.includes("take_profit") || s.includes("take profit")) return "take_profit";
  if (s.includes("oor") || s.includes("out of range")) return "oor";
  if (s.includes("low_yield") || s.includes("low yield")) return "low_yield";
  return s.slice(0, 30);
}
function extractTokenAge(p) {
  const v = p.signal_snapshot?.token_age_hours ?? p.token_age_hours;
  return v != null && Number.isFinite(Number(v)) ? Number(v) : null;
}
function _similarity(a, b) {
  const wa = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const wb = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const inter = [...wa].filter(w => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : inter / union;
}

// ─── Summary ───────────────────────────────────────────────────

export function getCausalAnalysisSummary() {
  const data = loadAnalysis();
  if (!data.last_run || !data.runs?.length) {
    return "No causal analysis run yet. Needs 5+ closed positions.";
  }
  const last = data.runs[data.runs.length - 1];
  return [
    `📊 Causal Analysis (${last.timestamp?.slice(0, 16).replace("T", " ")})`,
    `Samples: ${last.sample_count} | Findings: ${last.findings_count} | Lessons: +${last.lessons_added}`,
    "",
    "Top insights:",
    ...(last.top_recommendations || []).map((r, i) => `${i + 1}. ${r}`),
  ].join("\n");
}
