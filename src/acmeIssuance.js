import { getAcmeAccountSecrets } from "./acme.js";
import { getCertificate, getCertificateSecrets, prepareCertificateKey, setCertificateStatus } from "./certificates.js";
import { createAcmeOrder as createLocalOrder, getAcmeOrder, setAcmeOrderStatus, prepareDnsChallenge } from "./acmeOrder.js";
import { createAcmeOrder as protocolCreateOrder, fetchDirectory, getAcmeResource, parseAuthorization, triggerAcmeChallenge, pollAcmeAuthorization, finalizeAcmeOrder, pollAcmeOrder, downloadAcmeCertificate, dns01KeyAuthorization } from "./acmeProtocol.js";
import { getDnsChallenge, verifyDnsChallenge } from "./dns.js";
import { updateStore, getStore } from "./store.js";

const b64=v=>Buffer.from(v).toString("base64url").replace(/=+$/,"");

async function context(orderId,ownerId){
 const order=await getAcmeOrder(orderId,ownerId); if(!order)throw Object.assign(new Error("ACME order not found"),{code:"ACME_ORDER_NOT_FOUND",status:404});
 const accountId=(await getStore()).acmeOrders?.[orderId]?.accountId;
 const account=accountId?await getAcmeAccountSecrets(accountId,ownerId):null;
 if(!account?.privateKey||!account.accountUrl)throw Object.assign(new Error("Registered ACME account required"),{code:"ACME_ACCOUNT_REQUIRED",status:409});
 const cert=await getCertificate(order.certificateId,ownerId); if(!cert)throw Object.assign(new Error("Certificate not found"),{code:"ACME_CERTIFICATE_NOT_FOUND",status:404});
 const secrets=await getCertificateSecrets(cert.id,ownerId); if(!secrets?.privateKey)throw Object.assign(new Error("Certificate key not prepared"),{code:"ACME_CERTIFICATE_KEY_REQUIRED",status:409});
 const directory=await fetchDirectory(account.directoryUrl);
 return {order,account,cert,secrets,directory};
}

export async function startAcmeIssuance({ownerId,certificateId,accountId}={}){
 const cert=await getCertificate(certificateId,ownerId); if(!cert)throw Object.assign(new Error("Certificate not found"),{code:"ACME_CERTIFICATE_NOT_FOUND",status:404});
 const account=await getAcmeAccountSecrets(accountId,ownerId); if(!account?.privateKey||account.status!=="registered")throw Object.assign(new Error("Registered ACME account required"),{code:"ACME_ACCOUNT_REQUIRED",status:409});
 if(!(await getCertificateSecrets(certificateId,ownerId))?.privateKey) await prepareCertificateKey(certificateId,ownerId);
 const local=await createLocalOrder({ownerId,certificateId,hostname:cert.hostname,challenge:cert.challenge});
 const directory=await fetchDirectory(account.directoryUrl);
 const remote=await protocolCreateOrder({directory,accountKey:{privateKey:account.privateKey,jwk:account.accountJwk},accountUrl:account.accountUrl,identifiers:[cert.hostname]});
 const authorizationUrl=remote.body?.authorizations?.[0]; if(!remote.location||!authorizationUrl)throw Object.assign(new Error("ACME order missing authorization"),{code:"ACME_AUTHORIZATION_MISSING",status:502});
 const authorization=await getAcmeResource({url:authorizationUrl,accountKey:{privateKey:account.privateKey,jwk:account.accountJwk},accountUrl:account.accountUrl,directory});
 const parsed=parseAuthorization(authorization); if(!parsed.challenge||parsed.challenge.type!=="dns-01")throw Object.assign(new Error("ACME dns-01 challenge missing"),{code:"ACME_DNS_CHALLENGE_MISSING",status:502});
 const value=dns01KeyAuthorization(parsed.challenge.token,account.accountJwk);
 const record=await prepareDnsChallenge(local.id,ownerId,{recordName:"_acme-challenge."+cert.hostname,recordValue:value});
 await updateStore(s=>{const o=s.acmeOrders?.[local.id];if(o){o.accountId=accountId;o.orderUrl=remote.location;o.authorizationUrl=authorizationUrl;o.challengeUrl=parsed.challenge.url;o.challengeToken=parsed.challenge.token;o.remoteAuthorizationStatus=parsed.status;o.remoteExpiresAt=parsed.expires;o.updatedAt=new Date().toISOString();}return s;});
 return {order:await getAcmeOrder(local.id,ownerId),record,authorization:{status:parsed.status,expires:parsed.expires,challengeUrl:parsed.challenge.url,token:parsed.challenge.token},dnsValue:value};
}

export async function completeAcmeIssuance({orderId,ownerId}={}){
 const x=await context(orderId,ownerId);
 const record=await getDnsChallenge(x.order.challengeId,ownerId);
 if(!record||record.status!=="verified"){
   const verification=await verifyDnsChallenge(x.order.challengeId,ownerId);
   if(!verification?.verified) return {status:"waiting_dns",order:x.order,verification};
 }
 await triggerAcmeChallenge({url:x.order.challengeUrl,accountKey:{privateKey:x.account.privateKey,jwk:x.account.accountJwk},accountUrl:x.account.accountUrl,directory:x.directory});
 const auth=await pollAcmeAuthorization({url:x.order.authorizationUrl,accountKey:{privateKey:x.account.privateKey,jwk:x.account.accountJwk},accountUrl:x.account.accountUrl,directory:x.directory,pollMs:Number(process.env.BHAI_ACME_POLL_MS||5000),timeoutMs:Number(process.env.BHAI_ACME_TIMEOUT_MS||120000)});
 const orderRemote=await getAcmeResource({url:x.order.orderUrl,accountKey:{privateKey:x.account.privateKey,jwk:x.account.accountJwk},accountUrl:x.account.accountUrl,directory:x.directory});
 if(!orderRemote?.finalize)throw Object.assign(new Error("ACME order missing finalize URL"),{code:"ACME_FINALIZE_MISSING",status:502});
 const csr=x.secrets.csr || (await prepareCertificateKey(x.cert.id,ownerId)).csr;
 await setAcmeOrderStatus(orderId,ownerId,"processing",{remoteAuthorizationStatus:auth.status});
 await finalizeAcmeOrder({url:orderRemote.finalize,csr,accountKey:{privateKey:x.account.privateKey,jwk:x.account.accountJwk},accountUrl:x.account.accountUrl,directory:x.directory});
 const finalOrder=await pollAcmeOrder({url:x.order.orderUrl,accountKey:{privateKey:x.account.privateKey,jwk:x.account.accountJwk},accountUrl:x.account.accountUrl,directory:x.directory,pollMs:Number(process.env.BHAI_ACME_POLL_MS||5000),timeoutMs:Number(process.env.BHAI_ACME_TIMEOUT_MS||120000)});
 const pem=await downloadAcmeCertificate({url:finalOrder.certificate,accountKey:{privateKey:x.account.privateKey,jwk:x.account.accountJwk},accountUrl:x.account.accountUrl,directory:x.directory});
 const x509=new crypto.X509Certificate(pem);
 if(!x509.subject.includes("CN="+x.cert.hostname) && !x509.subjectAltName?.split(/,\s*/).some(v=>v.replace(/^DNS:/,"")===x.cert.hostname)) throw Object.assign(new Error("Issued certificate hostname mismatch"),{code:"ACME_CERTIFICATE_HOSTNAME_MISMATCH",status:502});
 const expiresAt=new Date(x509.validTo).toISOString();
 await updateStore(s=>{const c=s.certificates?.[x.cert.id];const o=s.acmeOrders?.[orderId];if(c){c.certificatePem=pem;c.status="active";c.expiresAt=expiresAt;c.lastError=null;c.updatedAt=new Date().toISOString();}if(o){o.status="valid";o.remoteStatus=finalOrder.status;o.updatedAt=new Date().toISOString();}return s;});
 return {status:"issued",order:await getAcmeOrder(orderId,ownerId),certificate:await getCertificate(x.cert.id,ownerId)};
}
export function acmeIssuanceInfo(){return{enabled:"ACME controlled by BHAI_ACME_ENABLED",dnsProviderMutation:false,flow:["account","newOrder","authorization","dns-01","challenge","authorization-poll","finalize","order-poll","certificate-download"],privateKeyEncryptedAtRest:true};}
