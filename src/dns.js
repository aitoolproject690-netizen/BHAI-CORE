import crypto from "node:crypto";
import dns from "node:dns/promises";
import { getStore, updateStore } from "./store.js";

const STATUSES = new Set(["pending","published","verified","expired","failed"]);
const TYPES = new Set(["TXT","CNAME"]);
function pub(r){return {id:r.id,ownerId:r.ownerId,domainId:r.domainId,hostname:r.hostname,type:r.type,name:r.name,value:r.value,status:r.status,createdAt:r.createdAt,updatedAt:r.updatedAt};}
export async function createDnsChallenge({ownerId,domainId,hostname,type="TXT",name,value,ttl=300}={}) {
  if(!ownerId||!domainId||!hostname||!name||!value) throw Object.assign(new Error("ownerId, domainId, hostname, name and value required"),{code:"DNS_FIELDS_REQUIRED",status:400});
  if(!TYPES.has(type)) throw Object.assign(new Error("Unsupported DNS record type"),{code:"DNS_TYPE_INVALID",status:400});
  if(!Number.isInteger(ttl)||ttl<30||ttl>86400) throw Object.assign(new Error("Invalid DNS TTL"),{code:"DNS_TTL_INVALID",status:400});
  const id="dns_"+crypto.randomUUID(),now=new Date().toISOString();
  const rec={id,ownerId,domainId,hostname:hostname.toLowerCase(),type,name:name.toLowerCase(),value:String(value),ttl,status:"pending",createdAt:now,updatedAt:now};
  await updateStore(s=>{s.dnsRecords??={};s.dnsRecords[id]=rec;return s;}); return pub(rec);
}
export async function getDnsChallenge(id,ownerId){const s=await getStore(),r=s.dnsRecords?.[id];return r&&r.ownerId===ownerId?pub(r):null;}
export async function listDnsChallenges(ownerId){const s=await getStore();return Object.values(s.dnsRecords||{}).filter(r=>r.ownerId===ownerId).map(pub);}
export async function setDnsChallengeStatus(id,ownerId,status){if(!STATUSES.has(status))throw Object.assign(new Error("Invalid DNS status"),{code:"DNS_STATUS_INVALID",status:400});let found=false;await updateStore(s=>{const r=s.dnsRecords?.[id];if(!r||r.ownerId!==ownerId)return s;r.status=status;r.updatedAt=new Date().toISOString();found=true;return s;});return found?getDnsChallenge(id,ownerId):null;}
export async function verifyDnsChallenge(id,ownerId){
  const s=await getStore(),r=s.dnsRecords?.[id]; if(!r||r.ownerId!==ownerId)return null;
  let values=[];
  try { if(r.type==="TXT") values=(await dns.resolveTxt(r.name)).flat(); else values=await dns.resolveCname(r.name); }
  catch(error){await setDnsChallengeStatus(id,ownerId,"failed");return {verified:false,reason:"DNS_LOOKUP_FAILED",error:error.code||"DNS_ERROR"};}
  const verified=values.includes(r.value);
  await setDnsChallengeStatus(id,ownerId,verified?"verified":"pending");
  return {verified,record:pub(r),observed:values.slice(0,20)};
}
export function dnsInfo(){return{persistent:true,ownerScoped:true,recordTypes:[...TYPES],statuses:[...STATUSES],verification:"live DNS lookup",provider:"provider-neutral"};}
