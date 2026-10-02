import { getStore } from "./store.js";
import { billingSnapshot } from "./billing.js";
import { getUsage } from "./usage.js";

export async function dashboardSnapshot(ownerId) {
  if (!ownerId) throw new Error("ownerId is required");
  const store = await getStore();
  const files = Object.values(store.files || {}).filter(file => file.ownerId === ownerId);
  const conversations = Object.values(store.conversations || {}).filter(item => item.ownerId === ownerId);
  const usage = await getUsage(ownerId);
  return {
    ownerId,
    usage,
    resources: { files: files.length, conversations: conversations.length },
    billing: await billingSnapshot(ownerId),
    generatedAt: new Date().toISOString()
  };
}
