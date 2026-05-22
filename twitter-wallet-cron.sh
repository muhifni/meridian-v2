#!/bin/bash
# twitter-wallet-cron.sh — Discover smart wallets from KOL tweets
# Runs every 6 hours via Hermes cron

set -e
cd /home/ubuntu/project/meridian
source ~/.bashrc 2>/dev/null

exec node --input-type=module -e '
import { discoverWalletsFromKolTweets } from "./twitter-wallet.js";
import { addSmartWallet, listSmartWallets } from "./smart-wallets.js";

const { wallets: existing } = listSmartWallets();
const existingAddrs = new Set(existing.map(w => w.address));

console.log("🔍 Twitter Wallet Discovery Cron");
console.log(`Existing wallets: ${existing.length}`);
console.log("");

const result = await discoverWalletsFromKolTweets({
  kolHandles: ["EvilPanda", "arip13741167", "4thinfected"],
  tweetsPerKol: 10
});

console.log(`\nAddresses found: ${result.addressesFound}`);
console.log(`Candidates: ${result.candidates.length}`);

let added = 0;
let skipped = 0;
for (const c of result.candidates) {
  const exists = existingAddrs.has(c.address) ||
    existing.some(w => w.address === c.address);
  if (exists) {
    skipped++;
    continue;
  }
  const res = addSmartWallet(c);
  if (res.success) {
    console.log(`  ✅ Added: ${c.name} (${c.address.slice(0, 8)}...) trend=${c.stats.cluster_trend}`);
    added++;
  } else {
    console.log(`  ❌ Failed: ${c.name} — ${res.error}`);
  }
}

console.log(`\n📊 Result: +${added} added, ${skipped} skipped, ${result.candidates.length - added - skipped} errors`);
if (added > 0) {
  const { wallets: final } = listSmartWallets();
  console.log(`Total wallets now: ${final.length}`);
} else {
  console.log("No new wallets discovered this cycle.");
}
'
