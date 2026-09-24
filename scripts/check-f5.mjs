import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLIENT_KIND_HOSTED,
  CLIENT_KIND_STANDALONE,
  joinBody,
  studentClientFromSearch,
  studentUiUrl,
  targetClassroomInventory,
} from "../web/shared/claim.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const nginx = fs.readFileSync(path.join(root, "deploy/nginx.conf"), "utf8");
assert.match(nginx, /location \/teacher\//);
assert.match(nginx, /location \/student\//);
assert.match(nginx, /try_files \$uri \$uri\/ \/teacher\/index\.html/);
assert.match(nginx, /try_files \$uri \$uri\/ \/student\/index\.html/);

const teacherPkg = fs.readFileSync(path.join(root, "web/teacher/package.json"), "utf8");
const studentPkg = fs.readFileSync(path.join(root, "web/student/package.json"), "utf8");
assert.match(teacherPkg, /vite build --base \/teacher\//);
assert.match(studentPkg, /vite build --base \/student\//);

const buildWeb = fs.readFileSync(path.join(root, "scripts/build-web.sh"), "utf8");
assert.match(buildWeb, /--base \/teacher\//);
assert.match(buildWeb, /--base \/student\//);

const studentRs = fs.readFileSync(path.join(root, "crates/student/src/lib.rs"), "utf8");
assert.match(studentRs, /fn student_ui_url/);
assert.match(studentRs, /\/student\/\?client_kind=student-standalone/);
assert.match(studentRs, /open \{\}/);

const studentApi = fs.readFileSync(path.join(root, "web/student/src/api.ts"), "utf8");
assert.match(studentApi, /currentStudentClient/);
assert.match(studentApi, /client\.kind/);
assert.match(studentApi, /client\.nicMac/);

const teacherMain = fs.readFileSync(path.join(root, "web/teacher/src/main.ts"), "utf8");
assert.match(teacherMain, /target-scene/);
assert.match(teacherMain, /targetClassroomInventory/);

assert.equal(joinBody().client_kind, CLIENT_KIND_HOSTED);
assert.equal(Object.hasOwn(joinBody(), "nic_mac"), false);
const standaloneJoin = joinBody(null, CLIENT_KIND_STANDALONE, "aa:bb:cc:dd:ee:10");
assert.equal(standaloneJoin.client_kind, CLIENT_KIND_STANDALONE);
assert.equal(standaloneJoin.nic_mac, "aa:bb:cc:dd:ee:10");

const fromSearch = studentClientFromSearch(
  "?client_kind=student-standalone&nic_mac=aa:bb:cc:dd:ee:10&connection_id=n-1",
);
assert.equal(fromSearch.kind, CLIENT_KIND_STANDALONE);
assert.equal(fromSearch.nicMac, "aa:bb:cc:dd:ee:10");
assert.equal(fromSearch.connectionId, "n-1");

assert.equal(
  studentUiUrl("http://127.0.0.1:8080/", "aa:bb:cc:dd:ee:10", "n-1"),
  "http://127.0.0.1:8080/student/?client_kind=student-standalone&nic_mac=aa:bb:cc:dd:ee:10&connection_id=n-1",
);

const inventory = targetClassroomInventory();
assert.deepEqual(
  inventory.pcs.map((p) => p.id),
  ["PCA", "PCB"],
);
assert.deepEqual(
  inventory.switches.map((s) => s.id),
  ["S1", "S2"],
);
assert.equal(inventory.routers[0].id, "R1");
assert.equal(inventory.routers[0].ports[0].ip, "192.168.1.1");
assert.equal(inventory.routers[0].ports[1].ip, "192.168.2.1");

const binary = path.join(root, "target/debug/papernet-teacher");
assert.ok(fs.existsSync(binary), "missing papernet-teacher debug binary");

await runScene(binary);
console.log("F5 checks passed");

function listenPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

async function waitHealth(base) {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`${base}/api/v1/health`);
      if (res.ok) {
        return;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("teacher health timeout");
}

async function runScene(bin) {
  const port = await listenPort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "papernet-f5-"));
  const child = spawn(bin, [], {
    env: {
      ...process.env,
      PAPERNET_BIND: `127.0.0.1:${port}`,
      PAPERNET_DATA_DIR: dataDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errLog = "";
  child.stderr.on("data", (buf) => {
    errLog += buf.toString();
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitHealth(base);
    await walkClassroom(base);
  } catch (err) {
    if (errLog) {
      err.message = `${err.message}\n${errLog}`;
    }
    throw err;
  } finally {
    child.kill("SIGTERM");
  }
}

async function api(base, method, urlPath, { headers = {}, body } = {}) {
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function hdr(conn, extra = {}) {
  return {
    "x-connection-id": conn,
    "x-client-kind": extra.kind || CLIENT_KIND_HOSTED,
    ...(extra.classroomId ? { "x-classroom-id": extra.classroomId } : {}),
  };
}

async function walkClassroom(base) {
  const created = await api(base, "POST", "/api/v1/classrooms", {
    headers: { "x-client-kind": "teacher" },
    body: { title: "目标课堂", inventory: targetClassroomInventory() },
  });
  assert.equal(created.status, 200);
  const classroomId = created.json.data.classroom_id;
  assert.ok(classroomId);

  const opened = await api(base, "POST", `/api/v1/classrooms/${classroomId}/open-claim`, {
    headers: { "x-client-kind": "teacher" },
    body: {},
  });
  assert.equal(opened.status, 200);

  const nic = "aa:bb:cc:dd:ee:10";
  const standalone = await api(base, "POST", "/api/v1/classrooms/join", {
    headers: { "x-client-kind": CLIENT_KIND_STANDALONE },
    body: joinBody(null, CLIENT_KIND_STANDALONE, nic),
  });
  assert.equal(standalone.json.data.status, "claimed");
  const roles = [
    {
      conn: standalone.json.data.connection_id,
      device: standalone.json.data.device,
      kind: CLIENT_KIND_STANDALONE,
    },
  ];
  for (let i = 0; i < 4; i += 1) {
    const joined = await api(base, "POST", "/api/v1/classrooms/join", {
      headers: { "x-client-kind": CLIENT_KIND_HOSTED },
      body: joinBody(),
    });
    assert.equal(joined.json.data.status, "claimed");
    roles.push({
      conn: joined.json.data.connection_id,
      device: joined.json.data.device,
      kind: CLIENT_KIND_HOSTED,
    });
  }
  const ids = new Set(roles.map((r) => r.device.id));
  assert.deepEqual([...ids].sort(), ["PCA", "PCB", "R1", "S1", "S2"]);

  const standalonePc = roles.find((r) => r.kind === CLIENT_KIND_STANDALONE);
  if (standalonePc.device.kind === "pc") {
    assert.equal(standalonePc.device.mac, nic);
  }

  const byId = Object.fromEntries(roles.map((r) => [r.device.id, r]));
  const wire = [
    ["PCA", "PCA/01", { peer_port_id: "S1/01", ip: "192.168.1.10", gateway: "192.168.1.1" }],
    ["S1", "S1/01", { peer_port_id: "PCA/01" }],
    ["S1", "S1/02", { peer_port_id: "R1/01" }],
    ["R1", "R1/01", { peer_port_id: "S1/02" }],
    ["R1", "R1/02", { peer_port_id: "S2/01" }],
    ["S2", "S2/01", { peer_port_id: "R1/02" }],
    ["S2", "S2/02", { peer_port_id: "PCB/01" }],
    ["PCB", "PCB/01", { peer_port_id: "S2/02", ip: "192.168.2.10", gateway: "192.168.2.1" }],
  ];
  for (const [deviceId, portId, patch] of wire) {
    const res = await api(base, "PUT", `/api/v1/devices/${deviceId}/ports/${portId}`, {
      headers: hdr(byId[deviceId].conn),
      body: patch,
    });
    assert.equal(res.status, 200, `put ${portId} ${JSON.stringify(res.json)}`);
  }

  const snap1 = await api(base, "GET", `/api/v1/classrooms/${classroomId}/snapshot`, {
    headers: { "x-client-kind": "teacher" },
  });
  const links = snap1.json.data.links;
  assert.equal(links.length, 4);
  assert.ok(links.every((l) => l.physically_up === true));

  const chat = await api(base, "POST", "/api/v1/chat", {
    headers: hdr(byId.PCA.conn, { classroomId }),
    body: { to_ip: "192.168.2.10", text: "你好" },
  });
  assert.equal(chat.status, 200, JSON.stringify(chat.json));
  assert.equal(chat.json.data.text, "你好");

  const ping = await api(base, "POST", "/api/v1/ping", {
    headers: hdr(byId.PCA.conn, { classroomId }),
    body: { to_ip: "192.168.2.10" },
  });
  assert.equal(ping.status, 200, JSON.stringify(ping.json));
  assert.equal(ping.json.data.reachable, true);

  const mode = await api(base, "POST", `/api/v1/classrooms/${classroomId}/mode`, {
    headers: { "x-client-kind": "teacher" },
    body: { mode: "simulation" },
  });
  assert.equal(mode.status, 200);

  const send = await api(base, "POST", "/api/v1/sim/send", {
    headers: hdr(byId.PCA.conn, { classroomId }),
    body: { to_ip: "192.168.2.10", text: "你好" },
  });
  assert.equal(send.status, 200, JSON.stringify(send.json));
  const fid = send.json.data.frame.frame_id;
  assert.equal(send.json.data.frame.at_device_id, "S1");

  const hop = async (deviceId, frameId, outPort) => {
    const res = await api(base, "POST", `/api/v1/sim/frames/${frameId}/forward`, {
      headers: hdr(byId[deviceId].conn, { classroomId }),
      body: { out_port_id: outPort },
    });
    assert.equal(res.status, 200, `${deviceId} ${outPort} ${JSON.stringify(res.json)}`);
    return res.json;
  };
  await hop("S1", fid, "S1/02");
  await hop("R1", fid, "R1/02");
  await hop("S2", fid, "S2/02");

  const snap2 = await api(base, "GET", `/api/v1/classrooms/${classroomId}/snapshot`, {
    headers: { "x-client-kind": "teacher" },
  });
  const delivered = snap2.json.data.frames.find((f) => f.frame_id === fid);
  assert.equal(delivered.at_device_id, "PCB");
  assert.equal(delivered.status, "delivered");

  const reply = await api(base, "POST", "/api/v1/sim/send", {
    headers: hdr(byId.PCB.conn, { classroomId }),
    body: { to_ip: "192.168.1.10", text: "收到" },
  });
  const back = reply.json.data.frame.frame_id;
  await hop("S2", back, "S2/01");
  await hop("R1", back, "R1/01");
  await hop("S1", back, "S1/01");

  const snap3 = await api(base, "GET", `/api/v1/classrooms/${classroomId}/snapshot`, {
    headers: { "x-client-kind": "teacher" },
  });
  const returned = snap3.json.data.frames.find((f) => f.frame_id === back);
  assert.equal(returned.at_device_id, "PCA");
  assert.equal(returned.status, "delivered");
  assert.equal(returned.payload, "收到");

  const ui = studentUiUrl(base, nic, standalone.json.data.connection_id);
  assert.match(ui, /\/student\/\?/);
  assert.match(ui, /client_kind=student-standalone/);
}
