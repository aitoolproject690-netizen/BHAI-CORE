import crypto from "node:crypto";
import { getStore, updateStore } from "./store.js";
import { createCertificateKey, createCsr } from "./csr.js";
import { encryptPrivateKey, decryptPrivateKey } from "./acmeCrypto.js";

const STATUSES = new Set(["pending","ready","active","renewing","expired","failed","revoked"]);
const CHALLENGE_TYPES = new Set(["http-01","dns-01"]);

function publicCert(c) {
  return {
    id:c.id, ownerId:c.ownerId, domainId:c.domainId, hostname:c.hostname,
    status:c.status, challenge:c.challenge, issuer:c.issuer || "acme",
    expiresAt:c.expiresAt || null, nextRenewalAt:c.nextRenewalAt || null,
    csr:c.csr || null,
    lastError:c.lastError || null, createdAt:c.createdAt, updatedAt:c.updatedAt
  };
}
function requireOwner(ownerId){ if(!ownerId) throw Object.assign(new Error("ownerId required"),{code:"CERT_OWNER_REQUIRED",status:400}); }

export async function prepareCertificateKey(id,ownerId){
 const s=await getStore(),c=s.certificates?.[id]; if(!c||c.ownerId!==ownerId)return null;
 const pair=createCertificateKey(); const csr=createCsr({hostname:c.hostname,...pair});
 const encryptedPrivateKey=encryptPrivateKey(pair.privateKey);
 await updateStore(s=>{const x=s.certificates?.[id];if(x){x.encryptedPrivateKey=encryptedPrivateKey;x.csr=csr.toString("base64url");x.status="ready";x.updatedAt=new Date().toISOString();}return s;});
 return {certificate:await getCertificate(id,ownerId),csr:csr.toString("base64url")};
}
export async function getCertificateSecrets(id,ownerId){
 const s=await getStore(),c=s.certificates?.[id]; if(!c||c.ownerId!==ownerId)return null;
 return {privateKey:c.encryptedPrivateKey?decryptPrivateKey(c.encryptedPrivateKey):null,csr:c.csr||null,certificatePem:c.certificatePem||null};
}
export async function createCertificate({ownerId,domainId,hostname,challenge="http-01",issuer="acme"}={}) {
  requireOwner(ownerId);
  if(!domainId || !hostname) throw Object.assign(new Error("domainId and hostname required"),{code:"CERT_FIELDS_REQUIRED",status:400});
  if(!CHALLENGE_TYPES.has(challenge)) throw Object.assign(new Error("Unsupported ACME challenge"),{code:"CERT_CHALLENGE_INVALID",status:400});
  const id="cert_"+crypto.randomUUID(), now=new Date().toISOString();
  const cert={id,ownerId,domainId,hostname:hostname.toLowerCase(),status:"pending",challenge,issuer,expiresAt:null,nextRenewalAt:null,lastError:null,createdAt:now,updatedAt:now};
  await updateStore(s=>{s.certificates??={};s.certificates[id]=cert;return s;});
  return publicCert(cert);
}
export async function getCertificate(id,ownerId){const s=await getStore(),c=s.certificates?.[id];return c&&c.ownerId===ownerId?publicCert(c):null;}
export async function listCertificates(ownerId){const s=await getStore();return Object.values(s.certificates||{}).filter(c=>c.ownerId===ownerId).map(publicCert);}
export async function setCertificateStatus(id,ownerId,status,patch={}) {
  if(!STATUSES.has(status)) throw Object.assign(new Error("Invalid certificate status"),{code:"CERT_STATUS_INVALID",status:400});
  let found=false;
  const safePatch = {};\n  for (const key of ["expiresAt","nextRenewalAt","lastError","issuer","challenge"]) {\n    if (Object.prototype.hasOwnProperty.call(patch || {}, key)) safePatch[key] = patch[key];\n  }\n  await updateStore(s=>{const c=s.certificates?.[id];if(!c||c.ownerId!==ownerId)return s;c.status=status;Object.assign(c,safePatch);c.updatedAt=new Date().toISOString();found=true;return s;});
  return found?getCertificate(id,ownerId):null;
}
export function certificateInfo(){return{persistent:true,ownerScoped:true,statuses:[...STATUSES],challengeTypes:[...CHALLENGE_TYPES],automation:"ACME-ready foundation; issuer integration external"};}
