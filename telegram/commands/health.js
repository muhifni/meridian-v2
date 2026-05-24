import { Composer } from "grammy";
import { config } from "../../config.js";

const health = new Composer();

health.command("health", async (ctx) => {
  await ctx.reply("🔍 Running health checks...");
  const checks = [
    { name: "RPC Primary", fn: async () => { const { Connection } = await import("@solana/web3.js"); const conn = new Connection(process.env.RPC_URL); const slot = await conn.getSlot(); return `slot ${slot}`; }},
    { name: "RPC Fallback", fn: async () => { if (!process.env.RPC_URL_FALLBACK) return "not configured"; const { Connection } = await import("@solana/web3.js"); const conn = new Connection(process.env.RPC_URL_FALLBACK); const slot = await conn.getSlot(); return `slot ${slot}`; }},
    { name: "Helius REST", fn: async () => { const k = process.env.HELIUS_API_KEY; if (!k) return "no API key"; const r = await fetch(`https://api.helius.xyz/v1/wallet/${config.wallet || "11111111111111111111111111111111"}/balances?api-key=${k}`, { signal: AbortSignal.timeout(8000) }); return `HTTP ${r.status}`; }},
    { name: "LLM Provider", fn: async () => { const url = process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1"; const r = await fetch(`${url}/models`, { headers: { Authorization: `Bearer ${process.env.LLM_API_KEY}` }, signal: AbortSignal.timeout(10000) }); return `HTTP ${r.status}`; }},
    { name: "Meteora DataPI", fn: async () => { const r = await fetch("https://dlmm.datapi.meteora.ag/pools?limit=1", { signal: AbortSignal.timeout(8000) }); return `HTTP ${r.status}`; }},
    { name: "Meteora Pool Discovery", fn: async () => { const r = await fetch("https://pool-discovery-api.datapi.meteora.ag/trending?limit=1", { signal: AbortSignal.timeout(8000) }); return `HTTP ${r.status}`; }},
    { name: "Jupiter Price", fn: async () => { const r = await fetch("https://api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112", { signal: AbortSignal.timeout(8000) }); return `HTTP ${r.status}`; }},
    { name: "Jupiter DataPI", fn: async () => { const r = await fetch("https://datapi.jup.ag/v1/assets/search?query=SOL", { signal: AbortSignal.timeout(8000) }); return `HTTP ${r.status}`; }},
    { name: "OKX Web3", fn: async () => { const r = await fetch("https://web3.okx.com/api/v5/dex/aggregator/supported/chain", { signal: AbortSignal.timeout(8000) }); return `HTTP ${r.status}`; }},
    { name: "HiveMind", fn: async () => { const r = await fetch(`${config.hiveMind?.url || "https://api.agentmeridian.xyz"}/health`, { signal: AbortSignal.timeout(8000) }); return `HTTP ${r.status}`; }},
  ];
  const results = await Promise.all(checks.map(async ({ name, fn }) => {
    const start = Date.now();
    try {
      const detail = await fn();
      const ms = Date.now() - start;
      return `✅ ${name}: ${detail} (${ms}ms)`;
    } catch (e) {
      const ms = Date.now() - start;
      return `❌ ${name}: ${e.message?.slice(0, 60) || "failed"} (${ms}ms)`;
    }
  }));
  await ctx.reply(`🏥 Health Check\n\n${results.join("\n")}`);
});

export default health;
