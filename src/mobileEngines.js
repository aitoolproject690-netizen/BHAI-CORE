import crypto from "node:crypto";

const MAX_ENGINES = 64;
const MAX_NAME = 128;

const CAPABILITIES = new Set([
  "chat","vision","image-text-to-image","image-image-to-image",
  "video-image-to-video","video-text-to-video","vfx","audio","tts","stt"
]);

function clean(value,max=MAX_NAME){return String(value||"").trim().slice(0,max);}
function normalizeCapabilities(value){
  if(!Array.isArray(value)) return [];
  return [...new Set(value.map(x=>clean(x,64).toLowerCase()).filter(x=>CAPABILITIES.has(x)))];
}
function normalizeEngine(raw){
  if(!raw||typeof raw!=="object") return null;
  const id=clean(raw.id,128).toLowerCase();
  const name=clean(raw.name||id);
  if(!id||!name) return null;
  const capabilities=normalizeCapabilities(raw.capabilities);
  return {
    id,name,kind:clean(raw.kind||"local").toLowerCase(),
    model:clean(raw.model,256)||null,
    backend:clean(raw.backend,128)||null,
    capabilities,
    loaded:Boolean(raw.loaded),
    ready:Boolean(raw.ready),
    memory_mb:Number.isFinite(Number(raw.memory_mb))?Number(raw.memory_mb):null,
    updatedAt:new Date().toISOString()
  };
}

let registry=new Map();

export function updateMobileEngineRegistry(engines){
  if(!Array.isArray(engines)) throw new Error("engines must be an array");
  if(engines.length>MAX_ENGINES) throw new Error("too many engines");
  const next=new Map();
  for(const raw of engines){
    const item=normalizeEngine(raw);
    if(item) next.set(item.id,item);
  }
  registry=next;
  return listMobileEngines();
}

export function upsertMobileEngine(engine){
  const item=normalizeEngine(engine);
  if(!item) throw new Error("invalid mobile engine");
  registry.set(item.id,item);
  if(registry.size>MAX_ENGINES) registry.delete(registry.keys().next().value);
  return item;
}

export function listMobileEngines(){
  return [...registry.values()].map(item=>({...item,capabilities:[...item.capabilities]}));
}

export function mobileEngineInfo(){
  const engines=listMobileEngines();
  const capabilities=[...new Set(engines.flatMap(x=>x.capabilities))];
  return {ok:true,count:engines.length,capabilities,engines};
}

export function selectMobileEngine({capability,model}={}){
  const wanted=clean(capability,64).toLowerCase();
  const requestedModel=clean(model,256).toLowerCase();
  const candidates=listMobileEngines().filter(x=>x.ready&&(!wanted||x.capabilities.includes(wanted))&&(!requestedModel||String(x.model||"").toLowerCase()===requestedModel));
  candidates.sort((a,b)=>(Number(b.loaded)-Number(a.loaded))||(Number(a.memory_mb||Infinity)-Number(b.memory_mb||Infinity)));
  return candidates[0]||null;
}

export function mobileEngineRequestId(){return "meng-"+crypto.randomUUID();}
