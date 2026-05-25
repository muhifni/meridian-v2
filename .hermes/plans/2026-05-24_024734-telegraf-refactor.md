# Refactor Plan: Migrate Meridian Telegram to Telegraf

## Goal
Refactor Meridian's Telegram layer dari custom polling + monolithic `index.js` (2200+ lines) ke Telegraf framework. Hasilnya: modular, maintainable, extensible — tanpa mengubah core logic (agent, screening, management, lessons).

## Current State
- `telegram.js` (494 lines) — low-level wrapper: sendMessage, editMessage, polling loop, notification helpers
- `index.js` (2247 lines) — EVERYTHING else: command routing (20+ commands), callback query dispatch (30+ inline buttons), cron orchestration, screening/management cycles, menu system, settings UI
- Polling: custom `getUpdates` loop di `telegram.js:363-421`
- Auth: manual `isAuthorizedIncomingMessage()` check
- Command routing: giant if/else chain (~400 lines)
- Callback routing: regex matching di satu function (~200 lines)
- No session, no middleware, no scene
- `setMyCommands` not called — command popup requires BotFather manual setup

## Target Architecture
```
telegram/
  bot.js              — Telegraf instance, middleware stack, launch
  middleware/
    auth.js           — owner-only guard (replaces isAuthorizedIncomingMessage)
    logging.js        — log all incoming updates
    error.js          — global error handler
  commands/
    help.js           — /help, /menu
    positions.js      — /positions, /close, /closeall, /pool, /set
    config.js         — /config, /settings, /setcfg + callback actions (cfg:set:*)
    screening.js      — /screen, /candidates, /deploy
    health.js         — /health
    wallet.js         — /wallet, /status
    briefing.js       — /briefing, /analysis, /sim
    hive.js           — /hive, /hive pull
    control.js        — /pause, /resume, /stop
  scenes/
    deploy-wizard.js  — guided multi-step deploy (future)
  keyboards/
    main-menu.js      — inline keyboard builders
    settings.js       — settings keyboard + callback handlers
    risk.js           — risk settings keyboard
  notifications.js    — notifyDeploy, notifyClose, notifySwap, notifyOOR (keep as-is)
  live-message.js     — createLiveMessage (keep as-is, adapt to ctx)

index.js              — slim: import bot, import cron, wire together, launch
```

## Migration Strategy: Incremental (5 Phases)

### Phase 1 — Install + Bot Instance (30 min)
**Goal:** Telegraf running alongside existing code, zero behavior change.

Steps:
1. `npm install telegraf`
2. Create `telegram/bot.js`:
   - Instantiate `new Telegraf(process.env.TELEGRAM_BOT_TOKEN)`
   - Call `bot.telegram.setMyCommands([...])` on startup
   - Export bot instance
3. Wire `bot.launch()` in `index.js` (replace `startPolling()`)
4. Verify: bot responds to `/help`

Files changed: `package.json`, new `telegram/bot.js`, `index.js` (swap polling start)

### Phase 2 — Middleware + Auth (30 min)
**Goal:** Auth, logging, error handling via middleware.

Steps:
1. Create `telegram/middleware/auth.js`:
   ```js
   export const ownerOnly = (ctx, next) => {
     const userId = String(ctx.from?.id || '');
     if (!ALLOWED_USER_IDS.has(userId)) return;
     return next();
   };
   ```
2. Create `telegram/middleware/logging.js`:
   ```js
   export const logUpdates = (ctx, next) => {
     log("telegram", `${ctx.updateType}: ${ctx.message?.text || ctx.callbackQuery?.data || ''}`);
     return next();
   };
   ```
3. Create `telegram/middleware/error.js`:
   ```js
   bot.catch((err, ctx) => {
     log("telegram_error", `${ctx.updateType} error: ${err.message}`);
   });
   ```
4. Register: `bot.use(ownerOnly)`, `bot.use(logUpdates)`

Files changed: new `telegram/middleware/*.js`, `telegram/bot.js`

### Phase 3 — Command Handlers (2-3 hours)
**Goal:** Extract all commands from `index.js` if/else chain into modular handlers.

Steps per command group:
1. Create handler file (e.g., `telegram/commands/positions.js`)
2. Export a `Composer` that registers commands:
   ```js
   import { Composer } from 'telegraf';
   const positions = new Composer();
   positions.command('positions', async (ctx) => { ... });
   positions.command('close', async (ctx) => { ... });
   export default positions;
   ```
3. Import and `bot.use(positions)` in `bot.js`
4. Remove corresponding if/else from `index.js`
5. Test each command after migration

Priority order (by complexity):
1. `/help` — trivial, good first test
2. `/health` — self-contained, no dependencies
3. `/wallet`, `/status` — simple data fetch
4. `/positions`, `/close`, `/closeall`, `/pool`, `/set` — position management group
5. `/config`, `/settings`, `/setcfg` — config group + callback queries
6. `/screen`, `/candidates`, `/deploy` — screening group
7. `/briefing`, `/analysis`, `/sim` — reporting group
8. `/hive` — hivemind group
9. `/pause`, `/resume`, `/stop` — control group
10. `/menu` — inline keyboard (depends on all above)

Files changed: new `telegram/commands/*.js`, `index.js` (shrinks progressively)

### Phase 4 — Callback Query Routing (1-2 hours)
**Goal:** Replace monolithic callback dispatch with `bot.action()` pattern matching.

Steps:
1. Create `telegram/keyboards/settings.js`:
   ```js
   import { Composer } from 'telegraf';
   const settings = new Composer();
   settings.action(/^cfg:set:(.+):(.+)$/, async (ctx) => {
     const [key, value] = ctx.match.slice(1);
     // update config...
     await ctx.answerCbQuery(`${key} → ${value}`);
   });
   export default settings;
   ```
2. Migrate all `cfg:*` callbacks
3. Migrate `menu:*` callbacks
4. Migrate `deploy:*` callbacks
5. Remove `processCallbackQuery()` from `index.js`

Files changed: new `telegram/keyboards/*.js`, `index.js` (remove callback dispatch)

### Phase 5 — Cleanup + Session + setMyCommands (1 hour)
**Goal:** Final polish, session setup, auto-register commands.

Steps:
1. Add session middleware (in-memory or file-based):
   ```js
   import { session } from 'telegraf';
   bot.use(session());
   ```
2. Replace module-level `_latestCandidates` with `ctx.session.candidates`
3. `setMyCommands()` on boot — auto-sync command popup
4. Remove old `telegram.js` polling code (keep notification helpers)
5. Remove dead code from `index.js`
6. Final `index.js` should be ~200-300 lines: imports, cron setup, bot launch

Files changed: `telegram/bot.js`, delete old polling from `telegram.js`, `index.js` (final slim)

## Files Likely to Change
| File | Action |
|------|--------|
| `package.json` | Add `telegraf` dependency |
| `telegram/bot.js` | NEW — Telegraf instance + middleware + launch |
| `telegram/middleware/*.js` | NEW — auth, logging, error |
| `telegram/commands/*.js` | NEW — 10 command handler modules |
| `telegram/keyboards/*.js` | NEW — callback query handlers |
| `telegram/notifications.js` | MOVE — from `telegram.js`, adapt to use bot instance |
| `telegram/live-message.js` | MOVE — from `telegram.js`, adapt to use bot instance |
| `telegram.js` | DELETE (after full migration) |
| `index.js` | SHRINK from 2247 → ~200-300 lines |

## What Does NOT Change
- `agent.js` — ReAct loop untouched
- `config.js` — config system untouched
- `prompt.js` — prompt building untouched
- `lessons.js` — learning engine untouched
- `tools/*.js` — all tool implementations untouched
- `state.js` — position tracking untouched
- Cron orchestration logic — stays in `index.js` (just cleaner)
- `.env` — same env vars (TELEGRAM_BOT_TOKEN, etc.)

## Testing / Validation
- After each phase: test affected commands via Telegram
- Phase 1: `/help` responds
- Phase 2: unauthorized user gets no response
- Phase 3: each command group tested individually
- Phase 4: inline buttons work (settings, menu, deploy)
- Phase 5: command popup auto-appears, session persists candidates

## Risks & Tradeoffs
1. **Telegraf maintenance risk** — library activity declining since 2025. Mitigation: Telegraf v4 is stable, Bot API coverage sufficient. If abandoned, grammY is drop-in compatible (same middleware pattern).
2. **Breaking existing behavior** — incremental migration reduces risk. Each phase is independently testable. Rollback = revert git commit.
3. **Session state on restart** — in-memory session lost on PM2 restart. Mitigation: use file-based session or keep critical state in existing JSON files (state.json, etc.).
4. **Live message system** — `createLiveMessage()` is tightly coupled to current `sendMessage/editMessage`. Needs adapter to work with Telegraf's `ctx.reply/ctx.editMessageText`.
5. **Cron-triggered messages** — cron cycles send notifications without a `ctx` (no incoming update). Need to keep `bot.telegram.sendMessage(chatId, ...)` for push notifications.

## Open Questions
1. **grammY instead?** — Same architecture as Telegraf but actively maintained (2025-2026). API almost identical. Could swap Telegraf → grammY with minimal code change. Worth considering before starting.
2. **Webhook vs polling?** — Telegraf supports both. Stay polling for now (simpler, no HTTPS cert needed). Switch to webhook later if latency matters.
3. **Timeline priority** — This is a refactor, not a feature. Should it happen before or after Meridian Live deployment? Recommendation: after live is stable, before adding new complex features.

## Estimated Effort
- Phase 1: 30 min
- Phase 2: 30 min
- Phase 3: 2-3 hours (bulk of work)
- Phase 4: 1-2 hours
- Phase 5: 1 hour
- **Total: ~5-7 hours** (spread across multiple sessions)

## Alternative: grammY (Recommended Consideration)
If maintenance concern is a blocker, grammY (`grammy.dev`) is the spiritual successor:
- Same middleware pattern as Telegraf
- Actively maintained (weekly commits, 2026)
- TypeScript-first, Deno + Node
- Plugin ecosystem (session, conversations, menu, rate limiter)
- Migration from Telegraf is near-trivial (API 90% compatible)
- Would change Phase 1 only: `npm install grammy` instead of `telegraf`
