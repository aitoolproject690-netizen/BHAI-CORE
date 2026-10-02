import http from "node:http";
import { startTlsServer, tlsInfo } from "./src/tls.js";
import { config } from "./src/config.js";
import { generate, getProviderStatus } from "./src/router.js";
import { publicError } from "./src/errors.js";
import { requestId } from "./src/requestId.js";
import { recordUsage, allUsage, allProviderUsage } from "./src/usage.js";
import { assertBudget } from "./src/budget.js";
import { authenticate, createApiKey, listApiKeys, revokeApiKey } from "./src/auth.js";
import { health, readiness } from "./src/health.js";
import { enqueue, getStoredJob } from "./src/queue.js";
import { startSSE, sendEvent, endSSE } from "./src/stream.js";
import { EVENTS, tokenEvent, completeEvent, errorEvent } from "./src/events.js";
import { providerAdapters } from "./src/providers.js";
import { storageInfo } from "./src/store.js";
import { createTextFile, getFile, listFiles, deleteFile, searchFiles, fileLimits } from "./src/files.js";
import { searchRag, ragContext } from "./src/rag.js";
import { embeddingInfo } from "./src/embeddings.js";
import { getModelRegistry, modelCapabilities } from "./src/models.js";
import { analyzeImage, getVisionCandidates } from "./src/vision.js";
import { createImageRequest, submitComfyUI, getComfyUIHistory, imageProviderInfo, recordImageJobOwnership, getImageJobOwnership } from "./src/image.js";
import { createVideoRequest, planVideo, submitVideoHttp, videoProviderInfo } from "./src/video.js";
import { billingPlans, getBillingAccount, billingUsage, billingSnapshot, setBillingPlan, assertBillingQuota, recordBillingUsage } from "./src/billing.js";
import { dashboardSnapshot } from "./src/dashboard.js";
import { createSpeechRequest, transcribeWhisper, createTtsRequest, synthesizePiper, voiceProviderInfo } from "./src/voice.js";
import { canAttempt, recordFailure, recordSuccess } from "./src/circuitBreaker.js";
import { listAgentTools, executeAgentTool } from "./src/agent.js";
import { planAgentRequest, validatePlan, runAgentPlan } from "./src/planner.js";
import { createConversation, listConversations, getConversation, deleteConversation, appendMessage, getConversationContext, memoryInfo } from "./src/memory.js";
import { withRetry, classifyError } from "./src/retry.js";
import { listToolPolicies, hasPermission } from "./src/policy.js";
import { recordAudit, listAudit, auditInfo } from "./src/audit.js";
import { createApproval, getApproval, decideApproval, approvalInfo } from "./src/approval.js";
import { cloudBuildInfo } from "./src/cloudBuild.js";
import { getBuildDetails, buildLogInfo } from "./src/buildLogs.js";
import { createService, createServiceFromDeployment, getService, stopService, checkService, monitorService, listServices, serviceInfo } from "./src/service.js";
import { getDeployment, listDeployments, setDeploymentStatus, deploymentInfo, promoteDeployment, rollbackDeployment, getProductionDeployment } from "./src/deployment.js";
import { createDomain, getDomain, listDomains, setDomainStatus, domainInfo, attachDomainRoute } from "./src/domain.js";
import { createCertificate, getCertificate, listCertificates, setCertificateStatus, certificateInfo } from "./src/certificates.js";
import { createDnsChallenge, getDnsChallenge, listDnsChallenges, setDnsChallengeStatus, verifyDnsChallenge, dnsInfo } from "./src/dns.js";
import { getAcmeDirectory, acmeInfo, createAcmeAccount, listAcmeAccounts, registerStoredAcmeAccount, renewDueCertificates } from "./src/acme.js";
import { createAcmeOrder, getAcmeOrder, listAcmeOrders, prepareDnsChallenge, setAcmeOrderStatus, acmeOrderInfo } from "./src/acmeOrder.js";
import { createAutoDeploy, getAutoDeploy, listAutoDeploys, setAutoDeployStatus, autoDeployInfo, findAutoDeploysByRepository, recordAutoDeployRun, claimWebhookDelivery } from "./src/autodeploy.js";
import { createRoute, getRoute, listRoutes, setRouteStatus, findRouteByHostname, networkInfo, networkSecurityInfo, proxyRequest } from "./src/network.js";
import { executeCloudBuildJob } from "./src/cloudJob.js";
import { startAcmeIssuance, completeAcmeIssuance, acmeIssuanceInfo } from "./src/acmeIssuance.js";
import { createRenewalScheduler, renewalSchedulerInfo } from "./src/renewalScheduler.js";
import crypto from "node:crypto";
import { checkRateLimit, rateLimitInfo } from "./src/rateLimit.js";
import { readRequestBody } from "./src/requestBody.js";

const cfg = config();

function send(res, status, body, rid) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "x-request-id": rid
  });
  res.end(JSON.stringify(body));
}

function authorized(req) {
  if (!cfg.apiKey) return true;
  return secretsEqual(req.headers.authorization || "", "Bearer " + cfg.apiKey);
}

function requireCloudBuild(identity, res, rid) {
  if (!hasPermission(identity, "cloud:build")) {
    send(res, 403, { ok:false, error:"Permission denied: cloud:build required", code:"PERMISSION_DENIED" }, rid);
    return false;
  }
  return true;
}

function secretsEqual(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string" || !expected) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function adminAuthorized(req) {
  return secretsEqual(req.headers["x-bhai-admin-key"], process.env.BHAI_CORE_ADMIN_KEY);
}

async function readJsonRaw(req, maxBytes = 2_000_000) {
  return readRequestBody(req, maxBytes);
}

async function readJson(req, maxBytes = 2_000_000) {
  const body = await readRequestBody(req, maxBytes);
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch (error) {
    throw Object.assign(new Error("Invalid JSON request body"), {
      code: "REQUEST_BODY_INVALID_JSON",
      status: 400,
      cause: error
    });
  }
}

const server = http.createServer(async (req, res) => {
  const rid = requestId(req);
  const rate = checkRateLimit(req.socket.remoteAddress || "anonymous");
  if (!rate.allowed) return send(res,429,{ok:false,error:"Rate limit exceeded",retryAfterMs:rate.retryAfterMs},rid);

  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type, authorization, x-bhai-key, x-bhai-admin-key",
        "access-control-allow-methods": "GET,POST,DELETE,OPTIONS"
      });
      return res.end();
    }

    const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));

    const incomingHost = String(req.headers.host || "").toLowerCase();
    const routedHost = incomingHost.replace(/:\\d+$/, "");
    if (!routedHost.endsWith(".localhost") && routedHost !== "localhost" && !url.pathname.startsWith("/v1/") && !url.pathname.startsWith("/health") && !url.pathname.startsWith("/ready")) {
      const route = await findRouteByHostname(routedHost);
      if (route) return proxyRequest(req, res, route);
    }

    if (url.pathname === "/health" && req.method === "GET")
      return send(res, 200, { ...health(), storage: storageInfo(), rateLimit: rateLimitInfo() }, rid);

    if (url.pathname === "/ready" && req.method === "GET") {
      const result = readiness();
      return send(res, result.ready ? 200 : 503, result, rid);
    }

    if (url.pathname === "/v1/cloud/webhooks/github" && req.method === "POST") {
      const secret = process.env.BHAI_GITHUB_WEBHOOK_SECRET;
      if (!secret) return send(res, 503, { ok:false, error:"GitHub webhook secret is not configured" }, rid);
      const signature = req.headers["x-hub-signature-256"] || "";
      const raw = await readJsonRaw(req, 1_000_000);
      const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
      const a = Buffer.from(signature), b = Buffer.from(expected);
      if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) return send(res, 401, { ok:false, error:"Invalid webhook signature" }, rid);
      const event = req.headers["x-github-event"];
      if (event !== "push") return send(res, 202, { ok:true, ignored:true, event }, rid);
      const deliveryId = String(req.headers["x-github-delivery"] || "").trim();
      if (!deliveryId) return send(res, 400, { ok:false, error:"Missing GitHub delivery id" }, rid);
      const claim = await claimWebhookDelivery(deliveryId);
      if (!claim.accepted) return send(res, 202, { ok:true, duplicate:true, deliveryId }, rid);
      let body;
      try {
        body = JSON.parse(raw);
      } catch (error) {
        throw Object.assign(new Error("Invalid JSON webhook body"), {
          code: "REQUEST_BODY_INVALID_JSON",
          status: 400,
          cause: error
        });
      }
      const repository = body.repository?.full_name;
      const branch = String(body.ref || "").replace(/^refs\/heads\//, "");
      const commit = body.after || null;
      if (!repository || !branch || !commit) return send(res, 400, { ok:false, error:"Invalid push payload" }, rid);
      const hooks = (await findAutoDeploysByRepository(repository)).filter(h => h.status === "enabled" && h.branch === branch);
      for (const hook of hooks) {
        await recordAutoDeployRun(hook.id, hook.ownerId, { commit, status:"running" });
        executeCloudBuildJob({ ownerId: hook.ownerId, repository, branch }).then(async result => {
          await recordAutoDeployRun(hook.id, hook.ownerId, { commit, deploymentId: result.deployment?.id || null, status: result.status, error: result.status === "failed" ? "Cloud build failed" : null });
        }).catch(async error => {
          await recordAutoDeployRun(hook.id, hook.ownerId, { commit, status:"failed", error:error.message });
        });
      }
      return send(res, 202, { ok:true, event:"push", repository, branch, commit, triggered:hooks.length }, rid);
    }

    if (!authorized(req))
      return send(res, 401, { ok: false, error: "Unauthorized" }, rid);

    if (url.pathname === "/v1/memory/info" && req.method === "GET")
      return send(res, 200, { ok: true, memory: memoryInfo() }, rid);

    if (url.pathname === "/v1/conversations" && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      return send(res, 200, { ok: true, conversations: await listConversations(identity.id) }, rid);
    }

    if (url.pathname === "/v1/conversations" && req.method === "POST") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const body = await readJson(req);
      return send(res, 201, { ok: true, conversation: await createConversation(identity.id, body.title) }, rid);
    }

    const conversationMatch = url.pathname.match(/^\/v1\/conversations\/([^/]+)$/);
    if (conversationMatch && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const conversation = await getConversation(conversationMatch[1], identity.id);
      return conversation
        ? send(res, 200, { ok: true, conversation }, rid)
        : send(res, 404, { ok: false, error: "Conversation not found" }, rid);
    }

    if (conversationMatch && req.method === "DELETE") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const deleted = await deleteConversation(conversationMatch[1], identity.id);
      return send(res, deleted ? 200 : 404, { ok: deleted }, rid);
    }

    const contextMatch = url.pathname.match(/^\/v1\/conversations\/([^/]+)\/context$/);
    if (contextMatch && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const context = await getConversationContext(contextMatch[1], identity.id);
      return context
        ? send(res, 200, { ok: true, ...context }, rid)
        : send(res, 404, { ok: false, error: "Conversation not found" }, rid);
    }

    const messagesMatch = url.pathname.match(/^\/v1\/conversations\/([^/]+)\/messages$/);
    if (messagesMatch && req.method === "POST") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const body = await readJson(req);
      const message = await appendMessage(messagesMatch[1], identity.id, {
        role: body.role,
        content: body.content,
        metadata: body.metadata
      });
      return send(res, 201, { ok: true, message }, rid);
    }

    if (url.pathname === "/v1/agent/plan" && req.method === "POST") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const body = await readJson(req);
      const plan = planAgentRequest(body);
      return send(res, 200, { ok: true, plan }, rid);
    }

    if (url.pathname === "/v1/agent/run" && req.method === "POST") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const body = await readJson(req, 16_000_000);
      const plan = body.plan || planAgentRequest(body);
      validatePlan(plan);
      const result = await runAgentPlan(plan, identity, { conversationId: body.conversationId });
      return send(res, 200, { ok: result.status === "succeeded", ...result }, rid);
    }

    if (url.pathname === "/v1/agent/audit" && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      return send(res, 200, { ok: true, ...auditInfo(), events: await listAudit({ actorId: identity.id, limit: url.searchParams.get("limit") }) }, rid);
    }

    if (url.pathname === "/v1/agent/approvals" && req.method === "POST") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const body = await readJson(req);
      if (!body.tool) return send(res, 400, { ok: false, error: "tool is required" }, rid);
      return send(res, 201, { ok: true, approval: await createApproval({ actorId: identity.id, tool: body.tool, input: body.input, requestId: rid }) }, rid);
    }

    const approvalMatch = url.pathname.match(/^\/v1\/agent\/approvals\/([^/]+)$/);
    if (approvalMatch && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const approval = await getApproval(approvalMatch[1], identity.id);
      return approval ? send(res, 200, { ok: true, approval }, rid) : send(res, 404, { ok: false, error: "Approval not found" }, rid);
    }

    if (approvalMatch && req.method === "POST") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const body = await readJson(req);
      const approval = await decideApproval(approvalMatch[1], identity.id, body.decision);
      return approval ? send(res, 200, { ok: true, approval }, rid) : send(res, 404, { ok: false, error: "Approval not found or no longer pending" }, rid);
    }

    if (url.pathname === "/v1/agent/approval-info" && req.method === "GET")
      return send(res, 200, { ok: true, ...approvalInfo() }, rid);

    if (url.pathname === "/v1/agent/policies" && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      return send(res, 200, { ok: true, policies: listToolPolicies() }, rid);
    }

    if (url.pathname === "/v1/agent/tools" && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      return send(res, 200, { ok: true, tools: listAgentTools() }, rid);
    }

    if (url.pathname === "/v1/agent/execute" && req.method === "POST") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const body = await readJson(req, 16_000_000);
      if (!body.tool) return send(res, 400, { ok: false, error: "tool is required" }, rid);
      const result = await executeAgentTool(body.tool, body.input || {}, identity, { approvalId: body.approvalId, requestId: rid });
      return send(res, 200, { ok: true, tool: body.tool, result }, rid);
    }

    if (url.pathname === "/v1/providers" && req.method === "GET")
      return send(res, 200, { ok: true, providers: getProviderStatus() }, rid);

    if (url.pathname === "/v1/models" && req.method === "GET") {
      const probe = url.searchParams.get("probe") === "true";
      return send(res, 200, await getModelRegistry({ probeOllama: probe }), rid);
    }

    if (url.pathname === "/v1/voice/providers" && req.method === "GET")
      return send(res, 200, { ok: true, providers: voiceProviderInfo() }, rid);

    if (url.pathname === "/v1/voice/transcribe" && req.method === "POST") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const body = await readJson(req, 16_000_000);
      const request = createSpeechRequest(body);
      await assertBillingQuota(identity.id, { requests: 1, charsIn: request.audio.length });
      if (process.env.WHISPER_ENABLED !== "true") return send(res, 503, { ok: false, error: "Local Whisper is not configured" }, rid);
      const result = await transcribeWhisper({ audio: request.audio, mimeType: request.mimeType, language: request.language, url: process.env.WHISPER_URL });
      await recordBillingUsage(identity.id, { requests: 1, charsIn: request.audio.length, charsOut: String(result.text || "").length });
      await recordUsage({ key: identity.id, input: request.audio.length, output: String(result.text || "").length });
      return send(res, 200, { ok: true, ...request, audio: undefined, ...result }, rid);
    }

    if (url.pathname === "/v1/voice/synthesize" && req.method === "POST") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const body = await readJson(req);
      const request = createTtsRequest(body);
      await assertBillingQuota(identity.id, { requests: 1, charsIn: request.text.length });
      if (process.env.PIPER_ENABLED !== "true") return send(res, 503, { ok: false, error: "Local Piper is not configured" }, rid);
      const result = await synthesizePiper({ text: request.text, voice: request.voice, language: request.language, url: process.env.PIPER_URL });
      await recordBillingUsage(identity.id, { requests: 1, charsIn: request.text.length });
      await recordUsage({ key: identity.id, input: request.text.length });
      return send(res, 200, { ok: true, ...request, ...result }, rid);
    }

    if (url.pathname === "/v1/image/providers" && req.method === "GET")
      return send(res, 200, { ok: true, providers: imageProviderInfo() }, rid);

    const imageJobMatch = url.pathname.match(/^\/v1\/image\/jobs\/([^/]+)$/);
    if (imageJobMatch && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const ownership = await getImageJobOwnership(imageJobMatch[1], identity.id);
      if (!ownership) return send(res, 404, { ok: false, error: "Image job not found" }, rid);
      const result = await getComfyUIHistory({ url: process.env.COMFYUI_URL, promptId: imageJobMatch[1] });
      return send(res, 200, { ok: true, ...result }, rid);
    }

    if (url.pathname === "/v1/image/generate" && req.method === "POST") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const body = await readJson(req);
      const request = createImageRequest(body);
      await assertBillingQuota(identity.id, { requests: 1, imageJobs: 1 });
      if (request.provider !== "comfyui") return send(res, 400, { ok: false, error: "Unsupported image provider" }, rid);
      const result = await submitComfyUI({
        url: process.env.COMFYUI_URL,
        request,
        workflow: body.workflow
      });
      await recordImageJobOwnership({ promptId: result.promptId, ownerId: identity.id, requestId: rid });
      await recordBillingUsage(identity.id, { requests: 1, imageJobs: 1 });
      await recordUsage({ key: identity.id, input: JSON.stringify(body).length });
      return send(res, 202, { ok: true, ...request, ...result, status: "submitted" }, rid);
    }

    if (url.pathname === "/v1/vision/analyze" && req.method === "POST") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const body = await readJson(req, 12_000_000);
      const candidates = getVisionCandidates();
      const selected = body.provider
        ? candidates.find(item => item.provider === String(body.provider).toLowerCase())
        : candidates[0];
      if (!selected) return send(res, 503, { ok: false, error: "No configured vision-capable model" }, rid);
      const providerCfg = cfg.providers[selected.provider];
      const imageInput = typeof body.image === "string" ? body.image : (body.image?.data || body.image?.base64 || "");
      await assertBillingQuota(identity.id, { requests: 1, charsIn: String(body.prompt || "").length + String(imageInput).length });
      const result = await analyzeImage({
        provider: selected.provider,
        model: body.model || selected.model,
        key: providerCfg.key,
        url: providerCfg.url,
        prompt: body.prompt,
        image: body.image
      });
      await recordBillingUsage(identity.id, { requests: 1, charsIn: String(body.prompt || "").length + String(imageInput).length, charsOut: String(result.text || "").length });
      await recordUsage({ key: identity.id, input: String(body.prompt || "").length + String(imageInput).length, output: String(result.text || "").length });
      return send(res, 200, { ok: true, ...result }, rid);
    }

    if (url.pathname === "/v1/video/providers" && req.method === "GET")
      return send(res, 200, { ok: true, providers: videoProviderInfo() }, rid);

    if (url.pathname === "/v1/video/plan" && req.method === "POST") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const request = createVideoRequest(await readJson(req));
      await assertBillingQuota(identity.id, { requests: 1, videoSeconds: request.durationSeconds });
      return send(res, 200, { ok: true, request, plan: planVideo(request) }, rid);
    }

    if (url.pathname === "/v1/video/generate" && req.method === "POST") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const request = createVideoRequest(await readJson(req));
      await assertBillingQuota(identity.id, { requests: 1, videoSeconds: request.durationSeconds });
      if (request.provider !== "http") return send(res, 400, { ok: false, error: "Unsupported video provider" }, rid);
      const result = await submitVideoHttp({ url: process.env.VIDEO_API_URL, apiKey: process.env.VIDEO_API_KEY, request });
      await recordBillingUsage(identity.id, { requests: 1, videoSeconds: request.durationSeconds });
      await recordUsage({ key: identity.id, input: JSON.stringify(request).length });
      return send(res, 202, { ok: true, ...request, ...result }, rid);
    }

    if (url.pathname === "/v1/billing/plans" && req.method === "GET")
      return send(res, 200, { ok: true, plans: billingPlans() }, rid);

    if (url.pathname === "/v1/billing" && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      return send(res, 200, { ok: true, ...(await billingSnapshot(identity.id)) }, rid);
    }

    if (url.pathname === "/v1/billing/usage" && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      return send(res, 200, { ok: true, ...(await billingUsage(identity.id)) }, rid);
    }

    if (url.pathname === "/v1/billing/admin/subscription" && req.method === "POST") {
      if (!adminAuthorized(req)) return send(res, 401, { ok: false, error: "Admin authentication required" }, rid);
      const body = await readJson(req);
      if (!body.ownerId) return send(res, 400, { ok: false, error: "ownerId is required" }, rid);
      return send(res, 200, { ok: true, account: await setBillingPlan(body.ownerId, body.plan) }, rid);
    }

    if (url.pathname === "/v1/dashboard" && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      return send(res, 200, { ok: true, ...(await dashboardSnapshot(identity.id)) }, rid);
    }

    if (url.pathname === "/v1/models/capabilities" && req.method === "GET") {
      const provider = url.searchParams.get("provider");
      const model = url.searchParams.get("model");
      if (!provider || !model) return send(res, 400, { ok: false, error: "provider and model are required" }, rid);
      return send(res, 200, { ok: true, provider, model, capabilities: modelCapabilities(provider, model) }, rid);
    }

    if (url.pathname === "/v1/cloud/build/info" && req.method === "GET")
      return send(res, 200, { ok: true, cloudBuild: cloudBuildInfo() }, rid);

    if (url.pathname === "/v1/cloud/deployments/info" && req.method === "GET")
      return send(res, 200, { ok: true, ...deploymentInfo() }, rid);

    if (url.pathname === "/v1/cloud/deployments" && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      return send(res, 200, { ok: true, deployments: await listDeployments(identity.id) }, rid);
    }

    const deploymentMatch = url.pathname.match(/^\/v1\/cloud\/deployments\/([^/]+)$/);
    if (deploymentMatch && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const deployment = await getDeployment(deploymentMatch[1], identity.id);
      return deployment ? send(res, 200, { ok: true, deployment }, rid) : send(res, 404, { ok: false, error: "Deployment not found" }, rid);
    }

    const rollbackMatch = url.pathname.match(/^\/v1\/cloud\/deployments\/([^/]+)\/rollback$/);
    if (rollbackMatch && req.method === "POST") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const body = await readJson(req);
      const deployment = await executeAgentTool("cloud_deployment_update", { deploymentId: rollbackMatch[1], action: "rollback" }, identity, { approvalId: body.approvalId, requestId: rid });
      return deployment ? send(res, 200, { ok: true, deployment, rolledBack: true }, rid) : send(res, 404, { ok: false, error: "Deployment not found" }, rid);
    }

    if (url.pathname === "/v1/cloud/deployments/production" && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const repository = url.searchParams.get("repository");
      const branch = url.searchParams.get("branch") || "main";
      if (!repository) return send(res, 400, { ok: false, error: "repository is required" }, rid);
      const deployment = await getProductionDeployment({ ownerId: identity.id, repository, branch });
      return deployment ? send(res, 200, { ok: true, deployment }, rid) : send(res, 404, { ok: false, error: "Production deployment not found" }, rid);
    }

    if (deploymentMatch && req.method === "POST") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const body = await readJson(req);
      const input = body.action === "rollback"
        ? { deploymentId: deploymentMatch[1], action: "rollback" }
        : body.status === "active"
          ? { deploymentId: deploymentMatch[1], action: "promote" }
          : { deploymentId: deploymentMatch[1], status: body.status };
      const deployment = await executeAgentTool("cloud_deployment_update", input, identity, { approvalId: body.approvalId, requestId: rid });
      return deployment ? send(res, 200, { ok: true, deployment }, rid) : send(res, 404, { ok: false, error: "Deployment not found" }, rid);
    }

    if (url.pathname === "/v1/cloud/autodeploy/info" && req.method === "GET")
      return send(res, 200, { ok: true, ...autoDeployInfo() }, rid);

    if (url.pathname === "/v1/cloud/autodeploy" && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      return send(res, 200, { ok: true, autoDeploy: await listAutoDeploys(identity.id) }, rid);
    }

    if (url.pathname === "/v1/cloud/autodeploy" && req.method === "POST") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      if (!requireCloudBuild(identity, res, rid)) return;
      const body = await readJson(req);
      const hook = await createAutoDeploy({ ownerId: identity.id, repository: body.repository, branch: body.branch });
      return send(res, 201, { ok: true, autoDeploy: hook }, rid);
    }

    const autoDeployMatch = url.pathname.match(/^\/v1\/cloud\/autodeploy\/([^/]+)$/);
    if (autoDeployMatch && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const hook = await getAutoDeploy(autoDeployMatch[1], identity.id);
      return hook ? send(res, 200, { ok: true, autoDeploy: hook }, rid) : send(res, 404, { ok: false, error: "Auto-deploy not found" }, rid);
    }

    if (autoDeployMatch && req.method === "POST") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const body = await readJson(req);
      const hook = await setAutoDeployStatus(autoDeployMatch[1], identity.id, body.status);
      return hook ? send(res, 200, { ok: true, autoDeploy: hook }, rid) : send(res, 404, { ok: false, error: "Auto-deploy not found" }, rid);
    }

    if (url.pathname === "/v1/cloud/tls/info" && req.method === "GET") return send(res, 200, { ok: true, tls: tlsInfo() }, rid);

    if (url.pathname === "/v1/cloud/network/info" && req.method === "GET")
      return send(res, 200, { ok:true, ...networkInfo() }, rid);

    if (url.pathname === "/v1/cloud/network/routes" && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok:false, error:"BHAI key required" }, rid);
      return send(res, 200, { ok:true, routes:await listRoutes(identity.id) }, rid);
    }

    if (url.pathname === "/v1/cloud/network/routes" && req.method === "POST") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok:false, error:"BHAI key required" }, rid);
      if (!identity) return send(res, 401, { ok:false, error:"BHAI key required" }, rid);
      const body = await readJson(req);
      const service = await getService(body.serviceId, identity.id);
      if (!service) return send(res, 404, { ok:false, error:"Service not found" }, rid);
      const route = await createRoute({ ownerId:identity.id, hostname:body.hostname, serviceId:body.serviceId, targetHost:body.targetHost, targetPort:body.targetPort });
      return send(res, 201, { ok:true, route }, rid);
    }

    const routeMatch = url.pathname.match(/^\/v1\/cloud\/network\/routes\/([^/]+)$/);
    if (routeMatch && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok:false, error:"BHAI key required" }, rid);
      const route = await getRoute(routeMatch[1], identity.id);
      return route ? send(res, 200, { ok:true, route }, rid) : send(res, 404, { ok:false, error:"Route not found" }, rid);
    }
    if (routeMatch && req.method === "POST") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok:false, error:"BHAI key required" }, rid);
      if (!identity) return send(res, 401, { ok:false, error:"BHAI key required" }, rid);
      const body = await readJson(req);
      const route = await setRouteStatus(routeMatch[1], identity.id, body.status);
      return route ? send(res, 200, { ok:true, route }, rid) : send(res, 404, { ok:false, error:"Route not found" }, rid);
    }

    if (url.pathname === "/v1/cloud/acme/issuance/info" && req.method === "GET") return send(res,200,{ok:true,acmeIssuance:acmeIssuanceInfo()},rid);
    if (url.pathname === "/v1/cloud/acme/issuance/start" && req.method === "POST") {
      const identity=await authenticate(req.headers["x-bhai-key"]);
      if(!identity)return send(res,401,{ok:false,error:"BHAI key required"},rid);
      if (!requireCloudBuild(identity, res, rid)) return; if(!identity)return send(res,401,{ok:false,error:"BHAI key required"},rid);
      const body=await readJson(req); const result=await startAcmeIssuance({ownerId:identity.id,certificateId:body.certificateId,accountId:body.accountId});
      return send(res,202,{ok:true,...result},rid);
    }
    const issuanceMatch=url.pathname.match(/^\/v1\/cloud\/acme\/issuance\/([^/]+)\/complete$/);
    if(issuanceMatch&&req.method==="POST"){
      const identity=await authenticate(req.headers["x-bhai-key"]);
      if(!identity)return send(res,401,{ok:false,error:"BHAI key required"},rid);
      if (!requireCloudBuild(identity, res, rid)) return; if(!identity)return send(res,401,{ok:false,error:"BHAI key required"},rid);
      const result=await completeAcmeIssuance({orderId:issuanceMatch[1],ownerId:identity.id});
      return send(res,result.status==="issued"?200:202,{ok:result.status==="issued",...result},rid);
    }
    if (url.pathname === "/v1/cloud/acme/orders/info" && req.method === "GET") return send(res,200,{ok:true,acmeOrder:acmeOrderInfo()},rid);
    if (url.pathname === "/v1/cloud/acme/orders" && req.method === "GET") { const identity=await authenticate(req.headers["x-bhai-key"]);if(!identity)return send(res,401,{ok:false,error:"BHAI key required"},rid);return send(res,200,{ok:true,orders:await listAcmeOrders(identity.id)},rid); }
    if (url.pathname === "/v1/cloud/acme/orders" && req.method === "POST") { const identity=await authenticate(req.headers["x-bhai-key"]);if(!identity)return send(res,401,{ok:false,error:"BHAI key required"},rid);if (!requireCloudBuild(identity, res, rid)) return;const body=await readJson(req);const order=await createAcmeOrder({...body,ownerId:identity.id});return send(res,201,{ok:true,order},rid); }
    const acmeOrderMatch=url.pathname.match(/^\/v1\/cloud\/acme\/orders\/([^/]+)$/);
    if(acmeOrderMatch&&req.method==="GET"){const identity=await authenticate(req.headers["x-bhai-key"]);if(!identity)return send(res,401,{ok:false,error:"BHAI key required"},rid);const order=await getAcmeOrder(acmeOrderMatch[1],identity.id);return order?send(res,200,{ok:true,order},rid):send(res,404,{ok:false,error:"ACME order not found"},rid);}
    if(acmeOrderMatch&&req.method==="POST"){const identity=await authenticate(req.headers["x-bhai-key"]);if(!identity)return send(res,401,{ok:false,error:"BHAI key required"},rid);if (!requireCloudBuild(identity, res, rid)) return;const body=await readJson(req);if(body.action==="prepare_dns")return send(res,202,{ok:true,...await prepareDnsChallenge(acmeOrderMatch[1],identity.id,{recordName:body.recordName,recordValue:body.recordValue})},rid);const order=await setAcmeOrderStatus(acmeOrderMatch[1],identity.id,body.status,body.patch||{});return order?send(res,200,{ok:true,order},rid):send(res,404,{ok:false,error:"ACME order not found"},rid);}
    if (url.pathname === "/v1/cloud/acme/accounts/register" && req.method === "POST") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      if (!requireCloudBuild(identity, res, rid)) return;      if (!identity) return send(res,401,{ok:false,error:"BHAI key required"},rid);
      const body=await readJson(req);
      const account=await registerStoredAcmeAccount({id:body.id,ownerId:identity.id});
      return account ? send(res,200,{ok:true,account},rid) : send(res,404,{ok:false,error:"ACME account not found"},rid);
    }

    if (url.pathname === "/v1/cloud/acme/info" && req.method === "GET") return send(res,200,{ok:true,acme:acmeInfo(),renewalScheduler:renewalSchedulerInfo()},rid);
    if (url.pathname === "/v1/cloud/acme/directory" && req.method === "GET") { try{return send(res,200,{ok:true,...await getAcmeDirectory()},rid);}catch(error){return send(res,error.status||502,{ok:false,error:error.message,code:error.code||"ACME_ERROR"},rid);} }
    if (url.pathname === "/v1/cloud/acme/accounts" && req.method === "GET") { const identity=await authenticate(req.headers["x-bhai-key"]);if(!identity)return send(res,401,{ok:false,error:"BHAI key required"},rid);return send(res,200,{ok:true,accounts:await listAcmeAccounts(identity.id)},rid); }
    if (url.pathname === "/v1/cloud/acme/accounts" && req.method === "POST") { const identity=await authenticate(req.headers["x-bhai-key"]);if(!identity)return send(res,401,{ok:false,error:"BHAI key required"},rid);if (!requireCloudBuild(identity, res, rid)) return;const account=await createAcmeAccount({ownerId:identity.id});return send(res,202,{ok:true,account},rid); }
    if (url.pathname === "/v1/cloud/acme/renew" && req.method === "POST") { const identity=await authenticate(req.headers["x-bhai-key"]);if(!identity)return send(res,401,{ok:false,error:"BHAI key required"},rid);if (!requireCloudBuild(identity, res, rid)) return;return send(res,200,{ok:true,...await renewDueCertificates(identity.id)},rid); }
    if (url.pathname === "/v1/cloud/dns/info" && req.method === "GET") return send(res, 200, { ok:true, dns:dnsInfo() }, rid);
    if (url.pathname === "/v1/cloud/dns/challenges" && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]); if (!identity) return send(res,401,{ok:false,error:"BHAI key required"},rid);
      return send(res,200,{ok:true,records:await listDnsChallenges(identity.id)},rid);
    }
    if (url.pathname === "/v1/cloud/dns/challenges" && req.method === "POST") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      if (!requireCloudBuild(identity, res, rid)) return; if (!identity) return send(res,401,{ok:false,error:"BHAI key required"},rid);
      const body=await readJson(req); const record=await createDnsChallenge({...body,ownerId:identity.id});
      return send(res,202,{ok:true,record},rid);
    }
    const dnsMatch=url.pathname.match(/^\/v1\/cloud\/dns\/challenges\/([^/]+)$/);
    if(dnsMatch&&req.method==="GET"){const identity=await authenticate(req.headers["x-bhai-key"]);if(!identity)return send(res,401,{ok:false,error:"BHAI key required"},rid);const record=await getDnsChallenge(dnsMatch[1],identity.id);return record?send(res,200,{ok:true,record},rid):send(res,404,{ok:false,error:"DNS record not found"},rid);}
    if(dnsMatch&&req.method==="POST"){const identity=await authenticate(req.headers["x-bhai-key"]);if(!identity)return send(res,401,{ok:false,error:"BHAI key required"},rid);if (!requireCloudBuild(identity, res, rid)) return;const body=await readJson(req);if(body.action==="verify"){const result=await verifyDnsChallenge(dnsMatch[1],identity.id);return result?send(res,200,{ok:true,...result},rid):send(res,404,{ok:false,error:"DNS record not found"},rid);}const record=await setDnsChallengeStatus(dnsMatch[1],identity.id,body.status);return record?send(res,200,{ok:true,record},rid):send(res,404,{ok:false,error:"DNS record not found"},rid);}
    if (url.pathname === "/v1/cloud/certificates/info" && req.method === "GET") return send(res, 200, { ok:true, certificates:certificateInfo() }, rid);
    if (url.pathname === "/v1/cloud/certificates" && req.method === "GET") {
      const auth = await authenticate(req.headers["x-bhai-key"]);
      if (!auth) return send(res, 401, { ok:false, error:"BHAI key required" }, rid);
      return send(res, 200, { ok:true, certificates:await listCertificates(auth.id) }, rid);
    }
    if (url.pathname === "/v1/cloud/certificates" && req.method === "POST") {
      const auth = await authenticate(req.headers["x-bhai-key"]);
      if (!auth) return send(res, 401, { ok:false, error:"BHAI key required" }, rid);
      if (!requireCloudBuild(auth, res, rid)) return;      const body = await readJson(req);
      const cert = await createCertificate({ ...body, ownerId:auth.id });
      return send(res, 202, { ok:true, certificate:cert }, rid);
    }
    if (url.pathname.startsWith("/v1/cloud/certificates/") && req.method === "GET") {
      const auth = await authenticate(req.headers["x-bhai-key"]);
      if (!auth) return send(res, 401, { ok:false, error:"BHAI key required" }, rid);
      const id = url.pathname.split("/").pop();
      const cert = await getCertificate(id, auth.id);
      return cert ? send(res, 200, { ok:true, certificate:cert }, rid) : send(res, 404, { ok:false, error:"Certificate not found" }, rid);
    }
    if (url.pathname.startsWith("/v1/cloud/certificates/") && req.method === "POST") {
      const auth = await authenticate(req.headers["x-bhai-key"]);
      if (!auth) return send(res, 401, { ok:false, error:"BHAI key required" }, rid);
      if (!requireCloudBuild(auth, res, rid)) return;
      if (!auth) return send(res, 401, { ok:false, error:"BHAI key required" }, rid);
      const id = url.pathname.split("/").pop(), body=await readJson(req);
      const cert = await setCertificateStatus(id, auth.id, body.status, body.patch||{});
      return cert ? send(res, 200, { ok:true, certificate:cert }, rid) : send(res, 404, { ok:false, error:"Certificate not found" }, rid);
    }

    if (url.pathname === "/v1/cloud/domains/info" && req.method === "GET")
      return send(res, 200, { ok: true, ...domainInfo() }, rid);

    if (url.pathname === "/v1/cloud/domains" && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      return send(res, 200, { ok: true, domains: await listDomains(identity.id) }, rid);
    }

    if (url.pathname === "/v1/cloud/domains" && req.method === "POST") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      if (!requireCloudBuild(identity, res, rid)) return;
      const body = await readJson(req);
      const service = await getService(body.serviceId, identity.id);
      if (!service) return send(res, 404, { ok: false, error: "Service not found" }, rid);
      const domain = await createDomain({ ownerId: identity.id, serviceId: body.serviceId, hostname: body.hostname, tls: body.tls });
      const route = await createRoute({ ownerId: identity.id, serviceId: body.serviceId, hostname: body.hostname, targetPort: service.port });
      if (domain.status !== "active") await setRouteStatus(route.id, identity.id, "disabled");
      const linkedDomain = await attachDomainRoute(domain.id, identity.id, route.id);
      return send(res, 201, { ok: true, domain: linkedDomain || domain, route }, rid);
    }

    const domainMatch = url.pathname.match(/^\/v1\/cloud\/domains\/([^/]+)$/);
    if (domainMatch && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const domain = await getDomain(domainMatch[1], identity.id);
      return domain ? send(res, 200, { ok: true, domain }, rid) : send(res, 404, { ok: false, error: "Domain not found" }, rid);
    }

    if (domainMatch && req.method === "POST") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      if (!requireCloudBuild(identity, res, rid)) return;
      const body = await readJson(req);
      const domain = await setDomainStatus(domainMatch[1], identity.id, body.status);
      if (!domain) return send(res, 404, { ok: false, error: "Domain not found" }, rid);
      if (domain.routeId) await setRouteStatus(domain.routeId, identity.id, domain.status === "active" ? "active" : "disabled");
      return send(res, 200, { ok: true, domain }, rid);
    }

    if (url.pathname === "/v1/cloud/services/info" && req.method === "GET")
      return send(res, 200, { ok: true, ...serviceInfo() }, rid);

    if (url.pathname === "/v1/cloud/services" && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      return send(res, 200, { ok: true, services: listServices(identity.id) }, rid);
    }

    if (url.pathname === "/v1/cloud/services" && req.method === "POST") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      if (!requireCloudBuild(identity, res, rid)) return;
      const body = await readJson(req);
      const result = await executeAgentTool("cloud_service_create", body, identity, { approvalId: body.approvalId, requestId: rid });
      return send(res, 201, { ok: true, service: result }, rid);
    }

    const serviceMatch = url.pathname.match(/^\/v1\/cloud\/services\/([^/]+)$/);
    if (serviceMatch && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const service = await getService(serviceMatch[1], identity.id);
      return service ? send(res, 200, { ok: true, service }, rid) : send(res, 404, { ok: false, error: "Service not found" }, rid);
    }
    if (serviceMatch && req.method === "DELETE") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      if (!requireCloudBuild(identity, res, rid)) return;
      const service = await stopService(serviceMatch[1], identity.id);
      return service ? send(res, 200, { ok: true, service }, rid) : send(res, 404, { ok: false, error: "Service not found" }, rid);
    }
    const monitorMatch = url.pathname.match(/^\/v1\/cloud\/services\/([^/]+)\/monitor$/);
    if (monitorMatch && req.method === "POST") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      if (!requireCloudBuild(identity, res, rid)) return;
      const result = await monitorService(monitorMatch[1], identity.id);
      return result ? send(res, 200, { ok: true, ...result }, rid) : send(res, 404, { ok: false, error: "Service not found" }, rid);
    }

    const healthMatch = url.pathname.match(/^\/v1\/cloud\/services\/([^/]+)\/health$/);
    if (healthMatch && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const health = await checkService(healthMatch[1], identity.id);
      return health ? send(res, 200, { ok: true, ...health }, rid) : send(res, 404, { ok: false, error: "Service not found" }, rid);
    }

    if (url.pathname === "/v1/cloud/build/log-info" && req.method === "GET")
      return send(res, 200, { ok: true, ...buildLogInfo() }, rid);

    const buildDetailsMatch = url.pathname.match(/^\/v1\/cloud\/build\/([^/]+)$/);
    if (buildDetailsMatch && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const details = await getBuildDetails(buildDetailsMatch[1], identity.id);
      return details ? send(res, 200, { ok: true, build: details }, rid)
        : send(res, 404, { ok: false, error: "Build job not found" }, rid);
    }

    if (url.pathname === "/v1/usage" && req.method === "GET") {
      if (!adminAuthorized(req)) return send(res, 401, { ok: false, error: "Admin authentication required" }, rid);
      return send(res, 200, { ok: true, usage: await allUsage() }, rid);
    }

    if (url.pathname === "/v1/metrics" && req.method === "GET") {
      if (!adminAuthorized(req)) return send(res, 401, { ok: false, error: "Admin authentication required" }, rid);
      return send(res, 200, {
        ok: true,
        providers: await allProviderUsage(),
        timestamp: new Date().toISOString()
      }, rid);
    }

    if (url.pathname === "/v1/files" && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      return send(res, 200, { ok: true, files: await listFiles(identity.id) }, rid);
    }

    if (url.pathname === "/v1/files" && req.method === "POST") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const body = await readJson(req);
      const file = await createTextFile({
        ownerId: identity.id,
        name: body.name,
        text: body.text,
        mimeType: body.mimeType
      });
      return send(res, 201, { ok: true, file }, rid);
    }

    if (url.pathname === "/v1/files/search" && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      return send(res, 200, {
        ok: true,
        results: await searchFiles(identity.id, url.searchParams.get("q"), url.searchParams.get("limit"))
      }, rid);
    }

    if (url.pathname === "/v1/embeddings" && req.method === "GET") return send(res, 200, { ok: true, embedding: embeddingInfo() }, rid);

    if (url.pathname === "/v1/rag/search" && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      return send(res, 200, {
        ok: true,
        results: await searchRag(identity.id, url.searchParams.get("q"), url.searchParams.get("limit"), { mode: url.searchParams.get("mode") || "hybrid" })
      }, rid);
    }

    if (url.pathname === "/v1/rag/context" && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      return send(res, 200, {
        ok: true,
        ...(await ragContext(identity.id, url.searchParams.get("q"), url.searchParams.get("limit"), { mode: url.searchParams.get("mode") || "hybrid" }))
      }, rid);
    }

    if (url.pathname === "/v1/files/limits" && req.method === "GET")
      return send(res, 200, { ok: true, limits: fileLimits() }, rid);

    const fileMatch = url.pathname.match(/^\/v1\/files\/([^/]+)$/);
    if (fileMatch && req.method === "GET") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const file = await getFile(fileMatch[1], identity.id);
      return file ? send(res, 200, { ok: true, file }, rid) : send(res, 404, { ok: false, error: "File not found" }, rid);
    }

    if (fileMatch && req.method === "DELETE") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const deleted = await deleteFile(fileMatch[1], identity.id);
      return send(res, deleted ? 200 : 404, { ok: deleted }, rid);
    }

    if (url.pathname === "/v1/keys" && req.method === "GET") {
      if (!adminAuthorized(req)) return send(res, 401, { ok: false, error: "Admin authentication required" }, rid);
      return send(res, 200, { ok: true, keys: await listApiKeys() }, rid);
    }

    if (url.pathname === "/v1/keys" && req.method === "POST") {
      if (!adminAuthorized(req)) return send(res, 401, { ok: false, error: "Admin authentication required" }, rid);
      const body = await readJson(req);
      return send(res, 201, { ok: true, ...(await createApiKey(body.name || "app", body.scopes)) }, rid);
    }

    if (url.pathname.startsWith("/v1/keys/") && req.method === "DELETE") {
      if (!adminAuthorized(req)) return send(res, 401, { ok: false, error: "Admin authentication required" }, rid);
      const id = url.pathname.split("/").pop();
      const revoked = await revokeApiKey(id);
      return send(res, revoked ? 200 : 404, { ok: revoked }, rid);
    }

    if (url.pathname === "/v1/jobs" && req.method === "POST") {
      const providedKey = req.headers["x-bhai-key"];
      const identity = await authenticate(providedKey);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const body = await readJson(req);
      return send(res, 202, await enqueue(body.type || "generic", { ...(body.payload || {}), ownerId: identity.id }), rid);
    }

    const jobMatch = url.pathname.match(/^\/v1\/jobs\/([^/]+)$/);
    if (jobMatch && req.method === "GET") {
      const providedKey = req.headers["x-bhai-key"];
      const identity = await authenticate(providedKey);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const job = await getStoredJob(jobMatch[1], identity.id);
      return job ? send(res, 200, job, rid) : send(res, 404, { ok: false, error: "Job not found" }, rid);
    }

    if (url.pathname === "/v1/chat/completions/stream" && req.method === "POST") {
      const providedKey = req.headers["x-bhai-key"];
      const identity = await authenticate(providedKey);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);

      const body = await readJson(req);
      if (!Array.isArray(body.messages) || body.messages.length === 0)
        return send(res, 400, { ok: false, error: "messages must be a non-empty array" }, rid);

      const provider = String(body.provider || "").toLowerCase();
      const selected = provider || cfg.providerOrder.find(name => cfg.providers[name]?.key && providerAdapters[name + "Stream"]);
      const adapter = providerAdapters[selected + "Stream"];
      const providerCfg = cfg.providers[selected];
      const usageKey = identity.id;
      const inputChars = JSON.stringify(body).length;

      await assertBudget(usageKey, {
        maxRequests: process.env.BHAI_MAX_REQUESTS,
        maxInputChars: process.env.BHAI_MAX_INPUT_CHARS
      });

      if (!adapter || !providerCfg?.key)
        return send(res, 503, { ok: false, error: "No streaming provider is configured" }, rid);

      if (!canAttempt(selected))
        return send(res, 503, { ok: false, error: "Provider circuit is open", provider: selected }, rid);

      startSSE(res);
      sendEvent(res, { type: EVENTS.START, requestId: rid, provider: selected, model: providerCfg.model });

      const startedAt = Date.now();
      let emitted = false;
      let emittedChars = 0;
      let retries = 0;

      try {
        const result = await withRetry(
          async () => {
            try {
              return await adapter({
                ...providerCfg,
                messages: body.messages,
                temperature: body.temperature ?? 0.7,
                onToken: async token => {
                  emitted = true;
                  emittedChars += String(token ?? "").length;
                  sendEvent(res, tokenEvent(token));
                }
              });
            } catch (error) {
              if (emitted) {
                throw Object.assign(
                  new Error(error?.message || "Streaming failed after output started"),
                  { status: 400, code: "STREAM_PARTIAL_OUTPUT" }
                );
              }
              throw error;
            }
          },
          {
            retries: Number(process.env.BHAI_PROVIDER_RETRIES ?? 2),
            onRetry: () => { retries += 1; }
          }
        );

        const latencyMs = Date.now() - startedAt;
        recordSuccess(selected);
        await recordProviderUsage({
          provider: selected,
          success: true,
          latencyMs,
          retries
        });
        await recordUsage({
          key: usageKey,
          input: inputChars,
          output: String(result.text || "").length
        });

        sendEvent(res, completeEvent({
          provider: selected,
          model: providerCfg.model,
          attempts: retries + 1
        }));
        endSSE(res);
      } catch (error) {
        const latencyMs = Date.now() - startedAt;
        if (emitted) {
          error = Object.assign(new Error(error?.message || "Streaming failed after output started"), { status: 400 });
        }
        recordFailure(selected);
        await recordProviderUsage({
          provider: selected,
          success: false,
          latencyMs,
          retries,
          error
        });
        await recordUsage({
          key: usageKey,
          input: inputChars,
          output: emittedChars,
          failed: true
        });

        sendEvent(res, {
          ...errorEvent(error),
          kind: classifyError(error),
          retries
        });
        endSSE(res);
      }
      return;
    }

    if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
      const providedKey = req.headers["x-bhai-key"];
      const identity = await authenticate(providedKey);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const usageKey = identity.id;
      const body = await readJson(req);
      const inputChars = JSON.stringify(body).length;
      await assertBudget(usageKey);
      await assertBillingQuota(usageKey, { requests: 1, charsIn: inputChars });
      const result = await generate({
        messages: body.messages,
        provider: body.provider,
        temperature: body.temperature,
        maxAttempts: body.max_attempts
      });
      await recordUsage({
        key: usageKey,
        input: inputChars,
        output: String(result.text || "").length
      });
      await recordBillingUsage(usageKey, {
        requests: 1,
        charsIn: inputChars,
        charsOut: String(result.text || "").length
      });
      return send(res, 200, result, rid);
    }

    return send(res, 404, { ok: false, error: "Not found" }, rid);
  } catch (error) {
    await recordUsage({ key: req.headers["x-bhai-key"] || "anonymous", failed: true });
    return send(res, error.code === "BUDGET_EXCEEDED" || error.code === "BILLING_QUOTA_EXCEEDED" ? 429 : error.code === "PERMISSION_DENIED" ? 403 : error.code === "REQUEST_BODY_TOO_LARGE" ? 413 : error.code === "REQUEST_BODY_INVALID_JSON" ? 400 : 500, {
      ok: false, ...publicError(error), requestId: rid
    }, rid);
  }
});

const renewalScheduler = createRenewalScheduler({
  onError: error => console.error("BHAI-CORE ACME renewal sweep:", error?.message || error)
});
if (process.env.BHAI_ACME_ENABLED === "true") renewalScheduler.start();

server.listen(cfg.port, cfg.host, () => {
  console.log("BHAI-CORE listening on http://" + cfg.host + ":" + cfg.port);
});

const tlsServer = startTlsServer(server.listeners("request")[0]);
if (tlsServer) {
  console.log("BHAI-CORE TLS:", JSON.stringify(tlsInfo()));
}
