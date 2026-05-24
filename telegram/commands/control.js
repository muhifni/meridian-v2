import { Composer } from "grammy";

const control = new Composer();

// These need access to cron state from index.js.
// We expose hooks that index.js will bind after import.
let _stopCronJobs = null;
let _startCronJobs = null;
let _getCronStarted = null;
let _setCronStarted = null;
let _timers = null;

export function bindCronControls({ stopCronJobs, startCronJobs, getCronStarted, setCronStarted, timers }) {
  _stopCronJobs = stopCronJobs;
  _startCronJobs = startCronJobs;
  _getCronStarted = getCronStarted;
  _setCronStarted = setCronStarted;
  _timers = timers;
}

// /pause
control.command("pause", async (ctx) => {
  if (_stopCronJobs) _stopCronJobs();
  if (_setCronStarted) _setCronStarted(false);
  await ctx.reply("⏸ Paused autonomous cycles. Telegram control still works. Use /resume to start again.");
});

// /resume
control.command("resume", async (ctx) => {
  if (_getCronStarted && !_getCronStarted()) {
    if (_setCronStarted) _setCronStarted(true);
    if (_timers) {
      _timers.managementLastRun = Date.now();
      _timers.screeningLastRun = Date.now();
    }
    if (_startCronJobs) _startCronJobs();
    await ctx.reply("▶️ Autonomous cycles resumed.");
  } else {
    await ctx.reply("Autonomous cycles are already running.");
  }
});

export default control;
