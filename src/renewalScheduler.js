import { getStore } from "./store.js";
import { renewDueCertificates } from "./acme.js";

const DEFAULT_INTERVAL_MS = Number(process.env.BHAI_ACME_RENEWAL_INTERVAL_MS || 3600000);
const MIN_INTERVAL_MS = 60000;

export function renewalSchedulerInfo() {
  return { enabled: process.env.BHAI_ACME_ENABLED === "true", intervalMs: Math.max(MIN_INTERVAL_MS, DEFAULT_INTERVAL_MS), mode:"mark_due_and_expired", externalDnsRequired:true };
}

export async function runRenewalSweep(now = Date.now()) {
  const store = await getStore();
  const owners = new Set(Object.values(store.certificates || {}).map(c => c.ownerId).filter(Boolean));
  let checked=0, markedRenewing=0, markedExpired=0;
  for (const ownerId of owners) {
    const result=await renewDueCertificates(ownerId,now);
    checked+=result.checked; markedRenewing+=result.markedRenewing; markedExpired+=result.markedExpired||0;
  }
  return { checked, markedRenewing, markedExpired, owners:owners.size, at:new Date(now).toISOString() };
}

export function createRenewalScheduler({ intervalMs=DEFAULT_INTERVAL_MS, onError=()=>{} }={}) {
  const delay=Math.max(MIN_INTERVAL_MS,Number(intervalMs)||DEFAULT_INTERVAL_MS);
  let timer=null, running=false;
  async function tick(){ if(running)return; running=true; try{await runRenewalSweep();}catch(error){onError(error);}finally{running=false;} }
  return {
    start(){ if(timer)return; timer=setInterval(()=>{tick().catch(onError);},delay); if(typeof timer.unref==="function")timer.unref(); tick().catch(onError); },
    stop(){if(timer)clearInterval(timer);timer=null;},
    async runNow(){return runRenewalSweep();},
    info(){return {...renewalSchedulerInfo(),intervalMs:delay,running};}
  };
}
