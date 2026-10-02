const buckets=new Map();
export function rateLimitInfo(){return{enabled:process.env.BHAI_RATE_LIMIT_ENABLED!=="false",windowMs:Number(process.env.BHAI_RATE_LIMIT_WINDOW_MS||60000),maxRequests:Number(process.env.BHAI_RATE_LIMIT_MAX||120)};}
export function checkRateLimit(key){const cfg=rateLimitInfo();if(!cfg.enabled)return{allowed:true};const now=Date.now();const k=String(key||"anonymous");let b=buckets.get(k);if(!b||now-b.startedAt>=cfg.windowMs)b={startedAt:now,count:0};b.count++;buckets.set(k,b);if(b.count>cfg.maxRequests)return{allowed:false,retryAfterMs:Math.max(1,cfg.windowMs-(now-b.startedAt))};return{allowed:true,remaining:Math.max(0,cfg.maxRequests-b.count)};}
export function resetRateLimits(){buckets.clear();}
