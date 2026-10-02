import crypto from "node:crypto";
import { createJws } from "./acmeCrypto.js";
const b64=v=>Buffer.from(v).toString("base64url").replace(/=+$/,"");
export function jwkThumbprint(jwk){const canonical=JSON.stringify({crv:jwk.crv,kty:jwk.kty,x:jwk.x,y:jwk.y});return b64(crypto.createHash("sha256").update(canonical).digest());}
async function request(url,options={},timeoutMs=10000){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);try{const res=await fetch(url,{...options,signal:controller.signal});const text=await res.text();let body=null;try{body=text?JSON.parse(text):null;}catch{body=text;}return {res,body};}finally{clearTimeout(timer);}}
export async function fetchDirectory(directoryUrl){const {res,body}=await request(directoryUrl,{headers:{accept:"application/json"}});if(!res.ok)throw Object.assign(new Error("ACME directory request failed"),{code:"ACME_DIRECTORY_ERROR",status:res.status,body});return body;}
export async function getReplayNonce(directory){const {res}=await request(directory.newNonce,{method:"HEAD",headers:{accept:"application/json"}});if(!res.ok)throw Object.assign(new Error("ACME nonce request failed"),{code:"ACME_NONCE_ERROR",status:res.status});const nonce=res.headers.get("replay-nonce");if(!nonce)throw Object.assign(new Error("ACME server returned no replay nonce"),{code:"ACME_NONCE_MISSING",status:502});return nonce;}
export async function signedPost({url,payload,privateKey,jwk,kid,directory,retryBadNonce=true}){let nonce=await getReplayNonce(directory);for(let attempt=0;attempt<2;attempt++){const protectedHeader={alg:"ES256",nonce,url};if(kid)protectedHeader.kid=kid;else protectedHeader.jwk=jwk;const jws=createJws({protectedHeader,payload,privateKey});const {res,body}=await request(url,{method:"POST",headers:{"content-type":"application/jose+json",accept:"application/json"},body:JSON.stringify(jws)});const nextNonce=res.headers.get("replay-nonce");if(res.ok)return {body,headers:res.headers,status:res.status};if(res.status===400&&/badNonce$/i.test(String(body?.type||""))&&retryBadNonce&&attempt===0){nonce=nextNonce||await getReplayNonce(directory);continue;}throw Object.assign(new Error("ACME signed POST failed: "+res.status),{code:"ACME_SIGNED_POST_ERROR",status:res.status,body});}}
export async function createAcmeOrder({directory,accountKey,accountUrl,identifiers}){const payload={identifiers:identifiers.map(value=>({type:"dns",value}))};const result=await signedPost({url:directory.newOrder,payload,privateKey:accountKey.privateKey,jwk:accountKey.jwk,kid:accountUrl,directory});const location=result.headers.get("location");return {location,body:result.body};}
export function parseAuthorization(body){const challenge=Array.isArray(body?.challenges)?body.challenges.find(c=>c.type==="dns-01"):null;return{url:body?.url||null,status:body?.status||null,identifier:body?.identifier?.value||null,expires:body?.expires||null,challenge:challenge?{type:challenge.type,url:challenge.url,token:challenge.token,status:challenge.status}:null};}
export function authorizationChallengeValue({token,jwk}){if(!token||!jwk)throw new Error("token and jwk required");return dns01KeyAuthorization(token,jwk);}
export async function getAcmeResource({url,accountKey,accountUrl,directory}){const result=await signedPost({url,payload:"",privateKey:accountKey.privateKey,jwk:accountKey.jwk,kid:accountUrl,directory});return result.body;}
export async function pollAcmeAuthorization({url,accountKey,accountUrl,directory,pollMs=5000,timeoutMs=120000}){
 const started=Date.now(); let last=null;
 while(Date.now()-started<=timeoutMs){
   last=await getAcmeResource({url,accountKey,accountUrl,directory});
   const status=String(last?.status||"").toLowerCase();
   if(status==="valid") return last;
   if(status==="invalid"||status==="deactivated"||status==="revoked") throw Object.assign(new Error("ACME authorization became "+status),{code:"ACME_AUTHORIZATION_"+status.toUpperCase(),status:409,body:last});
   await new Promise(resolve=>setTimeout(resolve,Math.max(0,pollMs)));
 }
 throw Object.assign(new Error("ACME authorization polling timed out"),{code:"ACME_AUTHORIZATION_TIMEOUT",status:504,body:last});
}
export async function finalizeAcmeOrder({url,csr,accountKey,accountUrl,directory}){return signedPost({url,payload:{csr},privateKey:accountKey.privateKey,jwk:accountKey.jwk,kid:accountUrl,directory});}
export async function pollAcmeOrder({url,accountKey,accountUrl,directory,pollMs=5000,timeoutMs=120000}){
 const started=Date.now(); let last=null;
 while(Date.now()-started<=timeoutMs){
   last=await getAcmeResource({url,accountKey,accountUrl,directory});
   const status=String(last?.status||"").toLowerCase();
   if(status==="valid") return last;
   if(status==="invalid") throw Object.assign(new Error("ACME order became invalid"),{code:"ACME_ORDER_INVALID",status:409,body:last});
   await new Promise(resolve=>setTimeout(resolve,Math.max(0,pollMs)));
 }
 throw Object.assign(new Error("ACME order polling timed out"),{code:"ACME_ORDER_TIMEOUT",status:504,body:last});
}
export async function downloadAcmeCertificate({url,accountKey,accountUrl,directory}){
 const body=await getAcmeResource({url,accountKey,accountUrl,directory});
 if(typeof body!=="string"||!body.includes("BEGIN CERTIFICATE")) throw Object.assign(new Error("ACME certificate response was not PEM"),{code:"ACME_CERTIFICATE_PEM_INVALID",status:502,body});
 return body;
}
export async function triggerAcmeChallenge({url,accountKey,accountUrl,directory}){return signedPost({url,payload:{},privateKey:accountKey.privateKey,jwk:accountKey.jwk,kid:accountUrl,directory});}
export async function registerAcmeAccount({directory,email,privateKey,jwk}){const payload={termsOfServiceAgreed:true,contact:["mailto:"+email]};const result=await signedPost({url:directory.newAccount,payload,privateKey,jwk,directory});const location=result.headers.get("location");if(!location)throw Object.assign(new Error("ACME account response missing Location"),{code:"ACME_ACCOUNT_LOCATION_MISSING",status:502});return {location,body:result.body};}
export function dns01KeyAuthorization(token,jwk){return b64(crypto.createHash("sha256").update(token+"."+jwkThumbprint(jwk)).digest());}
export function acmeProtocolInfo(){return{accountAlgorithm:"ES256",jws:"RFC8555-style",badNonceRetry:true,dns01KeyAuthorization:"sha256(base64url(JWK-thumbprint))"};}