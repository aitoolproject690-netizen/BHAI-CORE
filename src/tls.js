import fs from "node:fs";
import https from "node:https";

function env(name, fallback = "") {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

export function tlsConfig() {
  return {
    enabled: env("BHAI_TLS_ENABLED", "false") === "true",
    host: env("BHAI_TLS_HOST", env("HOST", "0.0.0.0")),
    port: Number(env("BHAI_TLS_PORT", "8443")),
    certFile: env("BHAI_TLS_CERT_FILE"),
    keyFile: env("BHAI_TLS_KEY_FILE"),
    minVersion: env("BHAI_TLS_MIN_VERSION", "TLSv1.2")
  };
}

function validateConfig(cfg) {
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535)
    throw Object.assign(new Error("Invalid TLS port"), { code: "TLS_PORT_INVALID", status: 500 });
  if (!["TLSv1.2", "TLSv1.3"].includes(cfg.minVersion))
    throw Object.assign(new Error("Invalid TLS minimum version"), { code: "TLS_VERSION_INVALID", status: 500 });
  if (!cfg.certFile || !cfg.keyFile)
    throw Object.assign(new Error("BHAI_TLS_CERT_FILE and BHAI_TLS_KEY_FILE are required"), { code: "TLS_CERT_CONFIG_REQUIRED", status: 500 });
}

export function tlsInfo() {
  const cfg = tlsConfig();
  return {
    enabled: cfg.enabled,
    configured: Boolean(cfg.certFile && cfg.keyFile),
    host: cfg.host,
    port: cfg.port,
    minVersion: cfg.minVersion,
    certificateFilesConfigured: Boolean(cfg.certFile),
    privateKeyConfigured: Boolean(cfg.keyFile),
    termination: "local_https",
    certificateAutomation: "external"
  };
}

export function loadTlsOptions() {
  const cfg = tlsConfig();
  validateConfig(cfg);
  try {
    return {
      cert: fs.readFileSync(cfg.certFile),
      key: fs.readFileSync(cfg.keyFile),
      minVersion: cfg.minVersion
    };
  } catch (error) {
    throw Object.assign(new Error("Unable to read configured TLS certificate/key"), {
      code: "TLS_CERT_READ_FAILED",
      status: 500,
      cause: error
    });
  }
}

export function startTlsServer(requestHandler) {
  const cfg = tlsConfig();
  if (!cfg.enabled) return null;
  const options = loadTlsOptions();
  const server = https.createServer(options, requestHandler);
  server.listen(cfg.port, cfg.host, () => {
    console.log("BHAI-CORE HTTPS listening on https://" + cfg.host + ":" + cfg.port);
  });
  return server;
}
