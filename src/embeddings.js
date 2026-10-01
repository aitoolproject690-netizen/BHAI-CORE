import crypto from "node:crypto";

const DEFAULT_DIMENSIONS = Number(process.env.BHAI_EMBEDDING_DIMENSIONS || 256);

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .match(/[a-z0-9_]+/g) || [];
}

function hash32(value) {
  const digest = crypto.createHash("sha256").update(value).digest();
  return digest.readUInt32BE(0);
}

function normalize(vector) {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum);
  if (!norm) return vector;
  return vector.map(value => value / norm);
}

/**
 * Dependency-free baseline embedder.
 *
 * This is intentionally NOT presented as an LLM-quality semantic embedding.
 * It provides a stable local vector contract so the vector store/API can be
 * built now and a real local/open-source embedding model can replace it later.
 */
export function embedText(text, options = {}) {
  const dimensions = Math.max(8, Number(options.dimensions || DEFAULT_DIMENSIONS));
  const tokens = tokenize(text);
  const vector = new Array(dimensions).fill(0);

  for (const token of tokens) {
    const h = hash32(token);
    const index = h % dimensions;
    const sign = (h & 1) === 0 ? 1 : -1;
    vector[index] += sign;
  }

  // Add deterministic bigram features to reduce collisions for short queries.
  for (let i = 0; i < tokens.length - 1; i++) {
    const bigram = tokens[i] + ":" + tokens[i + 1];
    const h = hash32(bigram);
    const index = h % dimensions;
    const sign = (h & 1) === 0 ? 0.5 : -0.5;
    vector[index] += sign;
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
    replaceable: true
  };
}

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = Number(a[i]) || 0;
    const y = Number(b[i]) || 0;
    dot += x * y;
    aa += x * x;
    bb += y * y;
  }
  if (!aa || !bb) return 0;
  return dot / (Math.sqrt(aa) * Math.sqrt(bb));
}
