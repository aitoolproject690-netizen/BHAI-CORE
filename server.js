import http from "node:http";
import { config } from "./src/config.js";
import { generate, getProviderStatus } from "./src/router.js";
import { publicError } from "./src/errors.js";
import { requestId } from "./src/requestId.js";
import { recordUsage, allUsage } from "./src/usage.js";
import { assertBudget } from "./src/budget.js";
import { authenticate, createApiKey, listApiKeys, revokeApiKey } from "./src/auth.js";
import { startSSE, writeSSE, endSSE } from "./src/stream.js";
const cfg=config();
function send(res,status,body){res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store","access-control-allow-origin":"*"});res.end(JSON.stringify(body));}
function authorized(req){if(!cfg.apiKey)return true;return (req.headers.authorization||"")==="Bearer "+cfg.apiKey;}
async function readJson(req){let body="";for await(const chunk of req){body+=chunk;if(body.length>2000000)throw new Error("Request body too large");}return body?JSON.parse(body):{};}
const server=http.createServer(async(req,res)=>{
  try{
    if(req.method==="OPTIONS"){res.writeHead(204,{"access-control-allow-origin":"*","access-control-allow-headers":"content-type, authorization","access-control-allow-methods":"GET,POST,OPTIONS"});return res.end();}
    const url=new URL(req.url,"http://"+(req.headers.host||"localhost"));
    if(url.pathname==="/health"&&req.method==="GET")return send(res,200,{ok:true,service:"BHAI-CORE",version:"0.1.0",providers:getProviderStatus()});
    if(!authorized(req))return send(res,401,{ok:false,error:"Unauthorized"});
    if(url.pathname==="/v1/providers"&&req.method==="GET")return send(res,200,{ok:true,providers:getProviderStatus()});
    if(url.pathname==="/v1/chat/completions"&&req.method==="POST"){
      const body=await readJson(req);
      return send(res,200,await generate({messages:body.messages,provider:body.provider,temperature:body.temperature,maxAttempts:body.max_attempts}));
    }
    return send(res,404,{ok:false,error:"Not found"});
  }catch(error){recordUsage({ key: req.headers["x-bhai-key"] || "anonymous", failed: true });\n    return send(res, error.code === "BUDGET_EXCEEDED" ? 429 : 500, {ok:false,...publicError(error),requestId:rid});}
});
server.listen(cfg.port,cfg.host,()=>console.log("BHAI-CORE listening on http://"+cfg.host+":"+cfg.port));
