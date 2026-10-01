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
  throw new Error(`Unsupported embedding provider: ${provider}`);
}
