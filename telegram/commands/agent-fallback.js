import { Composer } from "grammy";
import { log } from "../../logger.js";
import { sendMessage, createLiveMessage } from "../../telegram.js";

const agentFallback = new Composer();

// Bound from index.js
let _agentLoop = null;
let _sessionHistory = [];
let _getBusy = () => false;
let _setBusy = () => {};
let _config = null;
let _appendHistory = null;
let _stripThink = (s) => s;
let _refreshPrompt = () => {};
let _drainTelegramQueue = () => {};
let _telegramQueue = [];

export function bindAgentFallback({
  agentLoop,
  sessionHistory,
  getBusy,
  setBusy,
  config,
  appendHistory,
  stripThink,
  refreshPrompt,
  drainTelegramQueue,
  telegramQueue,
}) {
  _agentLoop = agentLoop;
  _sessionHistory = sessionHistory;
  _getBusy = getBusy;
  _setBusy = setBusy;
  _config = config;
  _appendHistory = appendHistory;
  _stripThink = stripThink;
  _refreshPrompt = refreshPrompt;
  _drainTelegramQueue = drainTelegramQueue;
  _telegramQueue = telegramQueue;
}

// Catch-all: any text message that wasn't handled by a command
agentFallback.on("message:text", async (ctx) => {
  const text = ctx.message.text?.trim();
  if (!text) return;

  // Queue if busy
  if (_getBusy()) {
    if (_telegramQueue.length < 5) {
      _telegramQueue.push({ text, chat: ctx.chat, from: ctx.from });
      await ctx.reply(`⏳ Queued (${_telegramQueue.length} in queue): "${text.slice(0, 60)}"`);
    } else {
      await ctx.reply("Queue is full (5 messages). Wait for the agent to finish.");
    }
    return;
  }

  if (!_agentLoop || !_config) {
    await ctx.reply("Agent not initialized yet.");
    return;
  }

  _setBusy(true);
  let liveMessage = null;
  try {
    log("telegram", `Incoming: ${text}`);
    const CMD_ALIAS = { "/sum": "/summary", "/sim": "/simulation" };
    const displayText = CMD_ALIAS[text.split(/\s/)[0]] ? text.replace(/^\S+/, (m) => CMD_ALIAS[m] || m) : text;
    const hasCloseIntent = /\bclose\b|\bsell\b|\bexit\b|\bwithdraw\b/i.test(text);
    const isDeployRequest = !hasCloseIntent && /\bdeploy\b|\bopen position\b|\blp into\b|\badd liquidity\b/i.test(text);
    const agentRole = isDeployRequest ? "SCREENER" : "GENERAL";
    const agentModel = agentRole === "SCREENER" ? _config.llm.screeningModel : _config.llm.generalModel;
    liveMessage = await createLiveMessage("🤖 Live Update", `Request: ${displayText.slice(0, 240)}`);
    const { content } = await _agentLoop(displayText, _config.llm.maxSteps, _sessionHistory, agentRole, agentModel, null, {
      interactive: true,
      onToolStart: async ({ name }) => { await liveMessage?.toolStart(name); },
      onToolFinish: async ({ name, result, success }) => { await liveMessage?.toolFinish(name, result, success); },
    });
    if (_appendHistory) _appendHistory(displayText, content);
    if (liveMessage) await liveMessage.finalize(_stripThink(content));
    else await sendMessage(_stripThink(content));
  } catch (e) {
    if (liveMessage) await liveMessage.fail(e.message).catch(() => {});
    else await ctx.reply(`Error: ${e.message}`);
  } finally {
    _setBusy(false);
    _refreshPrompt();
    _drainTelegramQueue();
  }
});

export default agentFallback;
