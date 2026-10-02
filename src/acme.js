import crypto from "node:crypto";
import { getStore, updateStore } from "./store.js";
import { setCertificateStatus } from "./certificates.js";
import { generateAccountKey, encryptPrivateKey, decryptPrivateKey, cryptoInfo } from "./acmeCrypto.js";
import { fetchDirectory, registerAcmeAccount } from "./acmeProtocol.js";

function cfg(){return {
  enabled:process.env.BHAI_ACME_ENABLED==="true",
  directoryUrl:process.env.BHAI_ACME_DIRECTORY_URL||"https://acme-v02.api.letsencrypt.org/directory",
  email:process.env.BHAI_ACME_EMAIL||"",
  renewBeforeDays:Number(process.env.BHAI_ACME_RENEW_BEFORE_DAYS||30),
  pollMs:Number(process.env.BHAI_ACME_POLL_MS||5000)
};}

async function jsonFetch(url,options={},timeoutMs=10000){
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try { const res=await fetch(url,{...options,signal:controller.signal,headers:{"accept":"application/json","content-type":"application/jose+json",...(options.headers||{})}});
    const text=await res.text(); let body=null; try{body=text?JSON.parse(text):null;}catch{body=text;}
    if(!res.ok) throw Object.assign(new Error(`ACME HTTP ${res.status}`),{code:"ACME_HTTP_ERROR",status:res.status,body});
    return {headers:res.headers,body};
  } finally {clearTimeout(timer);}
}

export async function getAcmeDirectory(){
  const c=cfg(); if(!c.enabled) return {enabled:false,configured:false};
  if(!c.email) return {enabled:true,configured:false,reason:"BHAI_ACME_EMAIL missing"};
  const result=await jsonFetch(c.directoryUrl,{headers:{"accept":"application/json","content-type":"application/json"}});
  return {enabled:true,configured:true,directoryUrl:c.directoryUrl,endpoints:result.body};
}

export function acmeInfo(){const c=cfg();return {...c,crypto:cryptoInfo(),privateKeyStorage:"encrypted-at-rest",issuance:"staged integration",renewal:"scheduler-ready"};}

export async function createAcmeAccount({ownerId}={}){
  if(!ownerId) throw Object.assign(new Error("ownerId required"),{code:"ACME_OWNER_REQUIRED",status:400});
  const c=cfg(); if(!c.enabled) throw Object.assign(new Error("ACME is disabled"),{code:"ACME_DISABLED",status:503});
  if(!c.email) throw Object.assign(new Error("ACME email required"),{code:"ACME_EMAIL_REQUIRED",status:400});
  const id="acme_"+crypto.randomUUID(),now=new Date().toISOString();
  const key=generateAccountKey();
  const encryptedPrivateKey=encryptPrivateKey(key.privateKey);
  await updateStore(s=>{s.acmeAccounts??={};s.acmeAccounts[id]={id,ownerId,email:c.email,status:"pending",directoryUrl:c.directoryUrl,accountJwk:key.jwk,encryptedPrivateKey,createdAt:now,updatedAt:now};return s;});
  return {id,ownerId,email:c.email,status:"pending",directoryUrl:c.directoryUrl,createdAt:now,updatedAt:now};
}

export async function registerStoredAcmeAccount({id,ownerId}={}){
 const s=await getStore(),a=s.acmeAccounts?.[id]; if(!a||a.ownerId!==ownerId)return null;
 if(a.status==="registered"&&a.accountUrl)return {id:a.id,ownerId:a.ownerId,status:a.status,accountUrl:a.accountUrl};
 const c=cfg(); if(!c.enabled)throw Object.assign(new Error("ACME is disabled"),{code:"ACME_DISABLED",status:503});
 if(!c.email)throw Object.assign(new Error("ACME email required"),{code:"ACME_EMAIL_REQUIRED",status:400});
 const directory=await fetchDirectory(a.directoryUrl||c.directoryUrl);
 const privateKey=decryptPrivateKey(a.encryptedPrivateKey);
 try{
   const result=await registerAcmeAccount({directory,email:a.email,privateKey,jwk:a.accountJwk});
   await updateStore(s=>{const x=s.acmeAccounts?.[id];if(x){x.accountUrl=result.location;x.status="registered";x.updatedAt=new Date().toISOString();}return s;});
 }catch(error){
   await updateStore(s=>{const x=s.acmeAccounts?.[id];if(x){x.status="failed";x.lastError=error.message;x.updatedAt=new Date().toISOString();}return s;});
   throw error;
 }
 return (await listAcmeAccounts(ownerId)).find(x=>x.id===id)||null;
}
export async function getAcmeAccountSecrets(id,ownerId){
 const s=await getStore(),a=s.acmeAccounts?.[id]; if(!a||a.ownerId!==ownerId)return null;
 return {id:a.id,ownerId:a.ownerId,email:a.email,status:a.status,accountUrl:a.accountUrl||null,directoryUrl:a.directoryUrl,accountJwk:a.accountJwk,privateKey:a.encryptedPrivateKey?decryptPrivateKey(a.encryptedPrivateKey):null};
}
export async function listAcmeAccounts(ownerId){const s=await getStore();return Object.values(s.acmeAccounts||{}).filter(a=>a.ownerId===ownerId).map(({privateKey,encryptedPrivateKey,accountJwk,...a})=>({...a,accountJwkPresent:Boolean(accountJwk)}));}

export async function markCertificateRenewalIfDue(cert,ownerId,now=Date.now()){
  if(!cert?.expiresAt)return false; const due=Date.parse(cert.expiresAt)-now <= cfg().renewBeforeDays*86400000;
  if(due && cert.status==="active"){await setCertificateStatus(cert.id,ownerId,"renewing");return true;} return false;
}
export async function renewDueCertificates(ownerId,now=Date.now()){
  const s=await getStore(); const certs=Object.values(s.certificates||{}).filter(c=>c.ownerId===ownerId);
  let changed=0; for(const c of certs) if(await markCertificateRenewalIfDue(c,ownerId,now))changed++;
  return {checked:certs.length,markedRenewing:changed};
}
