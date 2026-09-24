import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOGICAL_ICON_DIR,
  applyTopoEvent,
  buildTopo,
  logicalIconFile,
  parseTopoSnapshot,
} from "../web/shared/topo.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

assert.equal(LOGICAL_ICON_DIR, "logical");
assert.equal(logicalIconFile("pc"), "logical/pc.svg");
assert.equal(logicalIconFile("switch"), "logical/switch.svg");
assert.equal(logicalIconFile("router"), "logical/router.svg");
assert.equal(logicalIconFile("tap"), "logical/tap.svg");

const teacherMain = fs.readFileSync(path.join(root, "web/teacher/src/main.ts"), "utf8");
assert.match(teacherMain, /logical\/router\.svg/);
assert.match(teacherMain, /setMode/);
assert.match(teacherMain, /attachTap/);
assert.match(teacherMain, /unbindDevice/);
assert.match(teacherMain, /contextmenu/);
assert.match(teacherMain, /解除绑定/);
assert.match(teacherMain, /挂接网络分流器/);
assert.equal(teacherMain.includes("!snap!.tapAttach.some"), false);
assert.match(teacherMain, /结束课堂/);
assert.match(teacherMain, /endClassroom/);
assert.match(teacherMain, /pointerdown/);
assert.match(teacherMain, /bindTopoDrag/);

assert.match(teacherMain, /网络分流器/);
assert.equal(teacherMain.includes("特殊双口交换机"), false);

const snap = parseTopoSnapshot({
  mode: "normal",
  devices: [
    { id: "PC1", kind: "pc", ports: [{ id: "PC1/01", ip: "192.168.1.10", peer_port_id: "S1/01" }] },
    {
      id: "S1",
      kind: "switch",
      ports: [
        { id: "S1/01", peer_port_id: "PC1/01" },
        { id: "S1/02", peer_port_id: "R1/01" },
      ],
    },
    {
      id: "R1",
      kind: "router",
      ports: [
        { id: "R1/01", ip: "192.168.1.1", peer_port_id: "S1/02" },
        { id: "R1/02", ip: "192.168.2.1" },
      ],
    },
    { id: "TAP1", kind: "tap", ports: [{ id: "TAP1/01" }, { id: "TAP1/02" }] },
  ],
  links: [
    { link_id: "PC1/01--S1/01", port_a: "PC1/01", port_b: "S1/01", physically_up: true },
    { link_id: "R1/01--S1/02", port_a: "S1/02", port_b: "R1/01", physically_up: false },
  ],
  tap_attach: [],
});
assert.ok(snap);
const view = buildTopo(snap);
const kinds = new Set(view.nodes.map((n) => n.kind));
const moved = buildTopo(snap, { PC1: { x: 12, y: 34 } });
assert.equal(moved.nodes.find((n) => n.id === "PC1")?.x, 12);
assert.equal(moved.nodes.find((n) => n.id === "PC1")?.y, 34);
assert.deepEqual([...kinds].sort(), ["pc", "router", "switch", "tap"]);
assert.ok(view.nodes.every((n) => n.labels[0] === n.id));
assert.ok(view.nodes.find((n) => n.id === "PC1")?.labels.some((l) => l.includes("PC1/01")));
assert.ok(view.nodes.find((n) => n.id === "R1")?.labels.some((l) => l.includes("192.168.1.1")));

const up = view.edges.find((e) => e.link_id === "PC1/01--S1/01");
const pending = view.edges.find((e) => e.link_id === "R1/01--S1/02");
assert.equal(up?.style, "up");
assert.equal(pending?.style, "pending");

const freeTap = view.nodes.find((n) => n.id === "TAP1");
assert.equal(freeTap?.onLink, null);

const hanging = applyTopoEvent(snap, {
  event: "topology.updated",
  tap_attach: { tap_id: "TAP1", link_id: "PC1/01--S1/01" },
});
const hung = buildTopo(hanging);
const tap = hung.nodes.find((n) => n.id === "TAP1");
assert.equal(tap?.onLink, "PC1/01--S1/01");
const edge = hung.edges.find((e) => e.link_id === "PC1/01--S1/01");
assert.ok(edge);
assert.equal(tap?.x, (edge.x1 + edge.x2) / 2);
assert.equal(tap?.y, (edge.y1 + edge.y2) / 2);

const sim = applyTopoEvent(snap, { event: "mode.changed", mode: "simulation" });
assert.equal(sim.mode, "simulation");

const canvasSrc = fs.readFileSync(path.join(root, "web/teacher/src/canvas.ts"), "utf8");
assert.match(canvasSrc, /data-claimed/);

const granted = applyTopoEvent(snap, {
  event: "claim.granted",
  device: { id: "PC1" },
});
assert.equal(granted.devices.find((d) => d.id === "PC1")?.claimed, true);
const freed = applyTopoEvent(granted, { event: "claim.released", device_id: "PC1" });
assert.equal(freed.devices.find((d) => d.id === "PC1")?.claimed, false);

console.log("F4 checks passed");
