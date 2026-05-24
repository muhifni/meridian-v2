import fs from "fs";
import { log } from "./logger.js";
import { getPerformanceSummary } from "./lessons.js";

const STATE_FILE = "./state.json";
const LESSONS_FILE = "./lessons.json";

const MAX_LESSONS_DISPLAY = 5;
const MAX_CONFIG_OPTIMIZER_DISPLAY = 1;

export async function generateBriefing() {
  const state = loadJson(STATE_FILE) || { positions: {}, recentEvents: [] };
  const lessonsData = loadJson(LESSONS_FILE) || { lessons: [], performance: [] };

  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // 1. Positions Activity
  const allPositions = Object.values(state.positions || {});
  const openedLast24h = allPositions.filter(p => new Date(p.deployed_at) > last24h);
  const closedLast24h = allPositions.filter(p => p.closed && new Date(p.closed_at) > last24h);

  // 2. Performance Activity (from performance log)
  const perfLast24h = (lessonsData.performance || []).filter(p => new Date(p.recorded_at) > last24h);
  const totalPnLUsd = perfLast24h.reduce((sum, p) => sum + (p.pnl_usd || 0), 0);
  const totalFeesUsd = perfLast24h.reduce((sum, p) => sum + (p.fees_earned_usd || 0), 0);

  // Win rate — exclude $0 PnL positions (they inflate the metric)
  const meaningfulCloses = perfLast24h.filter(p => Math.abs(p.pnl_usd || 0) > 0.01);
  const wins = meaningfulCloses.filter(p => p.pnl_usd > 0);
  const losses = meaningfulCloses.filter(p => p.pnl_usd < 0);

  // 3. Lessons Learned — deduplicated and capped
  const lessonsLast24h = (lessonsData.lessons || []).filter(l => new Date(l.created_at) > last24h);
  const formattedLessons = formatLessonsForBriefing(lessonsLast24h);

  // 4. Current State
  const openPositions = allPositions.filter(p => !p.closed);
  const perfSummary = getPerformanceSummary();

  // 5. Format Message
  const lines = [
    "☀️ <b>Morning Briefing</b> (Last 24h)",
    "────────────────",
    `<b>Activity:</b>`,
    `📥 Positions Opened: ${openedLast24h.length}`,
    `📤 Positions Closed: ${closedLast24h.length}`,
    "",
    `<b>Performance:</b>`,
    `💰 Net PnL: ${totalPnLUsd >= 0 ? "+" : ""}$${totalPnLUsd.toFixed(2)}`,
    `💎 Fees Earned: $${totalFeesUsd.toFixed(2)}`,
    meaningfulCloses.length > 0
      ? `📈 Win Rate (24h): ${Math.round((wins.length / meaningfulCloses.length) * 100)}% (${wins.length}W/${losses.length}L, ${perfLast24h.length - meaningfulCloses.length} neutral excluded)`
      : "📈 Win Rate (24h): N/A (no meaningful closes)",
    meaningfulCloses.length > 0
      ? `📊 Avg PnL: ${(totalPnLUsd / meaningfulCloses.length) >= 0 ? "+" : ""}$${(totalPnLUsd / meaningfulCloses.length).toFixed(2)}/position`
      : "",
    "",
    `<b>Lessons Learned:</b>`,
    formattedLessons,
    "",
    `<b>Current Portfolio:</b>`,
    `📂 Open Positions: ${openPositions.length}`,
    perfSummary
      ? `📊 All-time PnL: $${perfSummary.total_pnl_usd.toFixed(2)} (${perfSummary.win_rate_pct}% win)`
      : "",
    "────────────────"
  ];

  return lines.filter(l => l !== "").join("\n");
}

/**
 * Format lessons for briefing — deduplicate, group, cap output.
 * 
 * Strategy:
 * 1. Separate CONFIG-OPTIMIZER entries (show only latest 1)
 * 2. Group PREFER lessons by pool base name (RICH-SOL, DEGEN-SOL, etc.)
 * 3. For each pool group, show best PnL entry only
 * 4. Sort by PnL descending, cap at MAX_LESSONS_DISPLAY
 * 5. Non-PREFER lessons pass through (capped)
 */
function formatLessonsForBriefing(lessons) {
  if (lessons.length === 0) return "• No new lessons recorded.";

  const configOptimizer = [];
  const preferLessons = [];
  const otherLessons = [];

  for (const l of lessons) {
    if (l.rule.startsWith("[CONFIG-OPTIMIZER")) {
      configOptimizer.push(l);
    } else if (l.rule.startsWith("PREFER:")) {
      preferLessons.push(l);
    } else {
      otherLessons.push(l);
    }
  }

  const output = [];

  // --- PREFER lessons: group by pool name, keep best PnL per pool ---
  if (preferLessons.length > 0) {
    const poolGroups = new Map();
    for (const l of preferLessons) {
      // Extract pool name: "PREFER: RICH-SOL-type pools (...)" → "RICH-SOL"
      const match = l.rule.match(/PREFER:\s*(\S+)-type/);
      const poolName = match ? match[1] : "unknown";
      // Extract PnL percentage
      const pnlMatch = l.rule.match(/PnL\s*\+?([\d.]+)%/);
      const pnl = pnlMatch ? parseFloat(pnlMatch[1]) : 0;

      if (!poolGroups.has(poolName)) {
        poolGroups.set(poolName, { bestPnl: pnl, count: 1, lesson: l });
      } else {
        const existing = poolGroups.get(poolName);
        existing.count++;
        if (pnl > existing.bestPnl) {
          existing.bestPnl = pnl;
          existing.lesson = l;
        }
      }
    }

    // Sort by best PnL descending, take top N
    const sorted = [...poolGroups.entries()]
      .sort((a, b) => b[1].bestPnl - a[1].bestPnl)
      .slice(0, MAX_LESSONS_DISPLAY);

    for (const [poolName, data] of sorted) {
      const suffix = data.count > 1 ? ` (${data.count} deploys)` : "";
      // Extract key metrics from the rule for compact display
      const volMatch = data.lesson.rule.match(/volatility=([\d.]+)/);
      const vol = volMatch ? volMatch[1] : "?";
      output.push(`• ${poolName}: +${data.bestPnl.toFixed(1)}% best PnL, vol=${vol}${suffix}`);
    }
  }

  // --- Other lessons (non-PREFER, non-CONFIG) ---
  const otherCapped = otherLessons.slice(0, Math.max(1, MAX_LESSONS_DISPLAY - output.length));
  for (const l of otherCapped) {
    output.push(`• ${l.rule}`);
  }

  // --- CONFIG-OPTIMIZER: only show latest one ---
  if (configOptimizer.length > 0) {
    // Sort by created_at descending, take latest
    configOptimizer.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    const latest = configOptimizer[0];
    // Extract key info
    const closesMatch = latest.rule.match(/@ (\d+) virtual closes/);
    const avgMatch = latest.rule.match(/avgPnL:\s*([\d.]+)%/);
    const suggestion = latest.rule.split("|").pop()?.trim() || "";
    output.push(`• [CONFIG] ${closesMatch ? closesMatch[1] + " closes" : ""}, avgPnL ${avgMatch ? avgMatch[1] + "%" : "?"} — ${suggestion}`);
  }

  return output.join("\n");
}

function loadJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    log("briefing_error", `Failed to read ${file}: ${err.message}`);
    return null;
  }
}
