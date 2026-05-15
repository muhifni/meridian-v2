  // ── models ─────────────────────────────────────────────────────
  case "models": {
    const provider = flags.provider || "swiftrouter";
    const onlyToolCalling = argv.includes("--tool-calling") || argv.includes("--good-for-tools");

    if (provider === "swiftrouter") {
      const baseUrl = process.env.LLM_BASE_URL || "https://api.swiftrouter.com/v1";
      const apiKey = process.env.LLM_API_KEY;

      if (!apiKey) {
        die("LLM_API_KEY is required to list models from SwiftRouter. Set it in .env");
      }

      try {
        const res = await fetch(`${baseUrl}/models`, {
          headers: {
            "Authorization": `Bearer ${apiKey}`,
          },
        });

        if (!res.ok) {
          const text = await res.text();
          die(`Failed to fetch models from SwiftRouter: ${res.status} ${text}`);
        }

        const data = await res.json();
        let models = (data.data || []).map(m => ({
          id: m.id,
          owned_by: m.owned_by,
        }));

        // Filter for models good at tool calling
        if (onlyToolCalling) {
          const goodForTools = new Set([
            "claude-sonnet-4-6",
            "claude-opus-4-6",
            "claude-opus-4-7",
            "gemini-2.5-pro",
            "gemini-3.1-pro-preview",
            "deepseek-r1-0528",
            "deepseek-v3.1",
            "deepseek-v4-pro",
            "qwen3-235b-a22b",
            "qwen3-235b-a22b-thinking-2507",
          ]);

          models = models.filter(m => goodForTools.has(m.id));
        }

        out({
          provider: "swiftrouter",
          base_url: baseUrl,
          total: models.length,
          filtered_for_tool_calling: onlyToolCalling,
          models,
        });
      } catch (err) {
        die("Error fetching models: " + err.message);
      }
    } else {
      die(`Provider "${provider}" is not yet supported for 'meridian models'. Currently only 'swiftrouter' is supported.`);
    }
    break;
  }

  default:
    die(`Unknown command: ${subcommand}. Run 'meridian help' for usage.`);
}