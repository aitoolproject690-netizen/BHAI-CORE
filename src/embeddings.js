import crypto from "node:crypto";

const DEFAULT_DIMENSIONS = Number(process.env.BHAI_EMBEDDING_DIMENSIONS || 256);

function tokenize(text) {
  return String(text || "").toLowerCase().match(/[a-z0-9_]+/g) || [];
}
function hash32(value) {
  return crypto.createHash("sha256").update(value).digest().readUInt32BE(0);
}
function normalize(vector) {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum);
  if (!norm) return vector;
  return vector.map(value => value / norm);
}

export function embedText(text, options = {}) {
  const dimensions = Math.max(8, Number(options.dimensions || DEFAULT_DIMENSIONS));
  const tokens = tokenize(text);
  const vector = new Array(dimensions).fill(0);
  for (const token of tokens) {
    const h = hash32(token);
    vector[h % dimensions] += (h & 1) === 0 ? 1 : -1;
  }
  for (let i = 0; i < tokens.length - 1; i++) {
    const h = hash32(tokens[i] + ":" + tokens[i + 1]);
    vector[h % dimensions] += (h & 1) === 0 ? 0.5 : -0.5;
  }
  return normalize(vector);
}

export function embedMany(texts, options = {}) {
  return texts.map(text => embedText(text, options));
}

export function embeddingInfo() {
  const provider = String(process.env.BHAI_EMBEDDING_PROVIDER || "local-hash").toLowerCase();
  if (provider === "ollama") {
    return {
      provider: "ollama",
      semantic: true,
      model: process.env.BHAI_OLLAMA_EMBEDDING_MODEL || "nomic-embed-text",
      url: process.env.BHAI_OLLAMA_URL || "http://127.0.0.1:11434",
      replaceable: true
    };
  }
  return {
    provider: "local-hash",
    semantic: false,
    dimensions: Math.max(8, Number(DEFAULT_DIMENSIONS) || 256),
    replaceable: true,
    note: "Deterministic local baseline; not a neural semantic embedding model."
  };
}

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = Number(a[i]) || 0, y = Number(b[i]) || 0;
    dot += x * y; aa += x * x; bb += y * y;
  }
  if (!aa || !bb) return 0;
  return dot / (Math.sqrt(aa) * Math.sqrt(bb));
}

async function ollamaEmbed(text, options = {}) {
  const baseUrl = String(options.url || process.env.BHAI_OLLAMA_URL || "http://127.0.0.1:11434").replace(/\\/$/, "");
  const model = String(options.model || process.env.BHAI_OLLAMA_EMBEDDING_MODEL || "nomic-embed-text");
  const response = await fetch(baseUrl + "/api/embed", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, input: String(text ?? "") }),
    signal: AbortSignal.timeout(Number(options.timeoutMs || 30000))
  });
  if (!response.ok) {
    const error = new Error("Ollama embedding request failed");
    error.status = response.status;
    error.body = await response.text().catch(() => "");
    throw error;
  }
  const data = await response.json();
  const vector = data.embeddings?.[0];
  if (!Array.isArray(vector) || !vector.length) throw new Error("Ollama returned no embedding vector");
  return vector;
}

async function ollamaEmbedMany(texts, options = {}) {
  const vectors = [];
  for (const text of texts) vectors.push(await ollamaEmbed(text, options));
  return vectors;
}

export function createEmbeddingProvider(options = {}) {
  const provider = String(options.provider || process.env.BHAI_EMBEDDING_PROVIDER || "local-hash").toLowerCase();
  if (provider === "local-hash") {
    return {
      name: "local-hash",
      async embed(text) { return embedText(text, options); },
      async embedMany(texts) { return embedMany(texts, options); },
      info: embeddingInfo
    };
  }
  if (provider === "ollama") {
    const model = String(options.model || process.env.BHAI_OLLAMA_EMBEDDING_MODEL || "nomic-embed-text");
    return {
      name: "ollama",
      async embed(text) { return ollamaEmbed(text, options); },
      async embedMany(texts) { return ollamaEmbedMany(texts, options); },
      info: () => ({
        provider: "ollama",
        semantic: true,
        model,
        url: String(options.url || process.env.BHAI_OLLAMA_URL || "http://127.0.0.1:11434"),
        replaceable: true
      })
    };
  }
  throw new Error(`Unsupported embedding provider: ${provider}`);
}
