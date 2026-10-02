import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import * as postgresStore from "./postgresStore.js";

const file = process.env.BHAI_STORE_FILE || "./data/bhai-core-store.json";
const maxBytes = Number(process.env.BHAI_STORE_MAX_BYTES || 10 * 1024 * 1024);
const backupEnabled = process.env.BHAI_STORE_BACKUP !== "false";
const emptyState = () => ({apiKeys:{},usage:{},providerUsage:{},billing:{},jobs:{},conversations:{},imageJobs:{},files:{},ragChunks:{},auditLog:[],approvals:{},services:{},deployments:{},servicePorts:{},routes:{},domains:{},autoDeploy:{},certificates:{},acmeAccounts:{},acmeOrders:{},dnsRecords:{}});
let state=emptyState(),loaded=false,writeChain=Promise.resolve();
function backend(){return (process.env.BHAI_STORE_BACKEND||"json").trim().toLowerCase();}
function assertBackend(){const value=backend();if(value!=="json"&&value!=="postgres")throw Object.assign(new Error("Unsupported BHAI_STORE_BACKEND: "+value),{code:"STORE_BACKEND_INVALID",status:500});return value;}
async function ensureJsonLoaded(){
  if(loaded)return;
  let raw;
  try{raw=await fs.readFile(file,"utf8");}catch(error){if(error.code==="ENOENT"){state=emptyState();loaded=true;return;}throw Object.assign(new Error("Persistent store could not be read"),{code:"STORE_READ_FAILED",status:500,cause:error});}
  let parsed;
  try{parsed=JSON.parse(raw);}catch(error){throw Object.assign(new Error("Persistent store contains invalid JSON"),{code:"STORE_CORRUPT",status:500,cause:error});}
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw Object.assign(new Error("Persistent store must contain a JSON object"),{code:"STORE_CORRUPT",status:500});
  const names=["apiKeys","usage","providerUsage","billing","jobs","conversations","imageJobs","files","ragChunks","approvals","services","deployments","servicePorts","routes","domains","autoDeploy","certificates","acmeAccounts","acmeOrders","dnsRecords"];
  for(const name of names)if(parsed[name]!=null&&(!parsed[name]||typeof parsed[name]!=="object"||Array.isArray(parsed[name])))throw Object.assign(new Error("Persistent store field "+name+" must be a JSON object"),{code:"STORE_CORRUPT",status:500});
  if(parsed.auditLog!=null&&!Array.isArray(parsed.auditLog))throw Object.assign(new Error("Persistent store field auditLog must be a JSON array"),{code:"STORE_CORRUPT",status:500});
  state={...emptyState(),...parsed,auditLog:parsed.auditLog??[]};loaded=true;
}
async function persistJson(snapshot){
  const serialized=JSON.stringify(snapshot,null,2),size=Buffer.byteLength(serialized,"utf8");
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1024)throw new Error("Invalid BHAI_STORE_MAX_BYTES configuration");
  if(size>maxBytes)throw Object.assign(new Error("Persistent store size limit exceeded"),{code:"STORE_SIZE_LIMIT",status:507,size,maxBytes});
  await fs.mkdir(path.dirname(file),{recursive:true});
  const tmp=file+"."+process.pid+"."+crypto.randomUUID()+".tmp";
  try{await fs.writeFile(tmp,serialized,{encoding:"utf8",mode:0o600});if(backupEnabled)try{await fs.copyFile(file,file+".bak");}catch(error){if(error.code!=="ENOENT")throw error;}await fs.rename(tmp,file);try{await fs.chmod(file,0o600);}catch{}}finally{try{await fs.unlink(tmp);}catch(error){if(error.code!=="ENOENT")throw error;}}
}
async function getJsonStore(){await ensureJsonLoaded();return state;}
async function saveJsonStore(next){await updateJsonStore(()=>structuredClone(next));return state;}
async function updateJsonStore(mutator){await ensureJsonLoaded();let result;const operation=writeChain.then(async()=>{const working=structuredClone(state),next=await mutator(working);state=next||working;await persistJson(state);result=state;});writeChain=operation.catch(()=>{});await operation;return result;}
export async function getStore(){return assertBackend()==="postgres"?postgresStore.getStore():getJsonStore();}
export async function saveStore(next){return assertBackend()==="postgres"?postgresStore.saveStore(next):saveJsonStore(next);}
export async function updateStore(mutator){return assertBackend()==="postgres"?postgresStore.updateStore(mutator):updateJsonStore(mutator);}
export function storageInfo(){return assertBackend()==="postgres"?postgresStore.storageInfo():{backend:"json",file,persistent:true,maxBytes,backupEnabled};}
export function resetStoreForTests(){if(backend()==="postgres")return postgresStore.resetStoreForTests();state=emptyState();loaded=true;writeChain=Promise.resolve();}
