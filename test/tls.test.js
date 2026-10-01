import test from "node:test";
import assert from "node:assert/strict";
import { tlsConfig, tlsInfo, loadTlsOptions } from "../src/tls.js";

test("TLS config is disabled by default", () => {
  const old = {
    enabled: process.env.BHAI_TLS_ENABLED,
    port: process.env.BHAI_TLS_PORT,
    cert: process.env.BHAI_TLS_CERT_FILE,
    key: process.env.BHAI_TLS_KEY_FILE
  };
  delete process.env.BHAI_TLS_ENABLED;
  delete process.env.BHAI_TLS_PORT;
  delete process.env.BHAI_TLS_CERT_FILE;
  delete process.env.BHAI_TLS_KEY_FILE;
  const cfg = tlsConfig();
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.port, 8443);
  assert.equal(tlsInfo().configured, false);
  if (old.enabled === undefined) delete process.env.BHAI_TLS_ENABLED; else process.env.BHAI_TLS_ENABLED = old.enabled;
  if (old.port === undefined) delete process.env.BHAI_TLS_PORT; else process.env.BHAI_TLS_PORT = old.port;
  if (old.cert === undefined) delete process.env.BHAI_TLS_CERT_FILE; else process.env.BHAI_TLS_CERT_FILE = old.cert;
  if (old.key === undefined) delete process.env.BHAI_TLS_KEY_FILE; else process.env.BHAI_TLS_KEY_FILE = old.key;
});

test("TLS options require certificate and key paths", () => {
  const oldEnabled = process.env.BHAI_TLS_ENABLED;
  const oldCert = process.env.BHAI_TLS_CERT_FILE;
  const oldKey = process.env.BHAI_TLS_KEY_FILE;
  process.env.BHAI_TLS_ENABLED = "true";
  delete process.env.BHAI_TLS_CERT_FILE;
  delete process.env.BHAI_TLS_KEY_FILE;
  assert.throws(() => loadTlsOptions(), error => error.code === "TLS_CERT_CONFIG_REQUIRED");
  if (oldEnabled === undefined) delete process.env.BHAI_TLS_ENABLED; else process.env.BHAI_TLS_ENABLED = oldEnabled;
  if (oldCert === undefined) delete process.env.BHAI_TLS_CERT_FILE; else process.env.BHAI_TLS_CERT_FILE = oldCert;
  if (oldKey === undefined) delete process.env.BHAI_TLS_KEY_FILE; else process.env.BHAI_TLS_KEY_FILE = oldKey;
});
