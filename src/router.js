import { config } from "./config.js";
import { providerAdapters } from "./providers.js";
import { breakerState, canAttempt, recordFailure, recordSuccess } from "./circuitBreaker.js";
function isConfigured(name,cfg){ return Boolean(cfg.providers[name]?.key && providerAdapters[name]); }
export function getProviderStatus(){
  const cfg=config();
  return Object.fromEntries(Object.keys(providerAdapters).map(name => [name,{configured:isConfigured(name,cfg),model:cfg.providers[name].model,enabled:cfg.providerOrder.includes(name),breaker:breakerState(name)}]));
}
export async function generate({messages,provider,temperature=0.7,maxAttempts}={}){
  if(!Array.isArray(messages)||messages.length===0) throw new Error("messages must be a non-empty array");
  const cfg=config();
  const requested=provider?[String(provider).toLowerCase()]:cfg.providerOrder;
  const candidates=requested.filter(name=>isConfigured(name,cfg));
  if(!candidates.length) throw new Error("No AI provider is configured");
  const attempts=Math.min(maxAttempts||candidates.length,candidates.length);
  const errors=[];
  for(let i=0;i<attempts;i++){
    const name=candidates[i];
    try{
      const result=await providerAdapters[name]({...cfg.providers[name],messages,temperature});
      recordSuccess(name);\n      return {ok:true,provider:name,model:cfg.providers[name].model,text:result.text,attempts:i+1};
    }catch(error){ recordFailure(name); errors.push({provider:name,error:error.message}); }
  }
  const error=new Error("All configured AI providers failed");
  error.details=errors;
  throw error;
}
