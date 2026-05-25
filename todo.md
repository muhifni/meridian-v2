# Virtual Wallet Tracking — Implementation Plan

## Files to modify:

1. **config.js** — add `dryRun` config section (slippagePct, gasFeePerDeploy, gasFeePerClose)
2. **user-config.json** — add `dryRun` config values
3. **dry-run-simulator.js** — 
   - `registerVirtualPosition()`: deduct deployAmount from virtualSolBalance, deduct gas
   - `_closeVirtualPosition()`: add back proceeds minus slippage + gas
   - Add helper to track/show virtual wallet balance
4. **state.json** — will auto-get `virtualSolBalance` field
5. **index.js** — update `/wallet` and `/sim` to show virtual wallet evolution
