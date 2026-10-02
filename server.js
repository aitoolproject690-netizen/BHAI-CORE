import http from "node:http";
import { startTlsServer, tlsInfo } from "./src/tls.js";
import { config } from "./src/config.js";
import { generate, getProviderStatus } from "./src/router.js";
import { publicError } from "./src/errors.js";
import { requestId } from "./src/requestId.js";
import { recordUsage, getUsage, allUsage, allProviderUsage } from "./src/usage.js";
import { assertBudget } from "./src/budget.js";
import { authenticate, createApiKey, listApiKeys, revokeApiKey, rotateApiKey } from "./src/auth.js";
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
import { billingPlans, getBillingAccount, billingUsage, billingSnapshot, setBillingPlan, assertBillingQuota, consumeBillingQuota, releaseBillingQuota, recordBillingUsage } from "./src/billing.js";
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
import { authenticateMaster } from "./src/masterAuth.js";
import { sessionCookie, clearSessionCookie, authenticateSession } from "./src/dashboardAuth.js";

const cfg = config();

function send(res, status, body, rid) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "x-request-id": rid,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY"
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
  if (secretsEqual(req.headers["x-bhai-admin-key"], process.env.BHAI_CORE_ADMIN_KEY)) return true;
  if (!cfg.masterAuth.enabled) return false;
  return authenticateMaster(req, cfg.masterAuth.username, process.env.BHAI_CORE_PASSWORD)
    || authenticateSession(req, cfg.masterAuth.username);
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
  if (!rate.allowed) {
    res.setHeader("retry-after", String(Math.max(1, Math.ceil(Number(rate.retryAfterMs || 60000) / 1000))));
    return send(res,429,{ok:false,error:"Rate limit exceeded",retryAfterMs:rate.retryAfterMs},rid);
  }

  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type, authorization, x-bhai-key, x-bhai-admin-key",
        "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
        "access-control-max-age": "600"
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

    if (url.pathname === "/v1" && req.method === "GET") {
      return send(res, 200, {
        ok: true,
        service: "BHAI-CORE API",
        version: "0.1.0",
        message: "API is live. Use one of the endpoints below.",
        endpoints: {
          models: "/v1/models",
          providers: "/v1/providers",
          memory: "/v1/memory/info",
          embeddings: "/v1/embeddings",
          chat: "/v1/chat/completions",
          streamChat: "/v1/chat/completions/stream",
          files: "/v1/files",
          ragSearch: "/v1/rag/search",
          agentTools: "/v1/agent/tools",
          jobs: "/v1/jobs",
          keys: "/v1/keys"
        }
      }, rid);
    }

    if (url.pathname === "/login" && req.method === "GET") {
      if (!cfg.masterAuth.enabled) return send(res, 503, { ok:false, error:"Master authentication is not configured" }, rid);
      if (authenticateSession(req, cfg.masterAuth.username)) {
        res.writeHead(302, { location: "/dashboard", "cache-control": "no-store" });
        return res.end();
      }
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BHAI-CORE Login</title><style>
      *{box-sizing:border-box}body{margin:0;min-height:100vh;background:#080d18;color:#eef2ff;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:grid;place-items:center;padding:20px}
      .box{width:min(440px,100%);padding:24px;border:1px solid #24304a;border-radius:18px;background:#10182a;box-shadow:0 18px 60px #0005}.brand{font-size:25px;font-weight:800;margin-bottom:8px}p{color:#9da9c4;line-height:1.5}
      input,button{width:100%;padding:13px;margin-top:10px;border-radius:10px;border:1px solid #33415f;background:#0b1221;color:#eef2ff;font:inherit}button{cursor:pointer;background:#173d2a;border-color:#285c43}.error{color:#ffb5b5;margin-top:12px;min-height:20px}
      </style></head><body><main class="box"><div class="brand">🤖 BHAI-CORE</div><h1>Master Login</h1><p>Dashboard access ke liye master username aur password enter karo.</p>
      <form id="login"><input id="u" autocomplete="username" placeholder="Username" required><input id="p" type="password" autocomplete="current-password" placeholder="Password" required><button>Login</button><div id="e" class="error"></div></form>
      <script>document.getElementById("login").onsubmit=async(e)=>{e.preventDefault();const out=document.getElementById("e");out.textContent="Signing in…";try{const r=await fetch("/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:document.getElementById("u").value,password:document.getElementById("p").value})});const d=await r.json();if(!r.ok)throw new Error(d.error||"Login failed");location.href="/dashboard"}catch(err){out.textContent=String(err.message||err)}};</script></main></body></html>`;
      res.writeHead(200, {"content-type":"text/html; charset=utf-8","cache-control":"no-store"});
      return res.end(html);
    }

    if (url.pathname === "/login" && req.method === "POST") {
      if (!cfg.masterAuth.enabled) return send(res, 503, { ok:false, error:"Master authentication is not configured" }, rid);
      const body = await readJson(req, 100_000);
      const username = String(body.username || "");
      const password = String(body.password || "");
      const basic = "Basic " + Buffer.from(username + ":" + password, "utf8").toString("base64");
      const valid = authenticateMaster({ headers: { authorization: basic } }, cfg.masterAuth.username, process.env.BHAI_CORE_PASSWORD);
      if (!valid) return send(res, 401, { ok:false, error:"Invalid username or password" }, rid);
      res.writeHead(200, {"content-type":"application/json; charset=utf-8","cache-control":"no-store","set-cookie":sessionCookie(cfg.masterAuth.username),"x-request-id":rid});
      return res.end(JSON.stringify({ok:true}));
    }

    if (url.pathname === "/logout" && req.method === "POST") {
      res.writeHead(200, {"content-type":"application/json; charset=utf-8","cache-control":"no-store","set-cookie":clearSessionCookie(),"x-request-id":rid});
      return res.end(JSON.stringify({ok:true}));
    }

    if (url.pathname === "/dashboard" && req.method === "GET") {
      if (cfg.masterAuth.enabled && !authenticateSession(req, cfg.masterAuth.username)) {
        res.writeHead(302, { location: "/login", "cache-control": "no-store" });
        return res.end();
      }
      const providerStatus = getProviderStatus();
      const providerCards = Object.entries(providerStatus)
        .map(([name, info]) => {
          const state = info.configured ? "READY" : "NOT CONFIGURED";
          return '<div class="provider"><div><b>' + name.toUpperCase() + '</b><span class="pill ' + (info.configured ? 'ready' : '') + '">' + state + '</span></div><small>' + String(info.model || 'no model') + '</small></div>';
        }).join("");
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BHAI-CORE</title><style>
      *{box-sizing:border-box}body{margin:0;background:#080d18;color:#eef2ff;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
      main{max-width:980px;margin:auto;padding:24px 16px 40px}.top{display:flex;justify-content:space-between;align-items:center;gap:12px}.brand{font-size:26px;font-weight:800}.live{color:#7ee2a8;font-size:13px}
      h1{font-size:34px;margin:24px 0 6px}p{color:#9da9c4;margin-top:0}.section{margin-top:24px}.section h2{font-size:18px;margin:0 0 12px}
      .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}.card,.provider{display:block;padding:17px;border:1px solid #24304a;border-radius:16px;background:#10182a;color:#eef2ff;text-decoration:none}
      .card b{display:block;margin-bottom:7px}.url,small{color:#8fa0bf;font-size:13px;word-break:break-all}.provider>div{display:flex;justify-content:space-between;align-items:center;gap:8px}
      .pill{font-size:10px;padding:5px 8px;border-radius:999px;background:#2d2330;color:#ffb5b5}.pill.ready{background:#173d2a;color:#7ee2a8}
      .panel{padding:17px;border:1px solid #24304a;border-radius:16px;background:#10182a}.row{display:flex;gap:10px;flex-wrap:wrap}.row>*{flex:1;min-width:150px}
      input,button{width:100%;padding:12px;border-radius:10px;border:1px solid #33415f;background:#0b1221;color:#eef2ff;font:inherit}button{cursor:pointer;background:#173d2a;border-color:#285c43}
      pre{white-space:pre-wrap;word-break:break-word;background:#090f1c;padding:12px;border-radius:10px;color:#b9c8e8;min-height:20px}
      .note{margin-top:18px;padding:14px;border-radius:14px;background:#111c31;border:1px solid #273753;color:#b8c4dd;font-size:13px;line-height:1.5}
      </style></head><body><main><div class="top"><div class="brand">🤖 BHAI-CORE</div><div class="live">● LIVE</div></div>
      <h1>API Dashboard</h1><p>Core service, AI providers aur API keys ek jagah.</p>
      <div class="section"><h2>🔐 Master Access → API Key</h2><div class="panel"><p>Dashboard session authenticated hai. Master password browser mein store nahi hota.</p><div class="row"><input id="n" placeholder="Key name" value="my-app"></div><button id="create">Create API Key</button><button id="logout" style="margin-top:10px;background:#2d2330;border-color:#563746">Logout</button><pre id="out"></pre></div></div>
      <div class="section"><h2>🔑 API Keys</h2><div class="panel"><div class="row"><input id="limitReq" type="number" min="1" placeholder="Max requests (optional)"><input id="limitChars" type="number" min="1" placeholder="Max input chars (optional)"></div><button id="refreshKeys" style="margin-top:10px">Refresh Keys & Usage</button><div id="keys" style="margin-top:12px"></div></div></div>
      <div class="section"><h2>📊 Usage & Audit</h2><div class="grid"><a class="card" href="/v1/usage"><b>Usage API</b><span class="url">All key usage (admin)</span></a><a class="card" href="/v1/metrics"><b>Provider Metrics</b><span class="url">Latency, retries, failures</span></a><a class="card" href="/v1/audit"><b>Audit Log</b><span class="url">Recent admin/security events</span></a></div></div>
      <div class="section"><h2>AI Providers</h2><div class="grid">${providerCards}</div></div>
      <div class="section"><h2>Core</h2><div class="grid">
      <a class="card" href="/v1/models"><b>🤖 Models</b><span class="url">Configured model registry</span></a>
      <a class="card" href="/v1/providers"><b>🔌 Providers</b><span class="url">Provider status</span></a>
      <a class="card" href="/health"><b>❤️ Health</b><span class="url">Service health</span></a>
      <a class="card" href="/ready"><b>✅ Ready</b><span class="url">Readiness check</span></a>
      <a class="card" href="/v1"><b>📚 API Index</b><span class="url">All major API routes</span></a>
      </div></div>
      <div class="section"><h2>Engine Modules</h2><div class="grid">
      <div class="card"><b>💬 Chat + Streaming</b><span class="url">Provider router + SSE</span></div>
      <div class="card"><b>🧠 RAG + Memory</b><span class="url">Files, embeddings, conversations</span></div>
      <div class="card"><b>🛠️ Agent</b><span class="url">Tools, approvals, audit</span></div>
      <div class="card"><b>🖼️ Image</b><span class="url">ComfyUI adapter</span></div>
      <div class="card"><b>🎬 Video</b><span class="url">External video adapter</span></div>
      <div class="card"><b>🎙️ Voice + Vision</b><span class="url">Whisper/Piper + vision providers</span></div>
      <div class="card"><b>🐙 GitHub + Cloud</b><span class="url">Repository/build/deployment tools</span></div>
      <div class="card"><b>💳 Billing</b><span class="url">Plans, quota and usage foundation</span></div>
      </div></div>
      <div class="note">🔒 Master credentials are only used for the request. The generated API key is shown once; save it securely. Provider keys are never displayed here.</div>
      <script>
      document.getElementById("create").onclick=async()=>{const n=document.getElementById("n").value||"my-app",out=document.getElementById("out");out.textContent="Creating…";try{const r=await fetch("/v1/keys",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:n,limits:{maxRequests:Number(document.getElementById("limitReq").value)||undefined,maxInputChars:Number(document.getElementById("limitChars").value)||undefined}})});const d=await r.json();if(r.status===401){location.href="/login";return}out.textContent=r.ok?"API KEY (save now):\n"+d.key+"\n\nKey ID: "+d.id:JSON.stringify(d,null,2);loadKeys()}catch(e){out.textContent=String(e)}};document.getElementById("logout").onclick=async()=>{await fetch("/logout",{method:"POST"});location.href="/login"};
async function loadKeys(){const box=document.getElementById("keys");box.textContent="Loading…";try{const r=await fetch("/v1/keys");if(r.status===401){location.href="/login";return}const d=await r.json();if(!r.ok)throw new Error(d.error||"Failed");if(!d.keys.length){box.innerHTML="<p>No API keys yet.</p>";return}box.innerHTML=d.keys.map(k=>'<div class="card" style="margin-top:10px"><b>'+k.name+' <span class="pill '+(k.active?'ready':'')+'">'+(k.active?'ACTIVE':'REVOKED')+'</span></b><span class="url">ID: '+k.id+' · Created: '+k.createdAt+'</span><span class="url">Limits: '+JSON.stringify(k.limits||{})+' · Scopes: '+JSON.stringify(k.scopes||[])+'</span><div class="row" style="margin-top:10px"><button onclick="showUsage(\''+k.id+'\')">Usage</button>'+(k.active?'<button onclick="rotateKey(\''+k.id+'\')">Rotate</button><button onclick="revokeKey(\''+k.id+'\')" style="background:#2d2330;border-color:#563746">Revoke</button>':'')+'</div></div>').join("")}catch(e){box.textContent=String(e.message||e)}} 
async function showUsage(id){const r=await fetch("/v1/keys/"+id+"/usage");const d=await r.json();document.getElementById("out").textContent=r.ok?"Usage for "+id+":\n"+JSON.stringify(d.usage,null,2):JSON.stringify(d,null,2)}
async function rotateKey(id){if(!confirm("Rotate this key? Old key will stop working."))return;const r=await fetch("/v1/keys/"+id+"/rotate",{method:"POST"});const d=await r.json();document.getElementById("out").textContent=r.ok?"NEW API KEY (save now):\n"+d.key+"\n\nKey ID: "+d.id:JSON.stringify(d,null,2);loadKeys()}
async function revokeKey(id){if(!confirm("Revoke this key?"))return;const r=await fetch("/v1/keys/"+id,{method:"DELETE"});const d=await r.json();document.getElementById("out").textContent=JSON.stringify(d,null,2);loadKeys()}
document.getElementById("refreshKeys").onclick=loadKeys;loadKeys();</script></main></body></html>`;
      res.writeHead(200, {"content-type":"text/html; charset=utf-8","cache-control":"no-store"});
      return res.end(html);
    }

    if (url.pathname === "/" && req.method === "GET") {
      return send(res, 200, {
        ok: true,
        service: "BHAI-CORE",
        status: "live",
        version: "0.1.0",
        endpoints: { health: "/health", ready: "/ready", api: "/v1" }
      }, rid);
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

    if (cfg.masterAuth.enabled && !authenticateMaster(req, cfg.masterAuth.username, process.env.BHAI_CORE_PASSWORD)) {
      res.setHeader("www-authenticate", 'Basic realm="BHAI-CORE"');
      return send(res, 401, { ok: false, error: "Master username/password required" }, rid);
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
      if (process.env.WHISPER_ENABLED !== "true") return send(res, 503, { ok: false, error: "Local Whisper is not configured" }, rid);
      const billingReservation = { requests: 1, charsIn: request.audio.length };
      await consumeBillingQuota(identity.id, billingReservation);
      let result;
      try {
        result = await transcribeWhisper({ audio: request.audio, mimeType: request.mimeType, language: request.language, url: process.env.WHISPER_URL });
      } catch (error) {
        await releaseBillingQuota(identity.id, billingReservation);
        throw error;
      }
      await recordBillingUsage(identity.id, { charsOut: String(result.text || "").length });
      await recordUsage({ key: identity.id, input: request.audio.length, output: String(result.text || "").length });
      return send(res, 200, { ok: true, ...request, audio: undefined, ...result }, rid);
    }

    if (url.pathname === "/v1/voice/synthesize" && req.method === "POST") {
      const identity = await authenticate(req.headers["x-bhai-key"]);
      if (!identity) return send(res, 401, { ok: false, error: "BHAI key required" }, rid);
      const body = await readJson(req);
      const request = createTtsRequest(body);
      if (process.env.PIPER_ENABLED !== "true") return send(res, 503, { ok: false, error: "Local Piper is not configured" }, rid);
      const billingReservation = { requests: 1, charsIn: request.text.length };
      await consumeBillingQuota(identity.id, billingReservation);
      let result;
      try {
        result = await synthesizePiper({ text: request.text, voice: request.voice, language: request.language, url: process.env.PIPER_URL });
      } catch (error) {
        await releaseBillingQuota(identity.id, billingReservation);
        throw error;
      }
      await recordBillingUsage(identity.id, {});
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
      if (request.provider !== "comfyui") return send(res, 400, { ok: false, error: "Unsupported image provider" }, rid);
      const billingReservation = { requests: 1, imageJobs: 1 };
      await consumeBillingQuota(identity.id, billingReservation);
      let result;
      try {
        result = await submitComfyUI({
          url: process.env.COMFYUI_URL,
          request,
          workflow: body.workflow
        });
      } catch (error) {
        await releaseBillingQuota(identity.id, billingReservation);
        throw error;
      }
      await recordImageJobOwnership({ promptId: result.promptId, ownerId: identity.id, requestId: rid });
      await recordBillingUsage(identity.id, {});
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
      const billingReservation = { requests: 1, charsIn: String(body.prompt || "").length + String(imageInput).length };
      await consumeBillingQuota(identity.id, billingReservation);
      let result;
      try {
        result = await analyzeImage({
          provider: selected.provider,
          model: body.model || selected.model,
          key: providerCfg.key,
          url: providerCfg.url,
          prompt: body.prompt,
          image: body.image
        });
      } catch (error) {
        await releaseBillingQuota(identity.id, billingReservation);
        throw error;
      }
      await recordBillingUsage(identity.id, { charsOut: String(result.text || "").length });
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
      if (request.provider !== "http") return send(res, 400, { ok: false, error: "Unsupported video provider" }, rid);
      const billingReservation = { requests: 1, videoSeconds: request.durationSeconds };
      await consumeBillingQuota(identity.id, billingReservation);
      let result;
      try {
        result = await submitVideoHttp({ url: process.env.VIDEO_API_URL, apiKey: process.env.VIDEO_API_KEY, request });
      } catch (error) {
        await releaseBillingQuota(identity.id, billingReservation);
        throw error;
      }
      await recordBillingUsage(identity.id, {});
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

    if (url.pathname === "/v1/audit" && req.method === "GET") {
      if (!adminAuthorized(req)) return send(res, 401, { ok: false, error: "Admin authentication required" }, rid);
      const limit = url.searchParams.get("limit") || "100";
      return send(res, 200, { ok: true, audit: await listAudit({ limit }) }, rid);
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
      const created = await createApiKey(body.name || "app", body.scopes, body.limits);
      await recordAudit({ actorId: cfg.masterAuth.username || "admin", action: "api_key.create", tool: "keys", status: "success", requestId: rid, metadata: { keyId: created.id, name: created.name, limits: created.limits, scopes: created.scopes } });
      return send(res, 201, { ok: true, ...created }, rid);
    }

    if (url.pathname.match(/^\/v1\/keys\/([^/]+)\/rotate$/) && req.method === "POST") {
      if (!adminAuthorized(req)) return send(res, 401, { ok: false, error: "Admin authentication required" }, rid);
      const id = url.pathname.split("/")[3];
      const rotated = await rotateApiKey(id);
      if (!rotated) return send(res, 404, { ok: false, error: "Active API key not found" }, rid);
      await recordAudit({ actorId: cfg.masterAuth.username || "admin", action: "api_key.rotate", tool: "keys", status: "success", requestId: rid, metadata: { previousKeyId: id, newKeyId: rotated.id } });
      return send(res, 200, { ok: true, ...rotated }, rid);
    }

    const keyUsageMatch = url.pathname.match(/^\/v1\/keys\/([^/]+)\/usage$/);
    if (keyUsageMatch && req.method === "GET") {
      if (!adminAuthorized(req)) return send(res, 401, { ok: false, error: "Admin authentication required" }, rid);
      const id = keyUsageMatch[1];
      const key = (await listApiKeys()).find(item => item.id === id);
      if (!key) return send(res, 404, { ok: false, error: "API key not found" }, rid);
      return send(res, 200, { ok: true, key, usage: await getUsage(id) }, rid);
    }

    if (url.pathname.startsWith("/v1/keys/") && req.method === "DELETE") {
      if (!adminAuthorized(req)) return send(res, 401, { ok: false, error: "Admin authentication required" }, rid);
      const id = url.pathname.split("/").pop();
      const revoked = await revokeApiKey(id);
      if (!revoked) return send(res, 404, { ok: false }, rid);
      await recordAudit({ actorId: cfg.masterAuth.username || "admin", action: "api_key.revoke", tool: "keys", status: "success", requestId: rid, metadata: { keyId: id } });
      return send(res, 200, { ok: true }, rid);
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

      await assertBudget(usageKey, identity.limits, { requests: 1, inputChars });

      if (!adapter || !providerCfg?.key)
        return send(res, 503, { ok: false, error: "No streaming provider is configured" }, rid);

      if (!canAttempt(selected))
        return send(res, 503, { ok: false, error: "Provider circuit is open", provider: selected }, rid);

      const billingReservation = { requests: 1, charsIn: inputChars };
      await consumeBillingQuota(usageKey, billingReservation);

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
        await recordBillingUsage(usageKey, {
          charsOut: String(result.text || "").length
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
        if (!emitted) {
          await releaseBillingQuota(usageKey, billingReservation);
        }
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
      await assertBudget(usageKey, identity.limits, { requests: 1, inputChars });
      const billingReservation = { requests: 1, charsIn: inputChars };
      await consumeBillingQuota(usageKey, billingReservation);
      let result;
      try {
        result = await generate({
          messages: body.messages,
          provider: body.provider,
          temperature: body.temperature,
          maxAttempts: body.max_attempts
        });
      } catch (error) {
        await releaseBillingQuota(usageKey, billingReservation);
        throw error;
      }
      await recordUsage({
        key: usageKey,
        input: inputChars,
        output: String(result.text || "").length
      });
      await recordBillingUsage(usageKey, {
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