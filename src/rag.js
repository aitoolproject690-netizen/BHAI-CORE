import crypto from "node:crypto";
import { getStore, updateStore } from "./store.js";
import { createEmbeddingProvider, embeddingInfo } from "./embeddings.js";
import { rankVectors, stripVectors } from "./vectorStore.js";

const DEFAULT_CHUNK_SIZE = Number(process.env.BHAI_CHUNK_SIZE || 1200);
const DEFAULT_OVERLAP = Number(process.env.BHAI_CHUNK_OVERLAP || 150);

function tokenize(text) {
  return String(text || "").toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
}
function makeId() { return "chunk_" + crypto.randomUUID(); }

export function chunkText(text, options = {}) {
  const size = Math.max(1, Number(options.size || DEFAULT_CHUNK_SIZE));
  const overlap = Math.min(Math.max(0, Number(options.overlap ?? DEFAULT_OVERLAP)), size - 1);
  const value = String(text || "");
  const chunks = [];
  for (let start = 0; start < value.length;) {
    const end = Math.min(value.length, start + size);
    const content = value.slice(start, end).trim();
    if (content) chunks.push({ content, start, end });
    if (end >= value.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

const embeddingProvider = createEmbeddingProvider();

function embeddingVersion() {
  const info = embeddingProvider.info();
  return JSON.stringify({ provider: info.provider, model: info.model || null, dimensions: info.dimensions || null, url: info.url || null });
}

export async function indexFile(file) {
  if (!file?.id || !file.ownerId) throw new Error("file with id and ownerId is required");
  const pieces = chunkText(file.text);
  const vectors = await embeddingProvider.embedMany(pieces.map(chunk => chunk.content));
  const chunks = pieces.map((chunk, index) => ({
    id: makeId(), fileId: file.id, ownerId: file.ownerId, index,
    start: chunk.start, end: chunk.end, content: chunk.content,
    tokens: tokenize(chunk.content), vector: vectors[index]
  }));
  await updateStore(store => {
    store.ragChunks ??= {};
    for (const old of Object.values(store.ragChunks)) {
      if (old.fileId === file.id && old.ownerId === file.ownerId) delete store.ragChunks[old.id];
    }
    for (const chunk of chunks) store.ragChunks[chunk.id] = chunk;
    return store;
  });
  return chunks.map(({ tokens, vector, ...chunk }) => chunk);
}

export async function reindexOwner(ownerId) {
  if (!ownerId) throw new Error("ownerId is required");
  const store = await getStore();
  const files = Object.values(store.files || {}).filter(file => file.ownerId === ownerId);
  let chunks = 0;
  for (const file of files) chunks += (await indexFile(file)).length;
  return { files: files.length, chunks, embedding: embeddingInfo() };
}

export async function reindexFile(fileId, ownerId) {
  const store = await getStore();
  const file = store.files?.[fileId];
  if (!file || file.ownerId !== ownerId) return null;
  const indexed = await indexFile(file);
  return { fileId, chunks: indexed.length, embedding: embeddingInfo() };
}

export async function removeFileIndex(fileId, ownerId) {
  let removed = 0;
  await updateStore(store => {
    store.ragChunks ??= {};
    for (const [id, chunk] of Object.entries(store.ragChunks)) {
      if (chunk.fileId === fileId && chunk.ownerId === ownerId) {
        delete store.ragChunks[id]; removed++;
      }
    }
    return store;
  });
  return removed;
}

function keywordScore(chunk, terms) {
  if (!terms.length) return 0;
  const tokens = chunk.tokens || tokenize(chunk.content);
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
  let score = 0;
  for (const term of terms) {
    const count = counts.get(term) || 0;
    if (count) score += 1 + Math.log1p(count);
  }
  return score / Math.sqrt(Math.max(1, tokens.length));
}

export async function searchRag(ownerId, query, limit = 5, options = {}) {
  const terms = tokenize(query);
  if (!ownerId || !terms.length) return [];
  const store = await getStore();
  const chunks = Object.values(store.ragChunks || {}).filter(chunk => chunk.ownerId === ownerId);
  const queryVector = await embeddingProvider.embed(query);
  const vectorRanked = rankVectors(chunks, queryVector, { limit: Math.max(20, Number(limit) || 5) });
  const vectorScores = new Map(vectorRanked.map(item => [item.id, item.score]));
  const mode = String(options.mode || "hybrid").toLowerCase();
  const results = chunks.map(chunk => {
    const keyword = keywordScore(chunk, terms);
    const vector = vectorScores.get(chunk.id) ?? 0;
    const score = mode === "keyword" ? keyword : mode === "vector" ? vector : (keyword * 0.65) + (vector * 0.35);
    return { ...chunk, keywordScore: keyword, vectorScore: vector, score };
  }).filter(item => item.score > 0).sort((a,b) => b.score-a.score)
    .slice(0, Math.max(1, Math.min(Number(limit) || 5, 20)));
  return stripVectors(results).map(({ tokens, embeddingVersion: _, ...item }) => item);
}

export async function ragContext(ownerId, query, limit = 5, options = {}) {
  const results = await searchRag(ownerId, query, limit, options);
  return {
    query: String(query || ""), embedding: embeddingInfo(), results,
    context: results.map((item, i) => `[Source ${i + 1}: ${item.fileId}, chunk ${item.index}]\n${item.content}`).join("\\n\\n")
  };
}
