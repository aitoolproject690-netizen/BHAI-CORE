import { getStore, updateStore } from "./store.js";
import { getUsage } from "./usage.js";

const PLANS = Object.freeze({
  free: { name: "Free", monthlyRequests: 100, monthlyCharsIn: 250000, monthlyCharsOut: 250000, imageJobs: 25, videoSeconds: 60 },
  pro: { name: "Pro", monthlyRequests: 5000, monthlyCharsIn: 5000000, monthlyCharsOut: 5000000, imageJobs: 500, videoSeconds: 1800 },
  business: { name: "Business", monthlyRequests: 50000, monthlyCharsIn: 50000000, monthlyCharsOut: 50000000, imageJobs: 5000, videoSeconds: 10000 }
});

function monthKey(date = new Date()) { return date.toISOString().slice(0, 7); }
function safePlan(plan) { return PLANS[String(plan || "free").toLowerCase()] ? String(plan).toLowerCase() : "free"; }

export function billingPlans() {
  return Object.fromEntries(Object.entries(PLANS).map(([id, plan]) => [id, { id, ...plan }]));
}

export async function getBillingAccount(ownerId) {
  if (!ownerId) throw new Error("ownerId is required");
  const store = await getStore();
  const account = store.billing?.[ownerId] || { ownerId, plan: "free", month: monthKey(), status: "active", updatedAt: null };
  return { ...account, plan: safePlan(account.plan), limits: PLANS[safePlan(account.plan)] };
}

export async function setBillingPlan(ownerId, plan) {
  const selected = safePlan(plan);
  let account;
  await updateStore(store => {
    store.billing ??= {};
    account = {
      ...(store.billing[ownerId] || { ownerId }),
      ownerId,
      plan: selected,
      month: monthKey(),
      status: "active",
      updatedAt: new Date().toISOString()
    };
    store.billing[ownerId] = account;
    return store;
  });
  return { ...account, limits: PLANS[selected] };
}

export async function recordBillingUsage(ownerId, delta = {}) {
  if (!ownerId) throw new Error("ownerId is required");
  let result;
  const month = monthKey();
  await updateStore(store => {
    store.billing ??= {};
    const current = store.billing[ownerId] || { ownerId, plan: "free", status: "active" };
    const base = current.month === month ? current : { ...current, month, requests: 0, charsIn: 0, charsOut: 0, imageJobs: 0, videoSeconds: 0 };
    base.requests = Number(base.requests || 0) + (Number(delta.requests) || 0);
    base.charsIn = Number(base.charsIn || 0) + (Number(delta.charsIn) || 0);
    base.charsOut = Number(base.charsOut || 0) + (Number(delta.charsOut) || 0);
    base.imageJobs = Number(base.imageJobs || 0) + (Number(delta.imageJobs) || 0);
    base.videoSeconds = Number(base.videoSeconds || 0) + (Number(delta.videoSeconds) || 0);
    store.billing[ownerId] = base;
    result = { ...base };
    return store;
  });
  return result;
}

export async function assertBillingQuota(ownerId, delta = {}) {
  const account = await getBillingAccount(ownerId);
  const store = await getStore();
  const current = store.billing?.[ownerId];
  const usage = current?.month === monthKey() ? current : {};
  const checks = [
    ["requests", delta.requests || 0, account.limits.monthlyRequests],
    ["charsIn", delta.charsIn || 0, account.limits.monthlyCharsIn],
    ["charsOut", delta.charsOut || 0, account.limits.monthlyCharsOut],
    ["imageJobs", delta.imageJobs || 0, account.limits.imageJobs],
    ["videoSeconds", delta.videoSeconds || 0, account.limits.videoSeconds]
  ];
  for (const [field, add, limit] of checks) {
    if (Number(usage[field] || 0) + Number(add) > Number(limit)) {
      throw Object.assign(new Error("Billing quota exceeded: " + field), { code: "BILLING_QUOTA_EXCEEDED", status: 429, field, limit });
    }
  }
  return { ok: true, plan: account.plan, limits: account.limits };
}

export async function billingUsage(ownerId) {
  const account = await getBillingAccount(ownerId);
  const store = await getStore();
  const current = store.billing?.[ownerId];
  const usage = current?.month === monthKey() ? current : {};
  return {
    month: monthKey(),
    plan: account.plan,
    status: account.status,
    usage: {
      requests: Number(usage.requests || 0),
      charsIn: Number(usage.charsIn || 0),
      charsOut: Number(usage.charsOut || 0),
      imageJobs: Number(usage.imageJobs || 0),
      videoSeconds: Number(usage.videoSeconds || 0)
    },
    limits: account.limits
  };
}

export async function billingSnapshot(ownerId) {
  return { account: await getBillingAccount(ownerId), usage: await billingUsage(ownerId), plans: billingPlans() };
}
