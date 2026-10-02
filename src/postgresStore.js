import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
const table = process.env.BHAI_STORE_PG_TABLE || "bhai_core_store";
const id = 1;
const maxBytes = Number(process.env.BHAI_STORE_MAX_BYTES || 10 * 1024 * 1024);
const collectionNames = ["apiKeys","usage","providerUsage","billing","jobs","conversations","imageJobs","files","ragChunks","approvals","services","deployments","servicePorts","routes","domains","autoDeploy","certificates","acmeAccounts","acmeOrders","dnsRecords"];
const emptyState = () => ({apiKeys:{},usage:{},providerUsage:{},billing:{},jobs:{},conversations:{},imageJobs:{},files:{},ragChunks:{},auditLog:[],approvals:{},services:{},deployments:{},servicePorts:{},routes:{},domains:{},autoDeploy:{},certificates:{},acmeAccounts:{},acmeOrders:{},dnsRecords:{}});
function validateConfig() {
  if (!databaseUrl) throw Object.assign(new Error("DATABASE_URL is required for the PostgreSQL store"),{code:"STORE_DATABASE_URL_MISSING",status:500});
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) throw Object.assign(new Error("Invalid BHAI_STORE_PG_TABLE"),{code:"STORE_TABLE_INVALID",status:500});
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024) throw new Error("Invalid BHAI_STORE_MAX_BYTES configuration");
}
const pool = new Pool({connectionString:databaseUrl,max:Number(process.env.BHAI_STORE_PG_POOL_MAX||5),idleTimeoutMillis:Number(process.env.BHAI_STORE_PG_IDLE_TIMEOUT_MS||30000),connectionTimeoutMillis:Number(process.env.BHAI_STORE_PG_CONNECT_TIMEOUT_MS||10000),ssl:process.env.BHAI_STORE_PG_SSL==="false"?false:{rejectUnauthorized:false}});
let schemaPromise;
async function ensureSchema() {
  validateConfig();
  if (!schemaPromise) schemaPromise=pool.query("CREATE TABLE IF NOT EXISTS "+table+" (id INTEGER PRIMARY KEY CHECK (id = 1), state JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())").catch(error=>{schemaPromise=undefined;throw Object.assign(new Error("PostgreSQL store schema could not be initialized"),{code:"STORE_SCHEMA_FAILED",status:500,cause:error});});
  await schemaPromise;
}
function normalizeState(parsed) {
  if (!parsed || typeof parsed!=="object" || Array.isArray(parsed)) throw Object.assign(new Error("Persistent store must contain a JSON object"),{code:"STORE_CORRUPT",status:500});
  for (const name of collectionNames) if (parsed[name]!=null && (!parsed[name] || typeof parsed[name]!=="object" || Array.isArray(parsed[name]))) throw Object.assign(new Error("Persistent store field "+name+" must be a JSON object"),{code:"STORE_CORRUPT",status:500});
  if (parsed.auditLog!=null && !Array.isArray(parsed.auditLog)) throw Object.assign(new Error("Persistent store field auditLog must be a JSON array"),{code:"STORE_CORRUPT",status:500});
  return {...emptyState(),...parsed};
}
function validateSize(next) {
  const size=Buffer.byteLength(JSON.stringify(next),"utf8");
  if(size>maxBytes) throw Object.assign(new Error("Persistent store size limit exceeded"),{code:"STORE_SIZE_LIMIT",status:507,size,maxBytes});
}
export async function getStore() {
  await ensureSchema();
  const result=await pool.query("SELECT state FROM "+table+" WHERE id=$1",[id]);
  return result.rows[0]?normalizeState(result.rows[0].state):emptyState();
}
export async function saveStore(next) { return updateStore(()=>structuredClone(next)); }
export async function updateStore(mutator) {
  await ensureSchema();
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const result=await client.query("SELECT state FROM "+table+" WHERE id=$1 FOR UPDATE",[id]);
    const current=result.rows[0]?normalizeState(result.rows[0].state):emptyState();
    const working=structuredClone(current);
    const next=(await mutator(working))||working;
    const normalized=normalizeState(next);
    validateSize(normalized);
    await client.query("INSERT INTO "+table+" (id,state,updated_at) VALUES ($1,$2::jsonb,NOW()) ON CONFLICT (id) DO UPDATE SET state=EXCLUDED.state,updated_at=NOW()",[id,JSON.stringify(normalized)]);
    await client.query("COMMIT");
    return normalized;
  } catch(error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}
export function storageInfo() { return {backend:"postgres",persistent:true,table,maxBytes,poolMax:Number(process.env.BHAI_STORE_PG_POOL_MAX||5)}; }
export function resetStoreForTests() {}
