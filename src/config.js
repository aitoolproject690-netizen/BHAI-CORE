export function env(name, fallback = "") {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}
export function config() {
  return {
    port: Number(env("PORT", "8080")),
    host: env("HOST", "0.0.0.0"),
    apiKey: env("BHAI_CORE_API_KEY"),
    providerOrder: env("AI_PROVIDER_ORDER", "ollama,gemini,openai,anthropic,huggingface").split(",").map(s => s.trim().toLowerCase()).filter(Boolean),
    providers: {
      ollama: {
        key: env("OLLAMA_ENABLED", "false") === "true" ? "local" : "",
        model: env("OLLAMA_MODEL", "llama3.2"),
        url: env("OLLAMA_URL", "http://127.0.0.1:11434")
      },
      gemini: { key: env("GEMINI_API_KEY"), model: env("GEMINI_MODEL", "gemini-2.5-flash") },
      openai: { key: env("OPENAI_API_KEY"), model: env("OPENAI_MODEL", "gpt-4o-mini") },
      anthropic: { key: env("ANTHROPIC_API_KEY"), model: env("ANTHROPIC_MODEL", "claude-3-5-haiku-latest") },
      huggingface: { key: env("HF_TOKEN"), model: env("HF_MODEL", "HuggingFaceH4/zephyr-7b-beta") }
    }
  };
}
