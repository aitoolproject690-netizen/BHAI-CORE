import crypto from "node:crypto";
import { getStore, updateStore } from "./store.js";
import { createDnsChallenge } from "./dns.js";
import { getCertificate } from "./certificates.js";
import { verifyDnsChallenge } from "./dns.js";
import { dns01KeyAuthorization } from "./acmeProtocol.js";

const ORDER_STATUSES=new Set(["pending","ready","processing","valid","invalid","failed"]);
const CHALLENGE_STATUSES=new Set(["pending","published","verified","failed"]);

function pubChallenge(c){return{id:c.id,orderId:c.orderId,type:c.type,url:c.url,status:c.status,recordName:c.recordName,createdAt:c.createdAt,updatedAt:c.updatedAt};}
function pubOrder(o){return{id:o.id,ownerId:o.ownerId,certificateId:o.certificateId,hostname:o.hostname,status:o.status,challenge:o.challenge,challengeId:o.challengeId,authorizationUrl:o.authorizationUrl,orderUrl:o.orderUrl,expiresAt:o.expiresAt,lastError:o.lastError,createdAt:o.createdAt,updatedAt:o.updatedAt};}
export function buildDns01RecordValue(token,jwk){return dns01KeyAuthorization(token,jwk);}

export async function createAcmeOrder({ownerId,certificateId,hostname,challenge="dns-01"}={}){
 if(!ownerId||!certificateId||!hostname)throw Object.assign(new Error("ownerId, certificateId and hostname required"),{code:"ACME_ORDER_FIELDS_REQUIRED",status:400});
 const cert=await getCertificate(certificateId,ownerId); if(!cert)throw Object.assign(new Error("Certificate not found for owner"),{code:"ACME_CERTIFICATE_NOT_FOUND",status:404});
 if(cert.hostname!==hostname.toLowerCase())throw Object.assign(new Error("Order hostname does not match certificate"),{code:"ACME_HOSTNAME_MISMATCH",status:409});
 if(!["dns-01","http-01"].includes(challenge))throw Object.assign(new Error("Unsupported challenge"),{code:"ACME_CHALLENGE_INVALID",status:400});
 const id="ord_"+crypto.randomUUID(), now=new Date().toISOString();
 const order={id,ownerId,certificateId,hostname:hostname.toLowerCase(),status:"pending",challenge,challengeId:null,authorizationUrl:null,orderUrl:null,expiresAt:null,lastError:null,createdAt:now,updatedAt:now};
 await updateStore(s=>{s.acmeOrders??={};s.acmeOrders[id]=order;return s;});
 return pubOrder(order);
}

export async function getAcmeOrder(id,ownerId){const s=await getStore(),o=s.acmeOrders?.[id];return o&&o.ownerId===ownerId?pubOrder(o):null;}
export async function listAcmeOrders(ownerId){const s=await getStore();return Object.values(s.acmeOrders||{}).filter(o=>o.ownerId===ownerId).map(pubOrder);}

export async function prepareDnsChallenge(orderId,ownerId,{recordName,recordValue}={}){
 const s=await getStore(),o=s.acmeOrders?.[orderId];if(!o||o.ownerId!==ownerId)return null;
 if(o.challenge!=="dns-01")throw Object.assign(new Error("Order is not using dns-01"),{code:"ACME_CHALLENGE_TYPE",status:409});
 const record=await createDnsChallenge({ownerId,domainId:(await getCertificate(o.certificateId,ownerId)).domainId,hostname:o.hostname,type:"TXT",name:recordName||"_acme-challenge."+o.hostname,value:recordValue||crypto.randomBytes(24).toString("base64url")});
 await updateStore(s=>{const x=s.acmeOrders?.[orderId];if(x){x.challengeId=record.id;x.status="ready";x.updatedAt=new Date().toISOString();}return s;});
 return {order:await getAcmeOrder(orderId,ownerId),record};
}

export async function verifyOrderDnsChallenge(orderId,ownerId){
 const s=await getStore(),o=s.acmeOrders?.[orderId]; if(!o||o.ownerId!==ownerId)return null;
 if(!o.challengeId)throw Object.assign(new Error("DNS challenge not prepared"),{code:"ACME_DNS_CHALLENGE_MISSING",status:409});
 const result=await verifyDnsChallenge(o.challengeId,ownerId);
 if(result?.verified) await updateStore(s=>{const x=s.acmeOrders?.[orderId];if(x){x.status="processing";x.updatedAt=new Date().toISOString();}return s;});
 return {order:await getAcmeOrder(orderId,ownerId),verification:result};
}
export async function setAcmeOrderStatus(id,ownerId,status,patch={}){
 if(!ORDER_STATUSES.has(status))throw Object.assign(new Error("Invalid ACME order status"),{code:"ACME_ORDER_STATUS_INVALID",status:400});
 let found=false;await updateStore(s=>{const o=s.acmeOrders?.[id];if(!o||o.ownerId!==ownerId)return s;o.status=status;Object.assign(o,patch);o.updatedAt=new Date().toISOString();found=true;return s;});
 return found?getAcmeOrder(id,ownerId):null;
}
export function acmeOrderInfo(){return{statuses:[...ORDER_STATUSES],challengeStatuses:[...CHALLENGE_STATUSES],realIssuance:"not enabled in this layer",privateKeyExposure:false};}
