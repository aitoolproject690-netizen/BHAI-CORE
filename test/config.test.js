import test from "node:test";
import assert from "node:assert/strict";

import { config } from "../src/config.js";

const ORIGINAL = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL)) process.env[key] = value;
}

test("config accepts the default provider order", () => {
  try {
    delete process.env.AI_PROVIDER_ORDER;
    const cfg = config();
    assert.deepEqual(cfg.providerOrder, ["engine", "ollama", "gemini", "openai", "anthropic", "huggingface"]);
  } finally {
    restoreEnv();
  }
});

test("config rejects an unknown provider", () => {
  try {
    process.env.AI_PROVIDER_ORDER = "gemini,unknown-provider";
    assert.throws(() => config(), { code: "CONFIG_PROVIDER_ORDER_INVALID", status: 500 });
  } finally {
    restoreEnv();
  }
});

test("config rejects an empty provider order", () => {
  try {
    process.env.AI_PROVIDER_ORDER = " , ";
    assert.throws(() => config(), { code: "CONFIG_PROVIDER_ORDER_INVALID", status: 500 });
  } finally {
    restoreEnv();
  }
});

test("config rejects an empty host", () => {
  try {
    process.env.HOST = "   ";
    assert.throws(() => config(), { code: "CONFIG_HOST_INVALID", status: 500 });
  } finally {
    restoreEnv();
  }
});
