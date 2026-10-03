import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { updateStore, getStore, storageInfo } from "../src/store.js";

const postgresEnabled = process.env.BHAI_STORE_BACKEND === "postgres" && Boolean(process.env.DATABASE_URL);

test("PostgreSQL store persists and exposes backend metadata", { skip: !postgresEnabled }, async () => {
  const table = process.env.BHAI_STORE_PG_TABLE;
  assert.equal(storageInfo().backend, "postgres");
  await updateStore(s => ({ ...s, usage: { ...(s.usage || {}), probe: { requests: 2 } } }));
  const first = await getStore();
  assert.equal(first.usage.probe.requests, 2);
  await updateStore(s => ({ ...s, usage: { ...(s.usage || {}), probe: { requests: s.usage.probe.requests + 1 } } }));
  const second = await getStore();
  assert.equal(second.usage.probe.requests, 3);
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.BHAI_STORE_PG_SSL === "false" ? false : { rejectUnauthorized: false }
  });
  await client.connect();
  await client.query("DROP TABLE IF EXISTS " + table);
  await client.end();
});
