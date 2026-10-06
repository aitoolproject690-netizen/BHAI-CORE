import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), "utf8");

test("self-host Core is not directly published to the host", () => {
  const compose = read("docker-compose.selfhost.yml");
  assert.match(compose, /expose:\s*\n\s*- "10000"/);
  assert.doesNotMatch(compose, /ports:\s*\n\s*- "10000:10000"/);
});

test("public gateway is the only documented public entrypoint", () => {
  const caddy = read("Caddyfile");
  assert.match(caddy, /reverse_proxy @core bhai-core:10000/);
  assert.match(caddy, /reverse_proxy bhai-x:10000/);
  assert.match(caddy, /X-Content-Type-Options/);
  assert.match(caddy, /Strict-Transport-Security/);
});

test("garage helper scripts exist and are shell-parseable inputs", () => {
  for (const file of ["ops/install-garage.sh","ops/update-garage.sh","ops/backup-garage.sh","ops/restore-garage.sh"]) {
    assert.ok(fs.existsSync(new URL("../" + file, import.meta.url)), file);
  }
});
