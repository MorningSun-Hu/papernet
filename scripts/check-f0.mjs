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

for (const name of ["switch-many.svg", "pc-front.svg", "pc-back.svg"]) {
  assert.ok(fs.existsSync(path.join(icons, name)), `missing ${name}`);
  assert.ok(sizeOf(name) < 40 * 1024, `${name} too large`);
}

for (const name of ["switch.svg", "router.svg", "nic.svg", "rj45.svg", "switch-many.svg", "pc-front.svg", "pc-back.svg"]) {
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
  assert.ok(cfg.includes("@models"), `${app} missing @models alias`);
}

const studentMain = fs.readFileSync(path.join(root, "web/student/src/main.ts"), "utf8");
assert.equal(studentMain.includes("@icons/"), false, "student runtime should not load device SVGs");
const teacherMain = fs.readFileSync(path.join(root, "web/teacher/src/main.ts"), "utf8");
assert.equal(teacherMain.includes("@icons/"), false, "teacher runtime should not load device SVGs");
assert.ok(fs.existsSync(path.join(root, "web/shared/brand.ts")));
const brand = fs.readFileSync(path.join(root, "web/shared/brand.ts"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "web/teacher/package.json"), "utf8"));
assert.ok(brand.includes(`APP_VERSION = "${pkg.version}"`), "brand version must match package.json");
assert.ok(teacherMain.includes("hudVersion"));
assert.ok(studentMain.includes("hudVersion"));
const packWin = fs.readFileSync(path.join(root, "scripts/pack-windows.sh"), "utf8");
assert.ok(packWin.includes("echo PaperNet 教室  版本 {version}"));
for (const label of ["实验环境", "网络拓扑", "工具箱", "帮助文档"]) {
  assert.ok(brand.includes(label), `studentNav missing ${label}`);
}
const studentNavFn = brand.slice(brand.indexOf("export function studentNav"), brand.indexOf("export function teacherNav"));
assert.equal(studentNavFn.includes("实验台"), false);
assert.equal(studentNavFn.includes("拓扑视图"), false);
const studentStage = fs.readFileSync(path.join(root, "web/student/src/stage.ts"), "utf8");
assert.ok(studentStage.includes("@models/") || studentStage.includes("CHASSIS"));
assert.ok(studentStage.includes("chassis-img"));
assert.equal(studentStage.includes("metal-chassis"), false);
for (const name of ["pc-front.png", "pc-back.png", "tap.png", "switch.png", "router.png", "topo-pc.png", "topo-switch.png", "topo-tap.png", "topo-router.png"]) {
  assert.ok(fs.existsSync(path.join(root, "assets/models", name)), `missing models/${name}`);
}
function pngSize(file) {
  const buf = fs.readFileSync(file);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
const frontSize = pngSize(path.join(root, "assets/models/pc-front.png"));
const backSize = pngSize(path.join(root, "assets/models/pc-back.png"));
assert.equal(backSize.w, frontSize.w, "pc-back width must match pc-front");
assert.equal(backSize.h, frontSize.h, "pc-back height must match pc-front");
assert.ok(fs.readFileSync(path.join(root, "web/shared/stage.ts"), "utf8").includes("x: 19.15, y: 77.39"));

for (const name of ["topo-pc.svg", "topo-switch.svg", "topo-tap.svg", "topo-router.svg", "topo-switch-icon.svg", "topo-switch-icon.png"]) {
  assert.ok(fs.existsSync(path.join(root, "assets/models", name)), `missing models/${name}`);
}

console.log("F0 checks passed");
