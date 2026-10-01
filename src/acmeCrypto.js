import crypto from "node:crypto";

const ALGORITHM="aes-256-gcm";

function masterKey(){
  const raw=process.env.BHAI_ACME_MASTER_KEY;
  if(!raw) throw Object.assign(new Error("BHAI_ACME_MASTER_KEY is required for ACME key storage"),{code:"ACME_MASTER_KEY_REQUIRED",status:503});
  return crypto.createHash("sha256").update(raw).digest();
}
export function generateAccountKey(){
  const {publicKey,privateKey}=crypto.generateKeyPairSync("ec",{namedCurve:"prime256v1"});
  const jwk=publicKey.export({format:"jwk"});
  return {jwk,privateKey};
}
export function encryptPrivateKey(privateKey){
  const iv=crypto.randomBytes(12),key=masterKey(),cipher=crypto.createCipheriv(ALGORITHM,key,iv);
  const ciphertext=Buffer.concat([cipher.update(privateKey.export({format:"der",type:"pkcs8"})),cipher.final()]);
  return {algorithm:ALGORITHM,iv:iv.toString("base64url"),tag:cipher.getAuthTag().toString("base64url"),ciphertext:ciphertext.toString("base64url")};
}
export function decryptPrivateKey(record){
  const key=masterKey(),iv=Buffer.from(record.iv,"base64url"),dec=crypto.createDecipheriv(ALGORITHM,key,iv);
  dec.setAuthTag(Buffer.from(record.tag,"base64url"));
  const der=Buffer.concat([dec.update(Buffer.from(record.ciphertext,"base64url")),dec.final()]);
  return crypto.createPrivateKey({key:der,format:"der",type:"pkcs8"});
}
function b64(value){return Buffer.from(value).toString("base64url").replace(/=+$/,"");}
export function createJws({protectedHeader,payload,privateKey}){
  const protected64=b64(JSON.stringify(protectedHeader));
  const payload64=b64(typeof payload==="string"?payload:JSON.stringify(payload));
  const input=Buffer.from(protected64+"."+payload64);
  const signature=crypto.sign("sha256",input,{key:privateKey,dsaEncoding:"ieee-p1363"});
  return {protected:protected64,payload:payload64,signature:b64(signature)};
}
export function cryptoInfo(){return{accountKeyAlgorithm:"ES256",atRestEncryption:ALGORITHM,masterKeyRequired:true,privateKeyApiExposure:false};}
