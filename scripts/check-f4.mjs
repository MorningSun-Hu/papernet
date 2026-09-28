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

function joins(edge, a, b) {
  const here = (x1, y1, n) => x1 === n.x && y1 === n.y;
  return (here(edge.x1, edge.y1, a) && here(edge.x2, edge.y2, b)) || (here(edge.x1, edge.y1, b) && here(edge.x2, edge.y2, a));
}

assert.equal(LOGICAL_ICON_DIR, "logical");
assert.equal(logicalIconFile("pc"), "logical/pc.svg");
assert.equal(logicalIconFile("switch"), "logical/switch.svg");
assert.equal(logicalIconFile("router"), "logical/router.svg");
assert.equal(logicalIconFile("tap"), "logical/tap.svg");

const teacherMain = fs.readFileSync(path.join(root, "web/teacher/src/main.ts"), "utf8");
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
assert.match(teacherMain, /bindTopoTools/);
assert.match(teacherMain, /data-topo-arrange/);
assert.match(teacherMain, /topoZoom/);
assert.match(teacherMain, /stepper\("routerPorts", "路由器口数", form.routerPorts, 1, 3\)/);

assert.match(teacherMain, /网络分流器/);
assert.equal(teacherMain.includes("特殊双口交换机"), false);
assert.match(teacherMain, /确定本课设备/);

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
const pc = hung.nodes.find((n) => n.id === "PC1");
const sw = hung.nodes.find((n) => n.id === "S1");
assert.ok(pc && sw && tap);
assert.equal(tap.x, (pc.x + sw.x) / 2);
assert.equal(tap.y, (pc.y + sw.y) / 2);
const hungSegs = hung.edges.filter((e) => e.link_id === "PC1/01--S1/01");
assert.equal(hungSegs.length, 2);
assert.equal(new Set(hungSegs.map((e) => e.id)).size, 2);
assert.ok(hungSegs.some((e) => joins(e, tap, pc)));
assert.ok(hungSegs.some((e) => joins(e, tap, sw)));
assert.equal(
  hung.edges.filter((e) => e.link_id === "R1/01--S1/02").length,
  1,
);

const dragged = buildTopo(hanging, { TAP1: { x: 40, y: 60 } });
const movedTap = dragged.nodes.find((n) => n.id === "TAP1");
const movedPc = dragged.nodes.find((n) => n.id === "PC1");
const movedSw = dragged.nodes.find((n) => n.id === "S1");
assert.ok(movedTap && movedPc && movedSw);
assert.equal(movedTap.x, 40);
assert.equal(movedTap.y, 60);
const draggedSegs = dragged.edges.filter((e) => e.link_id === "PC1/01--S1/01");
assert.ok(draggedSegs.some((e) => joins(e, movedTap, movedPc)));
assert.ok(draggedSegs.some((e) => joins(e, movedTap, movedSw)));

const sim = applyTopoEvent(snap, { event: "mode.changed", mode: "simulation" });
assert.equal(sim.mode, "simulation");

const canvasSrc = fs.readFileSync(path.join(root, "web/teacher/src/canvas.ts"), "utf8");
assert.match(canvasSrc, /data-claimed/);
assert.match(canvasSrc, /model-img/);
assert.match(canvasSrc, /TOPO_MODEL/);
const modelsSrc = fs.readFileSync(path.join(root, "web/shared/models.ts"), "utf8");
assert.match(modelsSrc, /topo-switch-icon\.svg/);
assert.match(modelsSrc, /topo-pc\.svg/);
assert.equal(canvasSrc.includes("logical/switch.svg"), false);
assert.match(canvasSrc, /data-topo-zoom/);
assert.match(canvasSrc, /整理/);
assert.equal(canvasSrc.includes("<image "), false);

const granted = applyTopoEvent(snap, {
  event: "claim.granted",
  device: { id: "PC1" },
});
assert.equal(granted.devices.find((d) => d.id === "PC1")?.claimed, true);
const freed = applyTopoEvent(granted, { event: "claim.released", device_id: "PC1" });
assert.equal(freed.devices.find((d) => d.id === "PC1")?.claimed, false);

assert.match(canvasSrc, /cssAttr\(edge\.id\)/);
assert.match(canvasSrc, /escapeAttr\(edge\.id\)/);

console.log("F4 checks passed");
