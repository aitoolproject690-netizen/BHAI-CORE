import crypto from "node:crypto";
import { getStore, updateStore } from "./store.js";

const MAX_MESSAGES = Number(process.env.BHAI_MEMORY_MAX_MESSAGES || 40);
const MAX_MESSAGE_CHARS = Number(process.env.BHAI_MEMORY_MAX_MESSAGE_CHARS || 12000);
const MAX_CONTEXT_CHARS = Number(process.env.BHAI_MEMORY_MAX_CONTEXT_CHARS || 30000);

function id(prefix) {
  return prefix + "_" + crypto.randomUUID();
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/(sk-[A-Za-z0-9_-]{20,})/g, "[REDACTED_KEY]")
    .replace(/(AIza[A-Za-z0-9_-]{20,})/g, "[REDACTED_KEY]")
    .replace(/(bhai_[A-Za-z0-9_-]{20,})/g, "[REDACTED_KEY]")
    .slice(0, MAX_MESSAGE_CHARS);
}

function ownerCheck(conversation, ownerId) {
  return conversation && conversation.ownerId === ownerId;
}

function compactMessage(message) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt
  };
}

function buildContext(messages) {
  const selected = [];
  let chars = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const item = messages[i];
    const size = item.content.length + item.role.length + 32;
    if (selected.length && chars + size > MAX_CONTEXT_CHARS) break;
    selected.push(compactMessage(item));
    chars += size;
  }
  return selected.reverse();
}

export async function createConversation(ownerId, title = "New conversation") {
  if (!ownerId) throw new Error("ownerId is required");
  const conversation = {
    id: id("conv"),
    ownerId,
    title: cleanText(title).slice(0, 200) || "New conversation",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: []
  };
  await updateStore(store => {
    store.conversations ??= {};
    store.conversations[conversation.id] = conversation;
    return store;
  });
  return { ...conversation, messages: [] };
}

export async function listConversations(ownerId) {
  const store = await getStore();
  return Object.values(store.conversations ?? {})
    .filter(item => item.ownerId === ownerId)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .map(({ messages, ...item }) => ({ ...item, messageCount: messages.length }));
}

export async function getConversation(conversationId, ownerId) {
  const store = await getStore();
  const conversation = store.conversations?.[conversationId];
  if (!ownerCheck(conversation, ownerId)) return null;
  return {
    ...conversation,
    messages: conversation.messages.map(compactMessage)
  };
}

export async function deleteConversation(conversationId, ownerId) {
  let deleted = false;
  await updateStore(store => {
    const conversation = store.conversations?.[conversationId];
    if (!ownerCheck(conversation, ownerId)) return store;
    delete store.conversations[conversationId];
    deleted = true;
    return store;
  });
  return deleted;
}

export async function appendMessage(conversationId, ownerId, { role, content, metadata = null }) {
  const allowedRoles = new Set(["system", "user", "assistant", "tool"]);
  if (!allowedRoles.has(role)) throw new Error("Invalid message role");
  const text = cleanText(content);
  if (!text) throw new Error("Message content is required");

  let saved;
  await updateStore(store => {
    const conversation = store.conversations?.[conversationId];
    if (!ownerCheck(conversation, ownerId)) throw new Error("Conversation not found");
    const message = {
      id: id("msg"),
      role,
      content: text,
      metadata: metadata && typeof metadata === "object" ? metadata : null,
      createdAt: new Date().toISOString()
    };
    conversation.messages.push(message);
    if (conversation.messages.length > MAX_MESSAGES)
      conversation.messages = conversation.messages.slice(-MAX_MESSAGES);
    conversation.updatedAt = message.createdAt;
    if (role === "user" && conversation.title === "New conversation")
      conversation.title = text.slice(0, 80);
    saved = compactMessage(message);
    return store;
  });
  return saved;
}

export async function getConversationContext(conversationId, ownerId, extraMessages = []) {
  const conversation = await getConversation(conversationId, ownerId);
  if (!conversation) return null;
  const combined = [
    ...conversation.messages,
    ...extraMessages.map(item => ({
      id: item.id || "context_" + crypto.randomUUID(),
      role: item.role || "user",
      content: cleanText(item.content),
      createdAt: item.createdAt || new Date().toISOString()
    }))
  ];
  return {
    conversationId,
    messages: buildContext(combined),
    messageCount: conversation.messages.length,
    limits: {
      maxMessages: MAX_MESSAGES,
      maxMessageChars: MAX_MESSAGE_CHARS,
      maxContextChars: MAX_CONTEXT_CHARS
    }
  };
}

export function memoryInfo() {
  return {
    persistent: true,
    backend: "json",
    maxMessages: MAX_MESSAGES,
    maxMessageChars: MAX_MESSAGE_CHARS,
    maxContextChars: MAX_CONTEXT_CHARS,
    ownerScoped: true
  };
}
