#!/bin/bash
# wallet-maintenance-cron.sh — Comprehensive smart wallet maintenance
# Runs every 6 hours via Hermes cron
#
# 1. Discover wallets from KOL tweets (twitter-cli)
# 2. Run wallet evolution (prune stale/underperforming wallets)
# 3. Report summary

set -e
cd /home/ubuntu/project/meridian
source ~/.bashrc 2>/dev/null

exec node --input-type=module -e '
import { discoverWalletsFromKolTweets } from "./twitter-wallet.js";
import { evolveSmartWallets } from "./wallet-evolution.js";
import { addSmartWallet, listSmartWallets } from "./smart-wallets.js";
import { log } from "./logger.js";

console.log("=== 🔄 Smart Wallet Maintenance ===");
console.log(`Started: ${new Date().toISOString()}`);
console.log("");

// ── Phase 1: Twitter KOL Discovery ──
console.log("📡 Phase 1: Twitter KOL Discovery");
console.log("----------------------------------");
const { wallets: beforeTwitter } = listSmartWallets();
const beforeCount = beforeTwitter.length;

const twitterResult = await discoverWalletsFromKolTweets({
  kolHandles: ["EvilPanda", "arip13741167", "4thinfected"],
  tweetsPerKol: 10
});

let added = 0;
for (const c of twitterResult.candidates) {
  const exists = beforeTwitter.some(w => w.address === c.address);
  if (exists) continue;
  const res = addSmartWallet(c);
  if (res.success) {
    console.log(`  ✅ ${c.name} (${c.address.slice(0, 8)}...) — ${c.stats.cluster_trend}`);
    added++;
  }
}
console.log(`📊 Twitter: ${twitterResult.addressesFound} address(es), +${added} wallet(s) added`);
console.log("");

// ── Phase 2: Wallet Evolution (prune + stat updates) ──
console.log("🧹 Phase 2: Wallet Evolution (prune + refresh)");
console.log("-----------------------------------------------");
const evoResult = await evolveSmartWallets([], []);
if (evoResult.removed.length) {
  console.log(`✅ Removed ${evoResult.removed.length} wallet(s):`);
  for (const name of evoResult.removed) {
    console.log(`  🗑️ ${name}`);
  }
} else {
  console.log("✅ No wallets needed pruning this cycle");
}
console.log("");

// ── Summary ──
const { wallets: final } = listSmartWallets();
const lpCount = final.filter(w => w.type === "lp" || !w.type).length;
const holderCount = final.filter(w => w.type === "holder" || w.type === "kol").length;
const manualCount = final.filter(w => w.source === "manual").length;

console.log("=== 📊 Wallet Summary ===");
console.log(`Total: ${final.length} (${lpCount} LP, ${holderCount} holder, ${manualCount} manual)`);
console.log("");

if (added > 0 || evoResult.removed.length > 0) {
  console.log("Changes this cycle:");
  if (added > 0) console.log(`  +${added} added from Twitter`);
  if (evoResult.removed.length > 0) console.log(`  -${evoResult.removed.length} pruned`);
  console.log("");

  console.log("Current wallets:");
  for (const w of final) {
    const s = w.stats || {};
    const pos = s.total_positions_observed ?? "N/A";
    const conf = (s.total_positions_observed ?? 0) >= 5 ? "high" :
                 (s.total_positions_observed ?? 0) >= 3 ? "med" : "low";
    console.log(`  ${w.type === "holder" ? "👁️" : "💰"} ${w.name} (${w.address.slice(0, 8)}...) — ${w.type} | ${pos} pos | ${conf} conf`);
  }
} else {
  console.log("No changes this cycle — all wallets stable.");
}
'
