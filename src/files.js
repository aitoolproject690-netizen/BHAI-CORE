import crypto from "node:crypto";
import path from "node:path";
import { getStore, updateStore } from "./store.js";
import { indexFile, removeFileIndex } from "./rag.js";

const MAX_FILE_BYTES = Number(process.env.BHAI_MAX_FILE_BYTES || 5_000_000);
const MAX_TEXT_CHARS = Number(process.env.BHAI_MAX_TEXT_CHARS || 200_000);

function safeName(name) {
  const base = path.basename(String(name || "file.txt")).replace(/[^A-Za-z0-9._ -]/g, "_").trim();
  return base || "file.txt";
}

function makeId() {
  return "file_" + crypto.randomUUID();
}

function normalizeText(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function fileLimits() {
  return { maxBytes: MAX_FILE_BYTES, maxTextChars: MAX_TEXT_CHARS };
}

export async function createTextFile({ ownerId, name, text, mimeType = "text/plain" }) {
  if (!ownerId) throw new Error("ownerId is required");
  const normalized = normalizeText(text);
  if (Buffer.byteLength(normalized, "utf8") > MAX_FILE_BYTES) {
    const error = new Error("File exceeds maximum size");
    error.code = "FILE_TOO_LARGE";
    throw error;
  }
  if (normalized.length > MAX_TEXT_CHARS) {
    const error = new Error("Text exceeds maximum character limit");
    error.code = "TEXT_TOO_LARGE";
    throw error;
  }
  const id = makeId();
  const now = new Date().toISOString();
  const item = { id, ownerId, name: safeName(name), mimeType,
    sizeBytes: Buffer.byteLength(normalized, "utf8"), text: normalized,
    createdAt: now, updatedAt: now };
  await updateStore(store => {
    store.files ??= {};
    store.files[id] = item;
    return store;
  });
  try {
    await indexFile(item);
  } catch (error) {
    await updateStore(store => {
      if (store.files?.[id]?.ownerId === ownerId) delete store.files[id];
      return store;
    });
    throw error;
  }
  const { text: _, ...metadata } = item;
  return metadata;
}

export async function getFile(id, ownerId) {
  const store = await getStore();
  const item = store.files?.[id];
  if (!item || item.ownerId !== ownerId) return null;
  return { ...item };
}

export async function listFiles(ownerId) {
  const store = await getStore();
  return Object.values(store.files || {})
    .filter(item => item.ownerId === ownerId)
    .map(({ text: _, ...metadata }) => metadata);
}

export async function deleteFile(id, ownerId) {
  let deleted = false;
  await updateStore(store => {
    const item = store.files?.[id];
    if (!item || item.ownerId !== ownerId) return store;
    delete store.files[id];
    deleted = true;
    return store;
  });
  if (deleted) await removeFileIndex(id, ownerId);
  return deleted;
}

export async function searchFiles(ownerId, query, limit = 10) {
  const q = normalizeText(query).trim().toLowerCase();
  if (!q) return [];
  const store = await getStore();
  return Object.values(store.files || {})
    .filter(item => item.ownerId === ownerId)
    .map(item => {
      const index = item.text.toLowerCase().indexOf(q);
      if (index < 0) return null;
      const start = Math.max(0, index - 160);
      const end = Math.min(item.text.length, index + q.length + 320);
      return { id: item.id, name: item.name, mimeType: item.mimeType,
        score: 1, snippet: item.text.slice(start, end) };
    })
    .filter(Boolean)
    .slice(0, Math.max(1, Math.min(Number(limit) || 10, 50)));
}
