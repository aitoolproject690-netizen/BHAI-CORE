import http from "node:http";
import { startTlsServer, tlsInfo } from "./src/tls.js";
import { config } from "./src/config.js";
import { generate, getProviderStatus } from "./src/router.js";
import { publicError } from "./src/errors.js";
import { requestId } from "./src/requestId.js";
import { recordUsage, getUsage, allUsage, allProviderUsage } from "./src/usage.js";
import { assertBudget } from "./src/budget.js";
import { authenticate, createApiKey, listApiKeys, revokeApiKey, rotateApiKey, ensureBootstrapApiKey } from "./src/auth.js";
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
import { hasApiAccess } from "./src/access.js";

const cfg = config();
await ensureBootstrapApiKey(process.env.BHAI_CORE_BOOTSTRAP_API_KEY, process.env.BHAI_CORE_BOOTSTRAP_NAME || "BHAI-X");

function send(res, status, body, rid) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "x-request-id": rid,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY"