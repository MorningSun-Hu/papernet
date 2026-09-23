import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const icons = path.join(root, "assets/icons");

function sizeOf(name) {
  return fs.statSync(path.join(icons, name)).size;
}

for (const name of ["switch.svg", "router.svg", "nic.svg", "rj45.svg"]) {
  assert.ok(fs.existsSync(path.join(icons, name)), `missing ${name}`);
}

assert.ok(sizeOf("switch.svg") < 40 * 1024, "switch.svg too large");
assert.ok(sizeOf("router.svg") < 40 * 1024, "router.svg too large");
assert.ok(sizeOf("nic.svg") < 40 * 1024, "nic.svg too large");
assert.ok(sizeOf("rj45.svg") < 8 * 1024, "rj45.svg too large");

for (const name of ["switch.svg", "router.svg", "nic.svg", "rj45.svg"]) {
  const text = fs.readFileSync(path.join(icons, name), "utf8");
  assert.equal(text.includes("source/"), false, `${name} must not reference source/`);
  assert.ok(text.length < 80_000, `${name} looks like a traced dump`);
}

for (const name of ["router.svg", "switch.svg", "pc.svg", "tap.svg"]) {
  assert.ok(fs.existsSync(path.join(icons, "logical", name)), `missing logical/${name}`);
}

for (const app of ["student", "teacher"]) {
  const cfg = fs.readFileSync(path.join(root, "web", app, "vite.config.ts"), "utf8");
  assert.ok(cfg.includes(".monkeycode-ai.online"), `${app} missing allowedHosts`);
  assert.ok(cfg.includes('"/api"'), `${app} missing /api proxy`);
  assert.ok(cfg.includes('"/ws"'), `${app} missing /ws proxy`);
  const main = fs.readFileSync(path.join(root, "web", app, "src/main.ts"), "utf8");
  assert.ok(main.includes("@icons/"), `${app} should load runtime icons`);
}

const studentMain = fs.readFileSync(path.join(root, "web/student/src/main.ts"), "utf8");
assert.ok(studentMain.includes("switch.svg"));
assert.ok(studentMain.includes("router.svg"));
assert.ok(studentMain.includes("nic.svg"));
assert.ok(studentMain.includes("rj45.svg"));

console.log("F0 checks passed");
