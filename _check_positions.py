import json
from datetime import datetime, timezone

with open('virtual-positions.json') as f:
    data = json.load(f)

positions = data.get('positions', [])
total = len(positions)
closed = sum(1 for p in positions if p.get('closed'))
open_p = total - closed
print(f'Total positions: {total}')
print(f'Closed: {closed}')
print(f'Open: {open_p}')
print()

# Today's deployments and closes
today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
today_deployed = [p for p in positions if p.get('deployed_at','').startswith(today)]
print(f'Deployed today ({today}): {len(today_deployed)}')
for p in today_deployed:
    dur = ''
    if p.get('closed_at'):
        try:
            dep = datetime.fromisoformat(p['deployed_at'].replace('Z','+00:00'))
            clos = datetime.fromisoformat(p['closed_at'].replace('Z','+00:00'))
            mins = int((clos-dep).total_seconds()/60)
            dur = f', held {mins}min'
        except:
            pass
    print(f'  {p["pool_name"]} closed={p["closed"]} reason={p.get("close_reason","open")}{dur} fees=${p.get("fees_earned_usd",0)} pnl={p.get("final_pnl_pct",0)}%')

# Anomalies
print()
print('=== ANOMALIES ===')
for p in positions:
    if p.get('closed'):
        try:
            dep = datetime.fromisoformat(p['deployed_at'].replace('Z','+00:00'))
            clos = datetime.fromisoformat(p['closed_at'].replace('Z','+00:00'))
            mins = int((clos-dep).total_seconds()/60)
            if mins < 30:
                print(f'FAST CLOSE: {p["pool_name"]} {mins}min reason={p.get("close_reason","?")}')
            if mins > 180 and p.get('fees_earned_usd', 0) == 0:
                print(f'ZERO FEES >3H: {p["pool_name"]} {mins}min')
        except:
            pass

# Low yield rate for today's closes
print()
today_closes = [p for p in positions if p.get('closed') and p.get('closed_at','').startswith(today)]
low_yield_today = [p for p in today_closes if 'low_yield' in (p.get('close_reason') or '').lower()]
print(f'Today closes: {len(today_closes)}')
print(f'Low yield today: {len(low_yield_today)}')
if today_closes:
    lyr = len(low_yield_today)/len(today_closes)*100
    print(f'Low yield rate: {lyr:.0f}%')
print()
print("=== ALL TODAY'S CLOSE REASONS ===")
for p in today_closes:
    print(f'  {p["pool_name"]}: {p.get("close_reason","?")} (held {p.get("minutes_held","?")}min, fees=${p.get("fees_earned_usd",0)})')
