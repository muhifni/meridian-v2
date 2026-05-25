import OpenAI from "openai";
import { jsonrepair } from "jsonrepair";
import { buildSystemPrompt } from "./prompt.js";
import { executeTool } from "./tools/executor.js";
import { tools } from "./tools/definitions.js";

const MANAGER_TOOLS  = new Set(["close_position", "claim_fees", "swap_token", "get_position_pnl", "get_my_positions", "get_wallet_balance"]);
const SCREENER_TOOLS = new Set(["deploy_position", "get_active_bin", "get_top_candidates", "check_smart_wallets_on_pool", "get_token_holders", "get_token_narrative", "get_token_info", "search_pools", "get_pool_memory", "get_wallet_balance", "get_my_positions"]);
const GENERAL_INTENT_ONLY_TOOLS = new Set([
  "self_update",
  "update_config",
  "add_to_blacklist",
  "remove_from_blacklist",
  "block_deployer",
  "unblock_deployer",
  "add_pool_note",
  "set_position_note",
  "add_smart_wallet",
  "remove_smart_wallet",
  "add_lesson",
  "pin_lesson",
  "unpin_lesson",
  "clear_lessons",
  "add_strategy",
  "remove_strategy",
  "set_active_strategy",
]);

// Intent → tool subsets for GENERAL role
const INTENT_TOOLS = {
  decisions:   new Set(["get_recent_decisions"]),
  deploy:      new Set(["deploy_position", "get_top_candidates", "get_active_bin", "get_pool_memory", "check_smart_wallets_on_pool", "get_token_holders", "get_token_narrative", "get_token_info", "search_pools", "get_wallet_balance", "get_my_positions", "add_pool_note"]),
  close:       new Set(["close_position", "get_my_positions", "get_position_pnl", "get_wallet_balance", "swap_token"]),
  claim:       new Set(["claim_fees", "get_my_positions", "get_position_pnl", "get_wallet_balance"]),
  swap:        new Set(["swap_token", "get_wallet_balance"]),
  config:      new Set(["update_config"]),
  blocklist:   new Set(["add_to_blacklist", "remove_from_blacklist", "list_blacklist", "block_deployer", "unblock_deployer", "list_blocked_deployers"]),
  selfupdate:  new Set(["self_update"]),
  balance:     new Set(["get_wallet_balance", "get_my_positions", "get_wallet_positions"]),
  positions:   new Set(["get_my_positions", "get_position_pnl", "get_wallet_balance", "set_position_note", "get_wallet_positions"]),
  strategy:    new Set(["list_strategies", "get_strategy", "add_strategy", "update_strategy", "delete_strategy", "remove_strategy", "set_active_strategy"]),
  screen:      new Set(["get_top_candidates", "get_token_holders", "get_token_narrative", "get_token_info", "search_pools", "check_smart_wallets_on_pool", "get_pool_detail", "get_my_positions", "discover_pools"]),
  memory:      new Set(["get_pool_memory", "add_pool_note", "list_blacklist", "add_to_blacklist", "remove_from_blacklist"]),
  smartwallet: new Set(["add_smart_wallet", "remove_smart_wallet", "list_smart_wallets", "check_smart_wallets_on_pool"]),
  study:       new Set(["study_top_lpers", "get_top_lpers", "get_pool_detail", "search_pools", "get_token_info", "discover_pools", "add_smart_wallet", "list_smart_wallets"]),
  performance: new Set(["get_performance_history", "get_my_positions", "get_position_pnl"]),
  lessons:     new Set(["add_lesson", "pin_lesson", "unpin_lesson", "list_lessons", "clear_lessons"]),
};

const INTENT_PATTERNS = [
  { intent: "decisions",   re: /\b(why did you|why'd you|why was (?:this|that|it)|what made you|what was the reason|why no deploy|why didn't you deploy|why did you close|why did you deploy|why did you skip)\b/i },
  { intent: "deploy",      re: /\b(deploy|open|add liquidity|lp into|invest in)\b/i },
  { intent: "close",       re: /\b(close|exit|withdraw|remove liquidity|shut down)\b/i },
  { intent: "claim",       re: /\b(claim|harvest|collect)\b.*\bfee/i },
  { intent: "swap",        re: /\b(swap|convert|sell|exchange)\b/i },
  { intent: "selfupdate",  re: /\b(self.?update|git pull|pull latest|update (the )?bot|update (the )?agent|update yourself)\b/i },
  { intent: "blocklist",   re: /\b(blacklist|block|unblock|blocklist|blocked deployer|rugger|block dev|block deployer)\b/i },
  { intent: "config",      re: /\b(config|setting|threshold|update|set |change)\b/i },
  { intent: "balance",     re: /\b(balance|wallet|sol|how much)\b/i },
  { intent: "positions",   re: /\b(position|portfolio|open|pnl|yield|range)\b/i },
  { intent: "strategy",    re: /\b(strategy|strategies)\b/i },
  { intent: "screen",      re: /\b(screen|candidate|find pool|search|research|token)\b/i },
  { intent: "memory",      re: /\b(memory|pool history|note|remember)\b/i },
  { intent: "smartwallet", re: /\b(smart wallet|kol|whale|watch.?list|add wallet|remove wallet|list wallet|tracked wallet|check pool|who.?s in|wallets in|add to (smart|watch|kol))\b/i },
  { intent: "study",       re: /\b(study top|top lpers?|best lpers?|who.?s lping|lp behavior|lpers?)\b/i },
  { intent: "performance", re: /\b(performance|history|how.?s the bot|how.?s it doing|stats|report)\b/i },
  { intent: "lessons",     re: /\b(lesson|learned|teach|pin|unpin|clear lesson|what did you learn)\b/i },
];

function getToolsForRole(agentType, goal = "") {
  if (agentType === "MANAGER")  return tools.filter(t => MANAGER_TOOLS.has(t.function.name));
  if (agentType === "SCREENER") return tools.filter(t => SCREENER_TOOLS.has(t.function.name));

  // GENERAL: match intent from goal, combine matched tool sets
  const matched = new Set();
  for (const { intent, re } of INTENT_PATTERNS) {
    if (re.test(goal)) {
      for (const t of INTENT_TOOLS[intent]) matched.add(t);
    }
  }

  // Fall back to all tools if no intent matched
  if (matched.size === 0) return tools.filter(t => !GENERAL_INTENT_ONLY_TOOLS.has(t.function.name));
  return tools.filter(t => matched.has(t.function.name));
}
import { getWalletBalances } from "./tools/wallet.js";
import { getMyPositions } from "./tools/dlmm.js";
import { log } from "./logger.js";
import { config } from "./config.js";
import { getStateSummary } from "./state.js";
import { getLessonsForPrompt, getPerformanceSummary } from "./lessons.js";
import { getDecisionSummary } from "./decision-log.js";

// Supports OpenRouter (default) or any OpenAI-compatible local server (e.g. LM Studio)
// To use LM Studio: set LLM_BASE_URL=http://localhost:1234/v1 and LLM_API_KEY=lm-studio in .env
// Raw response capture for reasoning_content recovery.
// 9router strips reasoning_content when it sees SDK headers (accept: application/json,
// x-stainless-*). We strip those headers so reasoning_content is preserved, then recover
// it from the raw response after the SDK parses (the SDK itself discards unknown fields).
let _lastRawJson = null;

const client = new OpenAI({
  baseURL: process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1",
  apiKey: process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY,
  timeout: 5 * 60 * 1000,
  maxRetries: 0, // Disable SDK internal retries — we handle 429/5xx ourselves
  fetch: async (url, init) => {
    // Strip headers that cause 9router to hide reasoning_content
    if (init.headers) {
      const filtered = {};
      for (const [k, v] of Object.entries(init.headers)) {
        if (k === "authorization" || k === "content-type" || k === "content-length") {
          filtered[k] = v;
        }
      }
      init.headers = filtered;
    }
    const response = await globalThis.fetch(url, init);
    const rawText = await response.text();
    // Parse raw response — handle both clean JSON and SSE-wrapped format
    let _needsClean = false;
    try {
      _lastRawJson = JSON.parse(rawText);
    } catch (_) {
      // 9router sometimes appends SSE suffix to JSON: "{...}data: [DONE]\n\n"
      // Or wraps entirely: "data: {...}data: [DONE]\n\n"
      _needsClean = true;
      let cleaned = rawText;
      if (cleaned.startsWith("data:")) {
        cleaned = cleaned.replace(/^data:\s*/, "");
      }
      cleaned = cleaned.replace(/\s*data:\s*\[DONE\]\s*$/, "").trim();
      try { _lastRawJson = JSON.parse(cleaned); } catch (_2) { _lastRawJson = null; }
    }
    // Return a fresh Response so the SDK can parse it cleanly
    // If raw wasn't valid JSON but we extracted it, return the clean version
    let responseBody = (_needsClean && _lastRawJson) ? JSON.stringify(_lastRawJson) : rawText;

    // 🧹 Strip reasoning_content and promote to content for SDK compatibility
    // Reasoning models (deepseek-v4-pro, etc.) return reasoning_content which
    // OpenAI SDK doesn't recognize → parse failure → agent can't see tool calls.
    // By merging reasoning_content into content and removing the unknown field,
    // the SDK sees a standard response and parses it successfully.
    if (_lastRawJson?.choices?.[0]?.message?.reasoning_content) {
      const msg = _lastRawJson.choices[0].message;
      if (!msg.content) {
        msg.content = msg.reasoning_content;
      }
      delete msg.reasoning_content;
      responseBody = JSON.stringify(_lastRawJson);
    }

    return new Response(responseBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  },
});

const DEFAULT_MODEL = process.env.LLM_MODEL || "openrouter/healer-alpha";

const MUTATING_TOOL_INTENTS = /\b(deploy|open position|add liquidity|lp into|invest in|close|exit|withdraw|remove liquidity|claim|harvest|collect|swap|convert|sell|exchange|block|unblock|blacklist|add smart wallet|remove smart wallet|add wallet|remove wallet|pin|unpin|clear lesson|add lesson|set active strategy|remove strategy|add strategy|set |change |update |self.?update|pull latest|git pull|update yourself)\b/i;
const LIVE_DATA_TOOL_INTENTS = /\b(balance|wallet|position|portfolio|pnl|yield|range|show positions|open positions|screen|candidate|find pool|search|research|analyze|check pool|token holders|narrative|study top|top lpers?|lp behavior|who.?s lping|performance|history|stats|report|list smart wallets|list blacklist|list blocked deployers|list lessons)\b/i;
const CONFIG_READ_ONLY_INTENTS = /\b(check|show|what(?:'s| is)?|review|inspect|see)\b.*\b(config|settings?|thresholds?)\b/i;
const DECISION_EXPLANATION_INTENTS = /\b(why did you|why'd you|why was (?:this|that|it)|what made you|what was the reason|why no deploy|why didn't you deploy|why did you close|why did you deploy|why did you skip)\b/i;

function shouldRequireRealToolUse(goal, agentType, interactive = false) {
  if (agentType === "MANAGER") return false;
  // SCREENER cron goals contain "deploy" in instructions but the LLM may
  // legitimately decide no candidate qualifies — don't block a "no deploy" answer.
  if (agentType === "SCREENER") return false;
  if (DECISION_EXPLANATION_INTENTS.test(goal)) return false;
  if (CONFIG_READ_ONLY_INTENTS.test(goal)) return false;
  if (MUTATING_TOOL_INTENTS.test(goal)) return true;
  return interactive && LIVE_DATA_TOOL_INTENTS.test(goal);
}

function buildMessages(systemPrompt, sessionHistory, goal, providerMode = "system") {
  if (providerMode === "user_embedded") {
    return [
      ...sessionHistory,
      {
        role: "user",
        content: `[SYSTEM INSTRUCTIONS]\n${systemPrompt}\n\n[USER REQUEST]\n${goal}`,
      },
    ];
  }

  return [
    { role: "system", content: systemPrompt },
    ...sessionHistory,
    { role: "user", content: goal },
  ];
}

function isSystemRoleError(error) {
  const message = String(error?.message || error?.error?.message || error || "");
  return /invalid message role:\s*system/i.test(message);
}

function isToolChoiceRequiredError(error) {
  const message = String(error?.message || error?.error?.message || error || "");
  return /tool_choice/i.test(message) || /tool_choice/i.test(error?.error?.message || "");
}

/**
 * Core ReAct agent loop.
 *
 * @param {string} goal - The task description for the agent
 * @param {number} maxSteps - Safety limit on iterations (default 20)
 * @returns {string} - The agent's final text response
 */
export async function agentLoop(goal, maxSteps = config.llm.maxSteps, sessionHistory = [], agentType = "GENERAL", model = null, maxOutputTokens = null, options = {}) {
  const { interactive = false, onToolStart = null, onToolFinish = null, signal = null } = options;
  // Build dynamic system prompt with current portfolio state
  const [portfolio, positions] = await Promise.all([getWalletBalances(), getMyPositions()]);
  const stateSummary = getStateSummary();
  const lessons = getLessonsForPrompt({ agentType });
  const perfSummary = getPerformanceSummary();
  const decisionSummary = getDecisionSummary();
  let weightsSummary = null;
  if (agentType === "SCREENER") {
    try {
      const { getWeightsSummary } = await import("./signal-weights.js");
      const { config } = await import("./config.js");
      if (config.darwin?.enabled) weightsSummary = getWeightsSummary();
    } catch { /* signal-weights not critical */ }
  }
  const systemPrompt = buildSystemPrompt(agentType, portfolio, positions, stateSummary, lessons, perfSummary, weightsSummary, decisionSummary);

  let providerMode = "system";
  let messages = buildMessages(systemPrompt, sessionHistory, goal, providerMode);

  // Track write tools fired this session — prevent the model from calling the same
  // destructive tool twice (e.g. deploy twice, swap twice after auto-swap)
  const ONCE_PER_SESSION = new Set(["deploy_position", "swap_token", "close_position"]);
  // These lock after first attempt regardless of success — retrying them is always wrong
  const NO_RETRY_TOOLS = new Set(["deploy_position"]);
  const firedOnce = new Set();
  const mustUseRealTool = shouldRequireRealToolUse(goal, agentType, interactive);
  let sawToolCall = false;
  let noToolRetryCount = 0;

  let emptyStreak = 0;
  for (let step = 0; step < maxSteps; step++) {
    // Check abort signal at the top of each step
    if (signal?.aborted) {
      log("agent", "Aborted by controller — exiting loop");
      return { content: "Agent loop aborted (timeout or shutdown).", userMessage: goal };
    }
    log("agent", `Step ${step + 1}/${maxSteps}`);

    try {
      const activeModel = model || DEFAULT_MODEL;

      // Retry up to 3 times on transient provider errors (502, 503, 529)
      const FALLBACK_MODEL = "deepseek-flash-combo";
      let response;
      let usedModel = activeModel;
      // Force a tool call on step 0 for action intents — prevents the model from inventing deploy/close outcomes.
      // SCREENER is excluded: it may legitimately decide no candidate qualifies and answer without a tool call.
      const ACTION_INTENTS = /\b(deploy|open|add liquidity|close|exit|withdraw|claim|swap|block|unblock)\b/i;
      let toolChoice = (step === 0 && agentType !== "SCREENER" && (ACTION_INTENTS.test(goal) || mustUseRealTool)) ? "required" : "auto";

      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          response = await client.chat.completions.create({
            model: usedModel,
            messages,
            tools: getToolsForRole(agentType, goal),
            tool_choice: toolChoice,
            temperature: config.llm.temperature,
            max_tokens: maxOutputTokens ?? config.llm.maxTokens,
          });
        } catch (error) {
          if (providerMode === "system" && isSystemRoleError(error)) {
            providerMode = "user_embedded";
            messages = buildMessages(systemPrompt, sessionHistory, goal, providerMode);
            log("agent", "Provider rejected system role — retrying with embedded system instructions");
            attempt -= 1;
            continue;
          }
          if (toolChoice === "required" && isToolChoiceRequiredError(error)) {
            toolChoice = "auto";
            log("agent", "Provider rejected tool_choice=required — retrying with tool_choice=auto");
            attempt -= 1;
            continue;
          }
          // Handle 429 rate limit with exponential backoff
          if (error.status === 429 || error?.error?.code === 429) {
            const backoff = Math.min(30000, (attempt + 1) * 10000); // 10s, 20s, 30s
            log("agent", `Rate limited (429), backing off ${backoff / 1000}s (attempt ${attempt + 1}/4)`);
            await new Promise((r) => setTimeout(r, backoff));
            continue;
          }
          throw error;
        }
        if (response.choices?.length) break;
        const errCode = response.error?.code || response.error?.status;
        if (errCode === 429) {
          const backoff = Math.min(30000, (attempt + 1) * 10000);
          log("agent", `Rate limited (429 in response), backing off ${backoff / 1000}s (attempt ${attempt + 1}/4)`);
          await new Promise((r) => setTimeout(r, backoff));
        } else if (errCode === 502 || errCode === 503 || errCode === 529) {
          const wait = (attempt + 1) * 5000;
          if (attempt === 1 && usedModel !== FALLBACK_MODEL) {
            usedModel = FALLBACK_MODEL;
            log("agent", `Switching to fallback model ${FALLBACK_MODEL}`);
          } else {
            log("agent", `Provider error ${errCode}, retrying in ${wait / 1000}s (attempt ${attempt + 1}/4)`);
            await new Promise((r) => setTimeout(r, wait));
          }
        } else {
          break;
        }
      }

      if (!response.choices?.length) {
        // SDK failed to parse but we have valid raw response — use it directly
        if (_lastRawJson?.choices?.length) {
          log("agent", `SDK parse failed but raw response has ${_lastRawJson.choices.length} choice(s) — using raw`);
          response = _lastRawJson;
        } else {
          log("error", `Bad API response: ${JSON.stringify(response).slice(0, 200)}`);
          throw new Error(`API returned no choices: ${response.error?.message || JSON.stringify(response)}`);
        }
      }
      // OpenAI SDK strips reasoning_content (not in its schema). 9router also strips
      // it when it detects SDK headers. We stripped SDK headers in our custom fetch so
      // the raw response should contain it. Recover here before the message object is used.
      if (_lastRawJson) {
        const rawMsg = _lastRawJson?.choices?.[0]?.message;
        if (rawMsg?.reasoning_content && !response.choices[0].message.reasoning_content) {
          response.choices[0].message.reasoning_content = rawMsg.reasoning_content;
        }
        _lastRawJson = null;
      }
      const msg = response.choices[0].message;

      // Handle SwiftRouter / reasoning models that return extra fields
      if (msg.reasoning_content) {
        log("agent", `Reasoning content received (${msg.reasoning_content.length} chars)`);
      }
      if (msg.content && msg.content.includes("<think>")) {
        msg.content = msg.content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      }

      // Some providers (e.g. SwiftRouter with Claude) return tool calls as XML
      // in the content instead of structured tool_calls. Parse and convert them.
      if (msg.content && !msg.tool_calls?.length && msg.content.includes("<tool_call>")) {
        const xmlCalls = _parseXmlToolCalls(msg.content);
        if (xmlCalls.length > 0) {
          msg.tool_calls = xmlCalls;
          // Strip the XML from content so it doesn't get sent to Telegram
          msg.content = msg.content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim() || null;
          log("agent", `Parsed ${xmlCalls.length} XML tool call(s) from content`);
        }
      }

      const invalidToolArgErrors = new Map();
      // Keep tool-call history API-valid, but never execute unrecoverable args.
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (tc.function?.arguments) {
            try {
              JSON.parse(tc.function.arguments);
            } catch {
              try {
                tc.function.arguments = JSON.stringify(JSON.parse(jsonrepair(tc.function.arguments)));
                log("warn", `Repaired malformed JSON args for ${tc.function.name}`);
              } catch {
                tc.function.arguments = "{}";
                const error = `Invalid tool arguments for ${tc.function.name}`;
                invalidToolArgErrors.set(tc.id, error);
                log("error", `${error}: could not repair JSON`);
              }
            }
          }
        }
      }
      messages.push(msg);

      // Some reasoning models consume all token budget on reasoning, leaving content
      // empty. Promote reasoning_content to content so the agent has something to
      // work with (the reasoning is usually high-quality analysis).
      if (!msg.content && msg.reasoning_content) {
        log("agent", `Content empty but reasoning present — promoting reasoning_content (${msg.reasoning_content.length} chars) to content`);
        msg.content = msg.reasoning_content;
      }

      // If the model didn't call any tools, it's done
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        // Hermes sometimes returns null content — pop the empty message and retry with backoff
        if (!msg.content) {
          messages.pop(); // remove the empty assistant message
          emptyStreak += 1;
          if (emptyStreak >= 3) {
            log("error", `Empty response streak (${emptyStreak}) — aborting to prevent infinite loop`);
            return {
              content: "The model returned empty responses repeatedly. This usually means the reasoning budget was exhausted. Try again later or switch to a different model.",
              userMessage: goal,
            };
          }
          // Back off progressively: 5s, 10s, 15s
          const backoff = emptyStreak * 5000;
          log("agent", `Empty response (streak ${emptyStreak}/3), retrying after ${backoff / 1000}s...`);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        emptyStreak = 0; // reset on successful content
        if (mustUseRealTool && !sawToolCall) {
          noToolRetryCount += 1;
          messages.pop();
          log("agent", `Rejected no-tool final answer (${noToolRetryCount}/1) for tool-required request`);
          if (noToolRetryCount >= 1) {
            return {
              content: "I couldn't complete that reliably because no tool call was made. Please retry after checking the logs.",
              userMessage: goal,
            };
          }
          messages.push({
            role: providerMode === "system" ? "system" : "user",
            content: providerMode === "system"
              ? "You have not used any tool yet. This request requires real tool execution or live tool-backed data. Do not answer from memory or inference. Call the appropriate tool first, then report only the real result."
              : "[SYSTEM REMINDER]\nYou have not used any tool yet. This request requires real tool execution or live tool-backed data. Do not answer from memory or inference. Call the appropriate tool first, then report only the real result.",
          });
          continue;
        }
        log("agent", "Final answer reached");
        log("agent", msg.content);
        return { content: msg.content, userMessage: goal };
      }
      sawToolCall = true;

      // Execute each tool call in parallel
      const toolResults = await Promise.all(msg.tool_calls.map(async (toolCall) => {
        const functionName = toolCall.function.name.replace(/<.*$/, "").trim();
        let functionArgs;

        if (invalidToolArgErrors.has(toolCall.id)) {
          const result = {
            success: false,
            error: invalidToolArgErrors.get(toolCall.id),
            blocked: true,
          };
          await onToolFinish?.({ name: functionName, args: {}, result, success: false, step });
          return {
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          };
        }

        try {
          functionArgs = JSON.parse(toolCall.function.arguments);
        } catch {
          try {
            functionArgs = JSON.parse(jsonrepair(toolCall.function.arguments));
            log("warn", `Repaired malformed JSON args for ${functionName}`);
          } catch (parseError) {
            log("error", `Failed to parse args for ${functionName}: ${parseError.message}`);
            const result = {
              success: false,
              error: `Invalid tool arguments for ${functionName}`,
              blocked: true,
            };
            await onToolFinish?.({ name: functionName, args: {}, result, success: false, step });
            return {
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify(result),
            };
          }
        }

        // Block once-per-session tools from firing a second time
        if (ONCE_PER_SESSION.has(functionName) && firedOnce.has(functionName)) {
          log("agent", `Blocked duplicate ${functionName} call — already executed this session`);
          await onToolFinish?.({
            name: functionName,
            args: functionArgs,
            result: { blocked: true, reason: `${functionName} already attempted this session — do not retry. If it failed, report the error and stop.` },
            success: false,
            step,
          });
          return {
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({ blocked: true, reason: `${functionName} already attempted this session — do not retry. If it failed, report the error and stop.` }),
          };
        }

        await onToolStart?.({ name: functionName, args: functionArgs, step });
        const result = await executeTool(functionName, functionArgs);
        await onToolFinish?.({
          name: functionName,
          args: functionArgs,
          result,
          success: result?.success !== false && !result?.error && !result?.blocked,
          step,
        });

        // Lock deploy_position after first attempt regardless of outcome — retrying is never right
        // For close/swap: only lock on success so genuine failures can be retried
        if (NO_RETRY_TOOLS.has(functionName)) firedOnce.add(functionName);
        else if (ONCE_PER_SESSION.has(functionName) && result.success === true) firedOnce.add(functionName);

        return {
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        };
      }));

      messages.push(...toolResults);
    } catch (error) {
      log("error", `Agent loop error at step ${step}: ${error.message}`);

      // If it's a rate limit, wait and retry
      if (error.status === 429) {
        log("agent", "Rate limited, waiting 30s...");
        await sleep(30000);
        continue;
      }

      // For other errors, break the loop
      throw error;
    }
  }

  log("agent", "Max steps reached without final answer");
  return { content: "Max steps reached. Review logs for partial progress.", userMessage: goal };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse XML-style tool calls that some providers (e.g. SwiftRouter/Claude) emit
 * in message content instead of structured tool_calls.
 *
 * Handles both formats:
 *   <tool_call><function=name><parameter=key>value</parameter>...</function></tool_call>
 *   <tool_call>{"name": "...", "arguments": {...}}</tool_call>
 */
function _parseXmlToolCalls(content) {
  const calls = [];
  const toolCallRegex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
  let match;

  while ((match = toolCallRegex.exec(content)) !== null) {
    const inner = match[1].trim();

    // Format 1: JSON inside tool_call
    if (inner.startsWith("{")) {
      try {
        const parsed = JSON.parse(inner);
        const name = parsed.name || parsed.function;
        const args = parsed.arguments || parsed.parameters || {};
        if (name) {
          calls.push({
            id: `xml_${Date.now()}_${calls.length}`,
            type: "function",
            function: { name, arguments: JSON.stringify(args) },
          });
        }
      } catch { /* malformed JSON, skip */ }
      continue;
    }

    // Format 2: <function=name><parameter=key>value</parameter>...</function>
    const funcMatch = inner.match(/<function=([^>]+)>([\s\S]*?)(?:<\/function>|$)/);
    if (!funcMatch) continue;

    const funcName = funcMatch[1].trim();
    const paramContent = funcMatch[2];
    const args = {};

    // Extract closed <parameter=key>value</parameter>
    const paramRegex = /<parameter=([^>]+)>([\s\S]*?)<\/parameter>/g;
    let paramMatch;
    while ((paramMatch = paramRegex.exec(paramContent)) !== null) {
      const key = paramMatch[1].trim();
      const val = paramMatch[2].trim();
      if (val === "true") args[key] = true;
      else if (val === "false") args[key] = false;
      else if (val !== "" && !isNaN(Number(val))) args[key] = Number(val);
      else args[key] = val;
    }

    if (funcName) {
      calls.push({
        id: `xml_${Date.now()}_${calls.length}`,
        type: "function",
        function: { name: funcName, arguments: JSON.stringify(args) },
      });
    }
  }

  return calls;
}
