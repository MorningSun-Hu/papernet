import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MSG_CLASSROOM_FULL,
  MSG_WAITING_OPEN,
  ROLE_SHELL,
  applyWsEvent,
  buildInventory,
  joinBody,
  screenFromHttp,
  wsPath,
} from "../web/shared/claim.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

assert.equal(MSG_WAITING_OPEN, "请等待教师确定本课设备");
assert.equal(MSG_CLASSROOM_FULL, "本课设备已领完，请看教师屏");

const waiting = screenFromHttp(200, {
  ok: true,
  data: {
    status: "waiting_open",
    connection_id: "conn-wait",
    message: MSG_WAITING_OPEN,
  },
});
assert.equal(waiting.kind, "waiting_open");
assert.equal(waiting.message, MSG_WAITING_OPEN);
assert.equal(waiting.connectionId, "conn-wait");

const claimed = screenFromHttp(200, {
  ok: true,
  data: {
    status: "claimed",
    connection_id: "conn-pc",
    device: { id: "PC1", kind: "pc", ports: [{ id: "PC1/01" }] },
  },
});
assert.equal(claimed.kind, "claimed");
assert.equal(ROLE_SHELL[claimed.device.kind], "pc");

for (const kind of ["switch", "router", "tap"]) {
  const screen = screenFromHttp(200, {
    ok: true,
    data: {
      status: "claimed",
      connection_id: `conn-${kind}`,
      device: { id: `${kind}-1`, kind, ports: [] },
    },
  });
  assert.equal(screen.kind, "claimed");
  assert.equal(screen.device.kind, kind);
  assert.equal(ROLE_SHELL[screen.device.kind], kind);
}

const full = screenFromHttp(409, {
  ok: false,
  data: { status: "full" },
  error: { code: "CLASSROOM_FULL", message: MSG_CLASSROOM_FULL },
});
assert.equal(full.kind, "full");
assert.equal(full.message, MSG_CLASSROOM_FULL);

const granted = applyWsEvent(waiting, {
  event: "claim.granted",
  device: { id: "S1", kind: "switch", ports: [{ id: "S1/01" }] },
});
assert.equal(granted.kind, "claimed");
assert.equal(granted.device.id, "S1");
assert.equal(granted.connectionId, "conn-wait");

const fullEvent = applyWsEvent(waiting, {
  event: "claim.full",
  message: MSG_CLASSROOM_FULL,
});
assert.equal(fullEvent.kind, "full");
assert.equal(fullEvent.message, MSG_CLASSROOM_FULL);

const firstJoin = joinBody();
assert.equal(firstJoin.client_kind, "student-hosted");
assert.equal(Object.hasOwn(firstJoin, "connection_id"), false);
assert.equal(Object.hasOwn(firstJoin, "join_code"), false);
assert.equal(joinBody("conn-wait").connection_id, "conn-wait");

const pathWs = wsPath("conn-wait");
assert.ok(pathWs.startsWith("/ws?"));
assert.ok(pathWs.includes("connection_id=conn-wait"));

const inventory = buildInventory({
  pcCount: 2,
  switchCount: 2,
  switchPorts: 4,
  routerCount: 1,
  routerPorts: 2,
  tapCount: 1,
});
assert.deepEqual(
  inventory.pcs.map((d) => d.id),
  ["PC1", "PC2"],
);
assert.deepEqual(
  inventory.switches.map((d) => d.id),
  ["S1", "S2"],
);
assert.equal(inventory.switches[0].port_count, 4);
assert.equal(inventory.routers[0].id, "R1");
assert.equal(inventory.routers[0].port_count, 2);
assert.equal(inventory.taps[0].id, "TAP1");

const studentMain = fs.readFileSync(path.join(root, "web/student/src/main.ts"), "utf8");
assert.ok(studentMain.includes("MSG_WAITING_OPEN"));
assert.ok(studentMain.includes("MSG_CLASSROOM_FULL"));
assert.ok(studentMain.includes("wsPath"));
assert.ok(studentMain.includes("data-kind"));

const studentApi = fs.readFileSync(path.join(root, "web/student/src/api.ts"), "utf8");
assert.ok(studentApi.includes("/api/v1/classrooms/join"));
assert.ok(studentApi.includes("joinBody"));
assert.ok(studentApi.includes("STORAGE_CONNECTION"));

const teacherApi = fs.readFileSync(path.join(root, "web/teacher/src/api.ts"), "utf8");
assert.ok(teacherApi.includes("/api/v1/classrooms"));
assert.ok(teacherApi.includes("open-claim"));
assert.ok(teacherApi.includes("buildInventory"));

const teacherMain = fs.readFileSync(path.join(root, "web/teacher/src/main.ts"), "utf8");
assert.ok(teacherMain.includes("创建课堂"));
assert.ok(teacherMain.includes("开放领取"));
assert.ok(teacherMain.includes("@icons/logical/"));

console.log("F1 checks passed");
