#!/usr/bin/env python3
"""
Meridian Pattern Tracker — Closed Position Analysis
Reads lessons.json, virtual-positions.json, and position-journal.db (SQLite).
Reports patterns from all data sources.
"""
import json
import sqlite3
import os
from datetime import datetime, timezone, timedelta
from collections import Counter, defaultdict

# ── Dynamic today & yesterday ────────────────────────────────
now = datetime.now(timezone(timedelta(hours=7)))  # WIB
today = now.strftime('%Y-%m-%d')
yesterday = (now - timedelta(days=1)).strftime('%Y-%m-%d')

# ── Load JSON sources ────────────────────────────────────────
BASE = '/home/ubuntu/project/meridian'

with open(f'{BASE}/virtual-positions.json') as f:
    vp = json.load(f)

with open(f'{BASE}/lessons.json') as f:
    lessons = json.load(f)

with open(f'{BASE}/pool-memory.json') as f:
    pool_memory = json.load(f)

# ── Load SQLite journal ──────────────────────────────────────
DB_PATH = f'{BASE}/position-journal.db'
sq = None
if os.path.exists(DB_PATH):
    try:
        sq = sqlite3.connect(DB_PATH)
        sq.row_factory = sqlite3.Row
    except Exception as e:
        print(f"  ⚠️ SQLite journal not accessible: {e}")
        sq = None

positions = vp.get('positions', [])
performance = lessons.get('performance', [])
lesson_entries = lessons.get('lessons', [])

# ============================================================
# OVERALL STATS
# ============================================================
total = len(positions)
closed = [p for p in positions if p.get('closed')]
open_p = [p for p in positions if not p.get('closed')]
today_closes = [p for p in closed if p.get('closed_at','').startswith(today)]

print("="*60)
print("MERIDIAN PATTERN TRACKER — DRY RUN REPORT")
print("="*60)
print(f"Total positions: {total}")
print(f"Closed: {len(closed)}")
print(f"Open: {len(open_p)}")
print(f"Today's closes: {len(today_closes)}")

if today_closes:
    pnls = [p.get('final_pnl_pct', 0) for p in today_closes]
    fees = [p.get('fees_earned_usd', 0) for p in today_closes]
    avg_pnl = sum(pnls)/len(pnls)
    total_fees = sum(fees)
    win = [p for p in today_closes if p.get('final_pnl_pct', 0) > 0]
    print(f"Today avg PnL: {avg_pnl:.2f}%")
    print(f"Today total fees: ${total_fees:.2f}")
    print(f"Today win rate: {len(win)}/{len(today_closes)} ({100*len(win)/len(today_closes):.0f}%)")

# ============================================================
# 1. derivLesson GAPS — positions skipped by the screener
# ============================================================
print("\n" + "─"*60)
print("📊 derivLesson GAPS — SKIPPED POSITIONS / MISSED OPPORTUNITIES")
print("─"*60)

# Look at lesson entries for patterns about what's being skipped
# Check if there are any lessons about skipping or gaps
gap_lessons = [l for l in lesson_entries if 'gap' in l.get('rule','').lower() or 'skip' in l.get('rule','').lower() or 'miss' in l.get('rule','').lower()]
if gap_lessons:
    for gl in gap_lessons:
        print(f"  ⚠️  {gl['rule'][:120]}")
else:
    print("  ✅ No explicit derivLesson gap markers found in lessons.json")

# Check pools that appear only once vs repeatedly — repeat pools = confidence signal
pool_deploy_count = Counter(p.get('pool_name','?') for p in positions)
print(f"\n  Pool deployment frequency:")
for name, cnt in pool_deploy_count.most_common():
    is_repeat = "🔁 REPEAT" if cnt > 1 else "   "
    print(f"  {is_repeat} {name}: {cnt}x")

# ============================================================
# 2. trailing_tp TIGHT CLOSES (under 3% PnL)
# ============================================================
print("\n" + "─"*60)
print("📊 TRAILING_TP TIGHT CLOSES — Under 3% final PnL")
print("─"*60)

tight_closes = [p for p in closed 
                if 'trailing_tp' in (p.get('close_reason','') or '') 
                and p.get('final_pnl_pct', 100) < 3]

today_tight = [p for p in today_closes 
               if 'trailing_tp' in (p.get('close_reason','') or '') 
               and p.get('final_pnl_pct', 100) < 3]

all_tp_low = [p for p in closed 
              if 'trailing_tp' in (p.get('close_reason','') or '') 
              and p.get('final_pnl_pct', 100) < 5]

print(f"  Total tight closes (<3%): {len(tight_closes)} / {len(closed)} all-time")
print(f"  Today tight closes (<3%): {len(today_tight)} / {len(today_closes)}")
print(f"  All trailing_tp closes <5%: {len(all_tp_low)}")

if today_tight:
    print(f"\n  ⚠️  Today's tight trailing_tp closes:")
    for p in today_tight:
        reason = p.get('close_reason','?')
        print(f"    • {p.get('pool_name','?')}: {p.get('final_pnl_pct',0):.1f}% | {reason[:60]}... | held {p.get('minutes_held',0)}min | fees=${p.get('fees_earned_usd',0):.2f}")
        # Check if peak was wiped
        if 'peak' in reason.lower() and 'drop' in reason.lower():
            try:
                parts = reason.split('->')
                peak_str = parts[0].split('peak')[-1].strip().replace('%','')
                drop_str = parts[1].split('(drop')[-1].strip().replace(')','').replace('%','')
                peak = float(peak_str)
                drop = float(drop_str)
                print(f"      peak={peak}% → drop={drop}pp → retention={(peak-drop)/peak*100:.0f}%")
            except:
                pass

# ============================================================
# 3. POOL REPEAT PERFORMANCE
# ============================================================
print("\n" + "─"*60)
print("📊 POOL REPEAT PERFORMANCE")
print("─"*60)

pool_positions = defaultdict(list)
for p in closed:
    pool_positions[p.get('pool_name','?')].append({
        'pnl': p.get('final_pnl_pct',0),
        'fees': p.get('fees_earned_usd',0),
        'reason': p.get('close_reason',''),
        'minutes': p.get('minutes_held',0),
        'closed_at': p.get('closed_at',''),
        'volatility': p.get('volatility', 0),
        'fee_tvl_ratio': p.get('fee_tvl_ratio', 0)
    })

repeat_pools = {k: v for k, v in pool_positions.items() if len(v) > 1}
print(f"  Pools deployed multiple times: {len(repeat_pools)}")

for pool_name, entries in sorted(repeat_pools.items()):
    pnls = [e['pnl'] for e in entries]
    fees = [e['fees'] for e in entries]
    reasons = [e['reason'][:40] for e in entries]
    vols = [e['volatility'] for e in entries]
    ftrs = [e['fee_tvl_ratio'] for e in entries]
    avg_pnl = sum(pnls)/len(pnls)
    print(f"\n  🔁 {pool_name} ({len(entries)}x)")
    print(f"     PnLs: {', '.join(f'{p:.1f}%' for p in pnls)} | avg: {avg_pnl:.1f}%")
    print(f"     Fees: ${sum(fees):.2f} total | ${sum(fees)/len(fees):.2f} avg")
    print(f"     Vol: {', '.join(f'{v:.1f}' for v in vols)}")
    print(f"     FeeTVL: {', '.join(f'{f:.2f}' for f in ftrs)}")
    print(f"     Reasons: {' | '.join(reasons)}")

# ============================================================
# 4. FEE YIELD TRENDS
# ============================================================
print("\n" + "─"*60)
print("📊 FEE YIELD TRENDS")
print("─"*60)

# Group by day
from collections import defaultdict
daily_stats = defaultdict(lambda: {'count':0, 'total_fees':0, 'total_pnl':0, 'total_held':0})

for p in closed:
    dt = p.get('closed_at','')[:10]  # YYYY-MM-DD
    daily_stats[dt]['count'] += 1
    daily_stats[dt]['total_fees'] += p.get('fees_earned_usd', 0)
    daily_stats[dt]['total_pnl'] += p.get('final_pnl_pct', 0)
    daily_stats[dt]['total_held'] += p.get('minutes_held', 0)

for day in sorted(daily_stats.keys()):
    d = daily_stats[day]
    avg_pnl = d['total_pnl']/d['count'] if d['count'] else 0
    avg_fee = d['total_fees']/d['count'] if d['count'] else 0
    avg_held = d['total_held']/d['count'] if d['count'] else 0
    marker = " ◀ TODAY" if day == today else ""
    print(f"  {day}: {d['count']} closes | avgPnL={avg_pnl:.1f}% | fees=${d['total_fees']:.2f} | avgHold={avg_held:.0f}min{marker}")

# Fee yield rate ($/hr per $1 initial)
print(f"\n  Fee yield rate (today closes):")
for p in today_closes:
    init_val = p.get('initial_value_usd', 12)
    hours_held = p.get('minutes_held', 60)/60
    fee_rate = p.get('fees_earned_usd', 0)/(init_val * hours_held)*100 if hours_held > 0 else 0
    pnl_rate = p.get('final_pnl_pct', 0)/hours_held if hours_held > 0 else 0
    print(f"    {p.get('pool_name','?'):15s}: fees=${p.get('fees_earned_usd',0):.2f} | {p.get('final_pnl_pct',0):.1f}% | {hours_held:.1f}h | feeYield={fee_rate:.3f}%/hr | pnlRate={pnl_rate:.1f}%/hr")

# ============================================================
# 5. SQLITE JOURNAL — Management Cycle & Event Patterns
# ============================================================
print("\n" + "─"*60)
print("🗄️  SQLITE JOURNAL — On-chain Pattern Cross-Reference")
print("─"*60)

if sq is not None:
    c = sq.cursor()

    # Event type counts
    c.execute("SELECT type, COUNT(*) as cnt FROM events GROUP BY type ORDER BY cnt DESC")
    evtypes = c.fetchall()
    print(f"  Journal events: {sum(r['cnt'] for r in evtypes)} total ({len(evtypes)} types)")
    for r in evtypes:
        print(f"    • {r['type']}: {r['cnt']}x")

    # Management cycle summary last 7 days
    c.execute("""
        SELECT date(ts) as day, COUNT(*) as cycles,
               SUM(CASE WHEN json_extract(data, '$.needsLLM') = 'true' THEN 1 ELSE 0 END) as llmCycles,
               ROUND(AVG(CAST(json_extract(data, '$.openPositions') AS REAL)), 1) as avgPositions,
               ROUND(AVG(CAST(json_extract(data, '$.totalValueUsd') AS REAL)), 2) as avgValue
        FROM events
        WHERE type = 'management_cycle' AND ts >= datetime('now', '-7 days')
        GROUP BY day ORDER BY day DESC
    """)
    mgmt_days = c.fetchall()
    if mgmt_days:
        print(f"\n  📋 Management cycles (last 7d):")
        for r in mgmt_days:
            print(f"    {r['day']}: {r['cycles']} cycles | {r['llmCycles']} LLM actions | avgPos={r['avgPositions']} | avgVal=${r['avgValue']:.2f}")

    # Today's events summary
    c.execute("""
        SELECT type, COUNT(*) as cnt FROM events
        WHERE date(ts) = date('now')
        GROUP BY type ORDER BY cnt DESC
    """)
    today_ev = c.fetchall()
    if today_ev:
        print(f"\n  📊 Today's events ({today}):")
        for r in today_ev:
            print(f"    • {r['type']}: {r['cnt']}x")

    # Position lifecycle health — any positions where close_reason had error
    c.execute("""
        SELECT ts, pool_name, json_extract(data, '$.reason') as reason
        FROM events
        WHERE type = 'position_close'
          AND (json_extract(data, '$.reason') LIKE '%error%' OR CAST(json_extract(data, '$.pnlPct') AS REAL) < -10)
        ORDER BY ts DESC LIMIT 5
    """)
    errors = c.fetchall()
    if errors:
        print(f"\n  ⚠️  Position close anomalies:")
        for r in errors:
            print(f"    • {r['pool_name']} at {r['ts'][:19]}: {r['reason']}")

    # Blacklist status
    bl_path = f'{BASE}/token-blacklist.json'
    if os.path.exists(bl_path):
        with open(bl_path) as f:
            blacklist = json.load(f)
        if blacklist:
            print(f"\n  🏴  Token blacklist: {len(blacklist)} entries")
            for mint, info in sorted(blacklist.items()):
                print(f"    • {info.get('symbol','?')} ({mint[:10]}...{mint[-6:]}): {info.get('reason','')[:60]}")
        else:
            print(f"\n  🏴  Token blacklist: empty (no tokens blacklisted)")

    # Fee earning efficiency from SQLite closes
    c.execute("""
        SELECT pool_name,
               ROUND(AVG(CAST(json_extract(data, '$.pnlPct') AS REAL)), 2) as avgPnl,
               ROUND(AVG(CAST(json_extract(data, '$.minutesHeld') AS REAL)), 0) as avgMin,
               COUNT(*) as cnt
        FROM events WHERE type = 'position_close'
        GROUP BY pool_name
        ORDER BY avgPnl ASC LIMIT 5
    """)
    bottoms = c.fetchall()
    if bottoms:
        print(f"\n  🐌  Worst avg PnL pools (from SQLite):")
        for r in bottoms:
            print(f"    • {r['pool_name']}: avgPnl={r['avgPnl']}% | avgHeld={r['avgMin']:.0f}m | closes={r['cnt']}")

    c.execute("""
        SELECT pool_name,
               ROUND(AVG(CAST(json_extract(data, '$.pnlPct') AS REAL)), 2) as avgPnl,
               COUNT(*) as cnt
        FROM events WHERE type = 'position_close'
        GROUP BY pool_name
        ORDER BY avgPnl DESC LIMIT 5
    """)
    tops = c.fetchall()
    if tops:
        print(f"\n  ⭐  Best avg PnL pools (from SQLite):")
        for r in tops:
            print(f"    • {r['pool_name']}: avgPnl={r['avgPnl']}% | closes={r['cnt']}")

else:
    print("  ⚠️  SQLite journal not available — events not tracked yet")
    print("     Active from commit 6d57b1e onwards")

sq and sq.close()

# ============================================================
# 6. NOTABLE PATTERNS SUMMARY
# ============================================================
print("\n" + "═"*60)
print("🧠 PATTERN ANALYSIS SUMMARY")
print("═"*60)

# Pattern: low organic_score performing badly
low_organic_fails = [p for p in closed if p.get('organic_score', 100) < 70 and p.get('final_pnl_pct', 10) < 3]
if low_organic_fails:
    print(f"\n  ⚠️  Low organic (<70) + low PnL (<3%): {len(low_organic_fails)} positions")
    for p in low_organic_fails:
        print(f"      • {p.get('pool_name','?')}: organic={p.get('organic_score',0)} PnL={p.get('final_pnl_pct',0):.1f}%")

# Pattern: high volatility >5
high_vol = [p for p in closed if p.get('volatility',0) > 5]
if high_vol:
    avg_hv_pnl = sum(p.get('final_pnl_pct',0) for p in high_vol)/len(high_vol)
    print(f"\n  ⚡ High volatility (>5) positions: {len(high_vol)} closes, avgPnL={avg_hv_pnl:.1f}%")
    for p in high_vol:
        print(f"      • {p.get('pool_name','?')}: vol={p.get('volatility',0):.2f} PnL={p.get('final_pnl_pct',0):.1f}% held={p.get('minutes_held',0)}min")

# Pattern: take_profit hits
tp_hits = [p for p in closed if 'take_profit' in (p.get('close_reason','') or '')]
if tp_hits:
    print(f"\n  🎯 Take-profit hits: {len(tp_hits)} total")
    for p in tp_hits:
        print(f"      • {p.get('pool_name','?')}: {p.get('final_pnl_pct',0):.1f}% | ${p.get('fees_earned_usd',0):.2f} fees | held {p.get('minutes_held',0)}min")

# Lessons count
print(f"\n  📚 Lessons on file: {len(lesson_entries)} entries")
print(f"  📚 Performance records: {len(performance)} entries")

# Last lesson timestamp
if lesson_entries:
    last_ts = max(l.get('created_at','') for l in lesson_entries)
    print(f"  📚 Last lesson added: {last_ts}")

# Config optimizer notes
config_opt_lessons = [l for l in lesson_entries if l.get('sourceType') == 'config_change']
if config_opt_lessons:
    last_opt = config_opt_lessons[-1]
    print(f"  🔧 Latest config-optimizer lesson: {last_opt.get('rule','')[:120]}")

print()
print("="*60)
print("END REPORT")
print("="*60)
