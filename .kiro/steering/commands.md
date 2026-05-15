---
inclusion: manual
---

# Meridian — Quick Commands

Reference for common tasks. Run commands sequentially, never in background.

---

## balance — Check wallet state

```bash
node cli.js balance
```

Summarise: wallet address, SOL balance, USD value, and any token holdings.

---

## candidates — Fetch and analyse top pool candidates

```bash
node cli.js candidates --limit 5
onchainos signal list --chain solana --wallet-type 1
onchainos token trending --chains solana
```

Cross-reference: if a candidate token appears in OKX smart money signals with low `soldRatioPercent` (<20%), that's a strong conviction signal. If smart money has already sold (`soldRatioPercent` >80%), skip it.

Analyse each candidate and give a deploy recommendation (yes/no) with reasoning. Consider:
- fee/TVL ratio (higher is better, aim for >0.1)
- organic score (min 60, prefer 70+)
- bot % (reject if >30%)
- top10 holder concentration (reject if >60%)
- price trend (prefer stable or uptrending)
- smart money conviction (OKX signal soldRatioPercent)
- narrative strength

---

## manage — Full management cycle

1. Check all positions:
```bash
node cli.js positions
```

2. For each position, get PnL:
```bash
node cli.js pnl <position_address>
```

3. Note the `strategy` field. Apply strategy-specific rules:

**`custom_ratio_spot`:** OOR upside + PnL > 10% → close immediately | OOR downside > 10 min, no volume → close | fees > $5 → claim | total return >= 10% → close

**`fee_compounding`:** fees > $5 AND in range → claim then add-liquidity back | OOR → close normally

**`single_sided_reseed`:** OOR downside + volume still present → withdraw-liquidity then add-liquidity token-only at new price | OOR + no volume → close normally

**`partial_harvest`:** total return >= 10% → withdraw-liquidity(bps=5000), swap harvested tokens to SOL, let remaining 50% run | OOR → close normally

**`multi_layer`:** manage each sub-position independently using custom_ratio_spot rules

4. **Instruction override (highest priority):** If `instruction` is set (e.g. "close at 5% profit"), check it first and execute if condition is met.

**Global close rules (override strategy defaults):**
- OOR upside + PnL > 10% → close IMMEDIATELY regardless of strategy
- PnL < -25% with no volume recovery → close
- Position age > 2h and OOR downside with no recovery → close

---

## pool-compare — Compare pools for a token pair

```bash
curl -s "https://dlmm.datapi.meteora.ag/pools/groups?query=<TOKEN>&sort_by=fee_tvl_ratio&page_size=10"
curl -s "https://dlmm.datapi.meteora.ag/stats/protocol_metrics"
```

For each pool show: bin_step, trade_volume_24h, fees_24h, fee_tvl_ratio, farm_apr, current TVL. Pick the pool with the best fee_tvl_ratio at a bin_step appropriate for the pair's volatility.

---

## pool-ohlcv — Price and volume history for a pool

```bash
curl -s "https://dlmm.datapi.meteora.ag/pools/<POOL_ADDRESS>/ohlcv?timeframe=1h"
curl -s "https://dlmm.datapi.meteora.ag/pools/<POOL_ADDRESS>/volume/history?timeframe=1h"
```

Summarise: overall price trend, volume trend, whether volume is consistent or bursty, and whether now is a good entry (rising volume + stable/rising price = good; falling volume = avoid).

---

## positions — Check all open positions

```bash
node cli.js positions
```

For each position show: pair, in-range status, age, and whether action is needed (claim fees, close if OOR, etc).

---

## screen — Full screening cycle

**Step 0 — Check discord signal queue:**
```bash
node cli.js discord-signals
```
If any signals show `status: "pending"`: use the newest as priority candidate, skip Step 3, go directly to deep research. If `token_age_minutes <= 30`, favor 2-sided Spot strategy. If signal fails deep research, blacklist the mint.

**Step 1 — Read config:**
```bash
cat user-config.json
```
Note `deployAmountSol`, `gasReserve`, `maxPositions`. Minimum wallet needed = deployAmountSol + gasReserve.

**Step 2 — Wallet + memory:**
```bash
node cli.js balance
node cli.js lessons
node cli.js blacklist list
```
If SOL < (deployAmountSol + gasReserve): stop — insufficient funds.

**Step 3 — Fetch candidates:**
```bash
node cli.js candidates --limit 5
```

**Step 4 — OKX smart money signals:**
```bash
onchainos signal list --chain solana --wallet-type 1
```

**Step 5 — Deep research on top 2 candidates** (by fee_active_tvl_ratio):
```bash
node cli.js token-info --query <mint>
node cli.js token-holders --mint <mint>
node cli.js token-narrative --mint <mint>
node cli.js pool-detail --pool <pool_address>
node cli.js active-bin --pool <pool_address>
node cli.js study --pool <pool_address>
node cli.js pool-memory --pool <pool_address>
```

**Step 6 — Analyse and decide:**
- Hard reject: bot% > 30%, top10 > 60%, organic < 60, fee/TVL < 0.2
- Score by: smart money signal > fee_active_tvl_ratio > organic_score > top LPer win rate > low bundlers_pct
- If pool-memory shows poor range efficiency or repeated OOR closes → penalise heavily
- If top LPers have <50% win rate → reduce confidence

Deploy if a clear winner exists:
```bash
node cli.js deploy --pool <pool_address> --amount <sol_amount> --bins-below <N> --strategy bid_ask
```

Always explain full reasoning before executing any deploy.

---

## study-pool — Study top LPers on a pool

```bash
node cli.js study --pool <POOL_ADDRESS>
```

Extract: average hold time, win rate of top performers, dominant strategy (bid_ask vs spot), whether to scalp or hold, deploy recommendation based on LPer behaviour.
