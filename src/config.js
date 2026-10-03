export function env(name, fallback = "") {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}
function masterAuthConfig(username, password) {
  const configured = Boolean(username || password);
  if (!configured) return { enabled: false };
  if (!username || !password) {
    throw Object.assign(new Error("BHAI_CORE_USERNAME and BHAI_CORE_PASSWORD must both be configured"), {
      code: "CONFIG_MASTER_AUTH_INVALID",
      status: 500
    });
  }
  return { enabled: true };
}

export function config() {
  const port = Number(env("PORT", "8080"));
  const host = env("HOST", "0.0.0.0");
  if (!host.trim()) {
    throw Object.assign(new Error("Invalid HOST configuration"), { code: "CONFIG_HOST_INVALID", status: 500 });
  }
  const providerOrder = env("AI_PROVIDER_ORDER", "engine,ollama,gemini,openai,anthropic,huggingface").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const supportedProviders = new Set(["engine", "ollama", "gemini", "openai", "anthropic", "huggingface"]);
  if (!providerOrder.length || providerOrder.some(name => !supportedProviders.has(name))) {
    throw Object.assign(new Error("Invalid AI_PROVIDER_ORDER configuration"), { code: "CONFIG_PROVIDER_ORDER_INVALID", status: 500 });
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw Object.assign(new Error("Invalid PORT configuration"), { code: "CONFIG_PORT_INVALID", status: 500 });
  }
  return {
    port,
    host,
    apiKey: env("BHAI_CORE_API_KEY"),
    providerOrder,
    github: {
      token: env("GITHUB_TOKEN"),
      url: env("GITHUB_API_URL", "https://api.github.com")
    },
    masterAuth: {
      ...masterAuthConfig(env("BHAI_CORE_USERNAME"), env("BHAI_CORE_PASSWORD")),
      username: env("BHAI_CORE_USERNAME")
    },
    engine: {
      url: env("BHAI_ENGINE_URL"),
      key: env("BHAI_ENGINE_API_KEY"),
      model: env("BHAI_ENGINE_MODEL", "bhai-local")
    },
    providers: {
      ollama: {
        key: env("OLLAMA_ENABLED", "false") === "true" ? "local" : "",
        model: env("OLLAMA_MODEL", "llama3.2"),
        url: env("OLLAMA_URL", "http://127.0.0.1:11434")
      },
      gemini: { key: env("GEMINI_API_KEY"), model: env("GEMINI_MODEL", "gemini-3.8-flash") },
      openai: { key: env("OPENAI_API_KEY"), model: env("OPENAI_MODEL", "gpt-4o-mini") },
      anthropic: { key: env("ANTHROPIC_API_KEY"), model: env("ANTHROPIC_MODEL", "claude-3-5-haiku-latest") },
      huggingface: { key: env("HF_TOKEN"), model: env("HF_MODEL", "HuggingFaceH4/zephyr-7b-beta") }
    }
  };
}
