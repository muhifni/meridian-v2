import { log } from "../../logger.js";

const ALLOWED_USER_IDS = new Set(
  String(process.env.TELEGRAM_ALLOWED_USER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
);

const CHAT_ID = process.env.TELEGRAM_CHAT_ID || null;

/**
 * Owner-only middleware — silently drops updates from unauthorized users/chats.
 */
export function ownerOnly(ctx, next) {
  const chatId = String(ctx.chat?.id || "");
  const userId = String(ctx.from?.id || "");

  // Must match configured chat
  if (CHAT_ID && chatId !== CHAT_ID) return;

  // If allowed users configured, enforce
  if (ALLOWED_USER_IDS.size > 0 && !ALLOWED_USER_IDS.has(userId)) return;

  return next();
}
