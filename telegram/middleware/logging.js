import { log } from "../../logger.js";

/**
 * Log all incoming updates — commands, callback queries, text messages.
 */
export function logUpdates(ctx, next) {
  const text = ctx.message?.text || ctx.callbackQuery?.data || "";
  if (text) {
    log("telegram", `Incoming: ${text}`);
  }
  return next();
}
