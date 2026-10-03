import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

test("mobile node source passes Node syntax check", () => {
  execFileSync(process.execPath, ["--check", "mobile/termux/bhai-mobile-node.mjs"], { stdio: "pipe" });
});

test("mobile Termux scripts pass bash syntax check", () => {
  for (const name of ["install.sh", "run-engine.sh", "start-node.sh"]) {
    execFileSync("bash", ["-n", "mobile/termux/" + name], { stdio: "pipe" });
  }
});

test("mobile installer references the BHAI bootstrap model", () => {
  const text = fs.readFileSync("mobile/termux/install.sh", "utf8");
  assert.match(text, /SmolLM2-135M-Instruct\.Q4_K_M\.gguf/);
  assert.match(text, /GGML_VULKAN|DGGML_VULKAN/);
});
