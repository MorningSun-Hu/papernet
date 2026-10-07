import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOGICAL_ICON_DIR,
  applyTopoEvent,
  arrangeTopo,
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
assert.match(teacherMain, /arrangeTopo/);
assert.match(teacherMain, /<h3>已领取<\/h3>/);
assert.match(teacherMain, /<h3>未领取<\/h3>/);
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
const r1 = view.nodes.find((n) => n.id === "R1");
const s1 = view.nodes.find((n) => n.id === "S1");
const pc1 = view.nodes.find((n) => n.id === "PC1");
const tap1 = view.nodes.find((n) => n.id === "TAP1");
assert.ok(r1 && s1 && pc1 && tap1);
assert.ok(r1.y < s1.y);
assert.ok(s1.y < pc1.y);
assert.ok(pc1.y < tap1.y);
assert.equal(r1.x, view.width / 2);
assert.equal(s1.x, view.width / 2);
assert.equal(pc1.x, view.width / 2);
assert.equal(tap1.x, view.width / 2);
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
assert.match(canvasSrc, /topo-wires/);
assert.match(canvasSrc, /topo-nodes/);
assert.match(canvasSrc, /data-claimed/);
assert.match(canvasSrc, /model-img/);
assert.match(canvasSrc, /TOPO_MODEL/);
const modelsSrc = fs.readFileSync(path.join(root, "web/shared/models.ts"), "utf8");
assert.match(modelsSrc, /topo-switch-icon\.svg/);
assert.match(modelsSrc, /topo-pc\.svg/);
const teacherCss = fs.readFileSync(path.join(root, "web/teacher/src/style.css"), "utf8");
assert.match(teacherCss, /\.topo-wires {[^}]*z-index:\s*0/);
assert.match(teacherCss, /\.topo-nodes {[^}]*z-index:\s*1/);
for (const name of ["topo-pc.svg", "topo-switch-icon.svg", "topo-router.svg", "topo-tap.svg"]) {
  const svg = fs.readFileSync(path.join(root, "assets/models", name), "utf8");
  assert.match(svg, /linearGradient/);
  assert.match(svg, /stroke-width="5/);
}
assert.match(fs.readFileSync(path.join(root, "assets/models/topo-router.svg"), "utf8"), /aria-label="路由器"/);
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

const numbered = parseTopoSnapshot({
  mode: "normal",
  devices: [
    { id: "PC10", kind: "pc", ports: [] },
    { id: "PC2", kind: "pc", ports: [] },
    { id: "PC1", kind: "pc", ports: [] },
    { id: "S1", kind: "switch", ports: [] },
    { id: "R1", kind: "router", ports: [] },
  ],
  links: [],
  tap_attach: [],
});
assert.ok(numbered);
const ordered = buildTopo(numbered);
const pcX = ["PC1", "PC2", "PC10"].map((id) => ordered.nodes.find((n) => n.id === id)?.x);
assert.ok(pcX[0] < pcX[1] && pcX[1] < pcX[2]);

const many = parseTopoSnapshot({
  mode: "normal",
  devices: Array.from({ length: 6 }, (_, i) => ({ id: `PC${i + 1}`, kind: "pc", ports: [] })).concat([
    { id: "S1", kind: "switch", ports: [] },
    { id: "R1", kind: "router", ports: [] },
  ]),
  links: [],
  tap_attach: [],
});
assert.ok(many);
const wrapped = buildTopo(many);
const pcYs = new Set(wrapped.nodes.filter((n) => n.kind === "pc").map((n) => n.y));
assert.equal(pcYs.size, 2);
assert.ok(wrapped.nodes.find((n) => n.id === "PC6")?.y > wrapped.nodes.find((n) => n.id === "PC1")?.y);

const crowd = parseTopoSnapshot({
  mode: "normal",
  devices: Array.from({ length: 48 }, (_, i) => ({ id: `PC${i + 1}`, kind: "pc", ports: [] })).concat([
    { id: "S1", kind: "switch", ports: [] },
    { id: "R1", kind: "router", ports: [] },
  ]),
  links: [],
  tap_attach: [],
});
assert.ok(crowd);
const crowded = buildTopo(crowd);
const crowdPcs = crowded.nodes.filter((n) => n.kind === "pc");
const crowdRows = new Set(crowdPcs.map((n) => n.y));
assert.ok(crowdRows.size <= 5);
const crowdFirstY = Math.min(...crowdPcs.map((n) => n.y));
assert.ok(crowdPcs.filter((n) => n.y === crowdFirstY).length >= 8);

const custom = buildTopo(snap, { PC1: { x: 40, y: 500 }, R1: { x: 200, y: 80 } });
assert.equal(custom.nodes.find((n) => n.id === "PC1")?.y, 500);
const arranged = arrangeTopo(snap);
const restored = buildTopo(snap, arranged);
assert.equal(arranged.PC1?.y, view.nodes.find((n) => n.id === "PC1")?.y);
assert.equal(arranged.R1?.y, view.nodes.find((n) => n.id === "R1")?.y);
assert.equal(restored.nodes.find((n) => n.id === "PC1")?.y, view.nodes.find((n) => n.id === "PC1")?.y);
assert.notEqual(arranged.PC1?.y, 500);

const clustered = parseTopoSnapshot({
  mode: "normal",
  devices: [
    { id: "R1", kind: "router", ports: [{ id: "R1/01", peer_port_id: "S1/01" }, { id: "R1/02", peer_port_id: "S2/01" }] },
    { id: "S1", kind: "switch", ports: [{ id: "S1/01", peer_port_id: "R1/01" }, { id: "S1/02", peer_port_id: "PC1/01" }, { id: "S1/03", peer_port_id: "PC3/01" }] },
    { id: "S2", kind: "switch", ports: [{ id: "S2/01", peer_port_id: "R1/02" }, { id: "S2/02", peer_port_id: "PC2/01" }, { id: "S2/03", peer_port_id: "PC4/01" }] },
    { id: "PC1", kind: "pc", ports: [{ id: "PC1/01", peer_port_id: "S1/02" }] },
    { id: "PC2", kind: "pc", ports: [{ id: "PC2/01", peer_port_id: "S2/02" }] },
    { id: "PC3", kind: "pc", ports: [{ id: "PC3/01", peer_port_id: "S1/03" }] },
    { id: "PC4", kind: "pc", ports: [{ id: "PC4/01", peer_port_id: "S2/03" }] },
    { id: "S3", kind: "switch", ports: [] },
    { id: "TAP1", kind: "tap", ports: [{ id: "TAP1/01" }] },
  ],
  links: [
    { link_id: "R1-S1", port_a: "R1/01", port_b: "S1/01", physically_up: true },
    { link_id: "R1-S2", port_a: "R1/02", port_b: "S2/01", physically_up: true },
    { link_id: "S1-PC1", port_a: "S1/02", port_b: "PC1/01", physically_up: true },
    { link_id: "S1-PC3", port_a: "S1/03", port_b: "PC3/01", physically_up: true },
    { link_id: "S2-PC2", port_a: "S2/02", port_b: "PC2/01", physically_up: true },
    { link_id: "S2-PC4", port_a: "S2/03", port_b: "PC4/01", physically_up: true },
  ],
  tap_attach: [],
});
assert.ok(clustered);
const clusteredView = buildTopo(clustered);
const n = Object.fromEntries(clusteredView.nodes.map((node) => [node.id, node]));
assert.ok(n.R1.y < n.S1.y && n.R1.y < n.S2.y);
assert.notEqual(n.S1.y, n.S2.y);
const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
assert.ok(Math.abs(d(n.S1, n.PC1) - d(n.S1, n.PC3)) > 20);
assert.ok(Math.abs(d(n.S2, n.PC2) - d(n.S2, n.PC4)) > 20);
assert.ok(d(n.S1, n.PC1) > 100 && d(n.S1, n.PC3) > 100);
assert.ok(Math.max(n.PC1.x, n.PC3.x) < Math.min(n.PC2.x, n.PC4.x));
assert.ok(n.S1.x < n.S2.x);
assert.equal(n.S3.y, n.TAP1.y);
assert.ok(n.S3.y > n.PC1.y);
assert.ok(n.S3.x < n.TAP1.x);

const draggedDown = buildTopo(snap, { TAP1: { x: tap1.x, y: tap1.y + 240 } });
assert.equal(draggedDown.width, view.width);
assert.equal(draggedDown.height, view.height);
assert.equal(draggedDown.nodes.find((node) => node.id === "PC1")?.x, pc1.x);
assert.equal(draggedDown.nodes.find((node) => node.id === "PC1")?.y, pc1.y);
assert.equal(draggedDown.nodes.find((node) => node.id === "TAP1")?.y, tap1.y + 240);

function orient(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}
function properCross(e1, e2) {
  const share =
    (e1.x1 === e2.x1 && e1.y1 === e2.y1) ||
    (e1.x1 === e2.x2 && e1.y1 === e2.y2) ||
    (e1.x2 === e2.x1 && e1.y2 === e2.y1) ||
    (e1.x2 === e2.x2 && e1.y2 === e2.y2);
  if (share) {
    return false;
  }
  const o1 = orient(e1.x1, e1.y1, e1.x2, e1.y2, e2.x1, e2.y1);
  const o2 = orient(e1.x1, e1.y1, e1.x2, e1.y2, e2.x2, e2.y2);
  const o3 = orient(e2.x1, e2.y1, e2.x2, e2.y2, e1.x1, e1.y1);
  const o4 = orient(e2.x1, e2.y1, e2.x2, e2.y2, e1.x2, e1.y2);
  return o1 * o2 < 0 && o3 * o4 < 0;
}
for (let i = 0; i < clusteredView.edges.length; i += 1) {
  for (let j = i + 1; j < clusteredView.edges.length; j += 1) {
    assert.equal(properCross(clusteredView.edges[i], clusteredView.edges[j]), false);
  }
}

console.log("F4 checks passed");
