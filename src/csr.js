import crypto from "node:crypto";

const oid=v=>{const parts=v.split(".").map(Number),out=[40*parts[0]+parts[1]];for(let i=2;i<parts.length;i++){let n=parts[i],bytes=[n&127];while(n>127){n>>=7;bytes.push((n&127)|128);}out.push(...bytes.reverse());}return Buffer.from(out);};
const tlv=(tag,value)=>{const b=Buffer.isBuffer(value)?value:Buffer.from(value);let len=b.length;const l=len<128?Buffer.from([len]):(()=>{const a=[];while(len){a.unshift(len&255);len>>=8;}return Buffer.from([0x80|a.length,...a]);})();return Buffer.concat([Buffer.from([tag]),l,b]);};
const seq=v=>tlv(0x30,v),set=v=>tlv(0x31,v),oidT=v=>tlv(0x06,oid(v)),utf8=v=>tlv(0x0c,v),oct=v=>tlv(0x04,v),bit=v=>tlv(0x03,Buffer.concat([Buffer.from([0]),v])),ctx0=v=>tlv(0xa0,v),ctx0Implicit=v=>tlv(0xa0,v),ctx2=v=>tlv(0x82,v);

export function createCertificateKey(){return crypto.generateKeyPairSync("ec",{namedCurve:"prime256v1"});}

export function createCsr({hostname,privateKey,publicKey,additionalNames=[]}={}){
 if(!hostname||!privateKey||!publicKey) throw Object.assign(new Error("hostname and key pair required"),{code:"CSR_FIELDS_REQUIRED",status:400});
 const names=[hostname,...additionalNames].map(String).map(v=>v.toLowerCase()).filter((v,i,a)=>a.indexOf(v)===i);
 const cn=seq(set(seq(Buffer.concat([oidT("2.5.4.3"),utf8(hostname)]))));
 const sanNames=seq(Buffer.concat(names.map(name=>ctx2(name))));
 const sanExt=seq(Buffer.concat([oidT("2.5.29.17"),oct(sanNames)]));
 const extensions=seq(sanExt);
 const extensionRequest=seq(Buffer.concat([oidT("1.2.840.113549.1.9.14"),set(extensions)]));
 const attributes=ctx0Implicit(extensionRequest);
 const cri=seq(Buffer.concat([tlv(0x02,Buffer.from([0])),cn,publicKey.export({format:"der",type:"spki"}),attributes]));
 const signature=crypto.sign("sha256",cri,{key:privateKey});
 const alg=seq(Buffer.concat([oidT("1.2.840.10045.4.3.2")]));
 return seq(Buffer.concat([cri,alg,bit(signature)]));
}
export function csrBase64Url(args){return createCsr(args).toString("base64url");}
export function csrInfo(){return{keyAlgorithm:"EC prime256v1",signatureAlgorithm:"ECDSA-SHA256",subjectAltName:true,format:"PKCS#10 DER/base64url"};}
