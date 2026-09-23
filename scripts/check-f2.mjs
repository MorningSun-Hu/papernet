import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyWsEvent, screenFromHttp } from "../web/shared/claim.ts";
import { MASK_C, buildStage, deviceIdFromPort } from "../web/shared/stage.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

assert.equal(MASK_C, "255.255.255.0");
assert.equal(deviceIdFromPort("S1/01"), "S1");
assert.equal(deviceIdFromPort("PC1/01"), "PC1");

const switchStage = buildStage(
  {
    id: "S1",
    kind: "switch",
    ports: [
      { id: "S1/01" },
      { id: "S1/02" },
      { id: "S1/03" },
      { id: "S1/04" },
    ],
  },
  [],
);
assert.equal(switchStage.overlayCount, 4);
assert.deepEqual(
  switchStage.ports.map((p) => p.portId),
  ["S1/01", "S1/02", "S1/03", "S1/04"],
);
assert.ok(switchStage.ports.every((p) => p.overlay));

const routerStage = buildStage(
  {
    id: "R1",
    kind: "router",
    ports: [{ id: "R1/01" }, { id: "R1/02" }],
  },
  [],
);
assert.equal(routerStage.overlayCount, 2);
assert.equal(routerStage.kind, "router");

const pcStage = buildStage(
  { id: "PC1", kind: "pc", ports: [{ id: "PC1/01" }] },
  [],
);
assert.equal(pcStage.overlayCount, 0);
assert.equal(pcStage.ports.length, 1);
assert.equal(pcStage.ports[0].overlay, false);
assert.equal(pcStage.ports[0].x, 18);
assert.equal(pcStage.ports[0].y, 62);

const tapStage = buildStage(
  {
    id: "TAP1",
    kind: "tap",
    ports: [{ id: "TAP1/01" }, { id: "TAP1/02" }],
  },
  [],
);
assert.equal(tapStage.overlayCount, 2);
assert.ok(tapStage.ports.every((p) => p.overlay));

const oneSided = buildStage(
  {
    id: "S1",
    kind: "switch",
    ports: [
      { id: "S1/01", peer_port_id: "R1/01" },
      { id: "S1/02" },
    ],
  },
  [
    {
      link_id: "L1",
      port_a: "S1/01",
      port_b: "R1/01",
      physically_up: false,
    },
  ],
);
assert.equal(oneSided.boxes.length, 1);
assert.equal(oneSided.boxes[0].peerDeviceId, "R1");
assert.equal(oneSided.boxes[0].peerPortId, "R1/01");
assert.equal(oneSided.ports[0].physicallyUp, false);
assert.equal(oneSided.ports[1].peerPortId, null);

const mutual = buildStage(
  {
    id: "S1",
    kind: "switch",
    ports: [{ id: "S1/01", peer_port_id: "R1/01" }],
  },
  [
    {
      link_id: "L1",
      port_a: "S1/01",
      port_b: "R1/01",
      physically_up: true,
    },
  ],
);
assert.equal(mutual.ports[0].physicallyUp, true);
assert.equal(mutual.boxes[0].physicallyUp, true);

const claimed = screenFromHttp(200, {
  ok: true,
  data: {
    status: "claimed",
    connection_id: "c1",
    device: {
      id: "S1",
      kind: "switch",
      ports: [{ id: "S1/01" }, { id: "S1/02" }],
    },
  },
});
const patched = applyWsEvent(claimed, {
  event: "topology.updated",
  ports: [{ id: "S1/01", peer_port_id: "PC1/01" }],
  links: [
    {
      link_id: "L2",
      port_a: "S1/01",
      port_b: "PC1/01",
      physically_up: false,
    },
  ],
});
assert.equal(patched.kind, "claimed");
assert.equal(patched.device.ports[0].peer_port_id, "PC1/01");
assert.equal(patched.links[0].physically_up, false);

const studentStage = fs.readFileSync(path.join(root, "web/student/src/stage.ts"), "utf8");
assert.ok(studentStage.includes("data-overlay"));
assert.ok(studentStage.includes("peer-device"));
assert.ok(studentStage.includes("peer-port"));
assert.ok(studentStage.includes("MASK_C"));
assert.ok(studentStage.includes("对端由教师挂接"));

const studentApi = fs.readFileSync(path.join(root, "web/student/src/api.ts"), "utf8");
assert.ok(studentApi.includes("/api/v1/devices/"));
assert.ok(studentApi.includes("encodeURIComponent(portId)"));
assert.ok(studentApi.includes("/api/v1/ports/peers"));

const studentMain = fs.readFileSync(path.join(root, "web/student/src/main.ts"), "utf8");
assert.ok(studentMain.includes("renderStage"));
assert.ok(studentMain.includes("putPort"));

console.log("F2 checks passed");
