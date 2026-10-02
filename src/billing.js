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

export async function billingUsage(ownerId) {
  const account = await getBillingAccount(ownerId);
  const usage = await getUsage(ownerId);
  return {
    month: monthKey(),
    plan: account.plan,
    status: account.status,
    usage: {
      requests: usage.requests,
      charsIn: usage.charsIn,
      charsOut: usage.charsOut
    },
    limits: account.limits
  };
}

export async function billingSnapshot(ownerId) {
  return { account: await getBillingAccount(ownerId), usage: await billingUsage(ownerId), plans: billingPlans() };
}
