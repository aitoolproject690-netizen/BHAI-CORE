import { cosineSimilarity } from "./embeddings.js";

export function rankVectors(items, queryVector, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 5, 50));
  const minScore = Number(options.minScore ?? 0);

  return items
    .map(item => ({
      ...item,
      score: cosineSimilarity(item.vector, queryVector)
    }))
    .filter(item => item.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function stripVectors(items) {
  return items.map(({ vector, ...item }) => item);
}
