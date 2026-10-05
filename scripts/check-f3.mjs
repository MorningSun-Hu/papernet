import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MSG_WRONG_PORT,
  MSG_CHAT_UNREACHABLE,
  applyNotice,
  MSG_PORT_BUSY,
  applyChatError,
  applyPingDetail,
  applyWsEvent,
  blankClaimed,
  screenFromHttp,
} from "../web/shared/claim.ts";
import { linuxPing, previewPcFrame, renderComposeDialog, renderPcChat, renderPcHosts, renderWorkbench, withoutTapPorts } from "../web/shared/workbench.ts";

assert.equal(MSG_WRONG_PORT, "端口不正确");
assert.equal(MSG_PORT_BUSY, "端口已被占用");
assert.deepEqual(withoutTapPorts(["S1/01", "TAP1/01", "R1/01", "PC1/01"]), [
  "S1/01",
  "R1/01",
  "PC1/01",
]);

const pc = screenFromHttp(200, {
  ok: true,
  data: {
    status: "claimed",
    connection_id: "c-pc",
    device: { id: "PC1", kind: "pc", ports: [{ id: "PC1/01", ip: "192.168.1.10" }] },
  },
});
assert.equal(pc.kind, "claimed");
const pcHtml = renderWorkbench(pc);
assert.match(pcHtml, /对话窗口/);
assert.match(pcHtml, /ARP 表/);
assert.match(pcHtml, /MAC 地址/);
assert.match(pcHtml, /ping/);
assert.match(pcHtml, /发起聊天/);
assert.match(renderPcChat(pc), /发起聊天/);
assert.match(renderPcChat(pc), /data-chat-ping/);
assert.match(renderPcHosts(pc), /暂无可达主机/);
const lanPc = {
  ...pc,
  pcHosts: [
    { id: "PC1", ip: "192.168.1.10", port_id: "PC1/01", online: true },
    { id: "PC2", ip: "192.168.1.20", port_id: "PC2/01", online: true },
    { id: "PC3", ip: "192.168.2.10", port_id: "PC3/01", online: true },
  ],
  links: [
    { link_id: "PC1-S1", port_a: "PC1/01", port_b: "S1/01", physically_up: true },
    { link_id: "PC2-S1", port_a: "PC2/01", port_b: "S1/02", physically_up: true },
  ],
};
assert.match(renderPcHosts(lanPc), /host-card/);
assert.match(renderPcHosts(lanPc), /PC2/);
assert.match(renderPcHosts(lanPc), /192\.168\.1\.20/);
assert.match(renderPcHosts(lanPc), /PC3/);
assert.equal(renderPcHosts(lanPc).includes("PC1"), false);
const fromLinks = {
  ...pc,
  pcHosts: [],
  links: [
    { link_id: "PC1-S1", port_a: "PC1/01", port_b: "S1/01", physically_up: true },
    { link_id: "PC2-S1", port_a: "PC2/01", port_b: "S1/02", physically_up: true },
  ],
};
assert.match(renderPcHosts(fromLinks), /PC2/);
assert.equal(renderPcHosts(fromLinks).includes("PC1"), false);
const framedPreview = previewPcFrame(
  {
    ...pc,
    arpTable: [{ device_id: "PC1", ip: "192.168.1.20", mac: "aa:bb:cc:dd:ee:20" }],
    device: { id: "PC1", kind: "pc", ports: [{ id: "PC1/01", ip: "192.168.1.10", mac: "aa:bb:cc:dd:ee:01" }] },
  },
  "192.168.1.20",
  "你好",
);
assert.equal(framedPreview.dst_ip, "192.168.1.20");
assert.equal(framedPreview.src_ip, "192.168.1.10");
assert.equal(framedPreview.dst_mac, "aa:bb:cc:dd:ee:20");
assert.equal(framedPreview.src_mac, "aa:bb:cc:dd:ee:01");
assert.match(renderComposeDialog(pc, "192.168.1.20", "你好"), /compose-form/);
assert.match(renderComposeDialog(pc, "192.168.1.20", "你好"), /你好/);

const talked = applyWsEvent(
  applyWsEvent(pc, {
    event: "chat.sent",
    from_ip: "192.168.1.10",
    to_ip: "192.168.2.10",
    text: "你好",
  }),
  {
    event: "chat.received",
    from_ip: "192.168.2.10",
    to_ip: "192.168.1.10",
    text: "收到",
  },
);
assert.equal(talked.kind, "claimed");
const chatHtml = renderWorkbench(talked);
assert.match(chatHtml, /你好/);
assert.match(chatHtml, /收到/);

const framed = applyWsEvent(pc, {
  event: "frame.built",
  frame: {
    frame_id: "F1",
    dst_mac: "aa:bb:cc:dd:ee:02",
    src_mac: "aa:bb:cc:dd:ee:01",
    src_ip: "192.168.1.10",
    dst_ip: "192.168.2.10",
    payload: "你好",
    at_device_id: "PC1",
    status: "inflight",
  },
});
assert.equal(framed.kind, "claimed");
const frameHtml = renderWorkbench({ ...framed, mode: "simulation" });
assert.match(frameHtml, /你好/);
assert.equal(frameHtml.includes("class=\"frame\""), false);
assert.match(renderComposeDialog(pc, "192.168.2.10", "你好"), /data-part="header"/);
assert.match(renderComposeDialog(pc, "192.168.2.10", "你好"), /frame-cell/);

const delivered = applyWsEvent(pc, {
  event: "frame.arrived",
  frame: {
    frame_id: "F1d",
    dst_mac: "aa:bb:cc:dd:ee:01",
    src_mac: "aa:bb:cc:dd:ee:99",
    src_ip: "192.168.2.10",
    dst_ip: "192.168.1.10",
    payload: "你好",
    at_device_id: "PC1",
    status: "delivered",
  },
});
assert.equal(delivered.kind, "claimed");
assert.equal(delivered.frame?.status, "delivered");
assert.equal(delivered.frame?.payload, "你好");
const deliveredSim = { ...delivered, mode: "simulation" };
const deliveredHtml = renderWorkbench(deliveredSim);
assert.match(deliveredHtml, /wx-frame/);
assert.match(deliveredHtml, /data-part="header"/);
assert.match(deliveredHtml, /data-part="payload"/);
assert.match(deliveredHtml, /目的 MAC/);
assert.match(deliveredHtml, /源 MAC/);
assert.match(deliveredHtml, /源 IP/);
assert.match(deliveredHtml, /目的 IP/);
assert.match(deliveredHtml, /aa:bb:cc:dd:ee:99/);
assert.match(deliveredHtml, /你好/);
assert.equal(deliveredHtml.includes("class=\"frame\""), false);
assert.match(renderPcChat(deliveredSim), /wx-frame/);

const pinged = applyPingDetail(pc, "来自 192.168.2.1 的虚拟响应");
assert.equal(pinged.kind, "claimed");
assert.match(renderWorkbench(pinged), /来自 192\.168\.2\.1 的虚拟响应/);

const unreachable = applyChatError(pc, MSG_CHAT_UNREACHABLE);
assert.equal(unreachable.kind, "claimed");
assert.match(renderWorkbench(unreachable), /消息发送失败，对方 IP 不可达/);
assert.match(renderWorkbench(unreachable), /chat-fail/);

const sw = blankClaimed("c-sw", {
  id: "S1",
  kind: "switch",
  ports: [{ id: "S1/01" }, { id: "S1/02" }],
});
const swTables = applyWsEvent(sw, {
  event: "topology.updated",
  mac_table: [
    { switch_id: "S1", port_id: "S1/01", mac: "aa:bb:cc:dd:ee:01" },
    { switch_id: "S1", port_id: "S1/02", mac: "aa:bb:cc:dd:ee:02" },
  ],
});
assert.equal(swTables.kind, "claimed");
assert.match(renderWorkbench(swTables), /MAC 表/);
assert.match(renderWorkbench(swTables), /S1\/01/);
assert.match(renderWorkbench(swTables), /aa:bb:cc:dd:ee:01/);

const holding = applyWsEvent(
  { ...swTables, mode: "simulation" },
  {
    event: "frame.arrived",
    frame: {
      frame_id: "F2",
      dst_mac: "aa:bb:cc:dd:ee:02",
      src_mac: "aa:bb:cc:dd:ee:01",
      src_ip: "192.168.1.10",
      dst_ip: "192.168.2.10",
      payload: "你好",
      at_device_id: "S1",
      status: "inflight",
    },
  },
);
assert.equal(holding.kind, "claimed");
assert.match(renderWorkbench(holding), /模拟选口/);
assert.match(renderWorkbench(holding), /S1\/02/);
assert.match(renderWorkbench(holding), /待转发帧/);
assert.equal(holding.frameQueue.length, 0);
assert.match(renderWorkbench(holding), /mac-scroll/);
assert.doesNotMatch(renderWorkbench(holding), /<h2>网络帧<\/h2>/);
assert.match(renderWorkbench(holding), /fwd-mac/);
assert.match(renderWorkbench(holding), /MAC 地址表/);
assert.match(renderWorkbench(holding), /data-hit="true"/);

const queued = applyWsEvent(holding, {
  event: "frame.arrived",
  frame: {
    frame_id: "F2b",
    dst_mac: "aa:bb:cc:dd:ee:03",
    src_mac: "aa:bb:cc:dd:ee:01",
    src_ip: "192.168.1.11",
    dst_ip: "192.168.2.11",
    payload: "第二帧",
    at_device_id: "S1",
    status: "inflight",
  },
});
assert.equal(queued.kind, "claimed");
assert.equal(queued.frame?.frame_id, "F2");
assert.equal(queued.frameQueue.length, 1);
assert.equal(queued.frameQueue[0].frame_id, "F2b");
assert.match(renderWorkbench(queued), /第二帧/);

const advanced = applyWsEvent(queued, { event: "frame.departed", frame_id: "F2" });
assert.equal(advanced.kind, "claimed");
assert.equal(advanced.frame?.frame_id, "F2b");
assert.equal(advanced.frameQueue.length, 0);

const drained = applyWsEvent(advanced, { event: "frame.departed", frame_id: "F2b" });
assert.equal(drained.kind, "claimed");
assert.equal(drained.frame, null);
assert.equal(renderWorkbench(drained).includes("模拟选口"), false);

const wrong = applyNotice(holding, MSG_WRONG_PORT);
assert.equal(wrong.kind, "claimed");
assert.equal(wrong.frame?.frame_id, "F2");
assert.match(renderWorkbench(wrong), /端口不正确/);

const router = applyWsEvent(
  blankClaimed("c-r", {
    id: "R1",
    kind: "router",
    ports: [
      { id: "R1/01", ip: "192.168.1.1" },
      { id: "R1/02", ip: "192.168.2.1" },
    ],
  }),
  {
    event: "topology.updated",
    arp_table: [{ device_id: "R1", ip: "192.168.1.10", mac: "aa:bb:cc:dd:ee:01" }],
  },
);
assert.equal(router.kind, "claimed");
const routerHtml = renderWorkbench(router);
assert.match(routerHtml, /ARP 表/);
assert.match(routerHtml, /192\.168\.1\.10/);
assert.equal(routerHtml.includes("ping-form"), false);
assert.equal(routerHtml.includes("data-router-ping"), false);

const routerHold = applyWsEvent(
  { ...router, mode: "simulation" },
  {
    event: "frame.arrived",
    frame: {
      frame_id: "F3",
      dst_mac: "aa:bb:cc:dd:ee:02",
      src_mac: "aa:bb:cc:dd:ee:ff",
      src_ip: "192.168.1.10",
      dst_ip: "192.168.2.10",
      payload: "你好",
      at_device_id: "R1",
      status: "inflight",
    },
  },
);
assert.match(renderWorkbench(routerHold), /模拟选口/);
assert.match(renderWorkbench(routerHold), /R1\/02/);
assert.doesNotMatch(renderWorkbench(routerHold), /fwd-mac/);
assert.doesNotMatch(renderWorkbench(routerHold), /MAC 地址表/);
assert.match(renderWorkbench(routerHold), /fwd-lookup/);
assert.match(renderWorkbench(routerHold), /端口地址表/);
assert.match(renderWorkbench(routerHold), /data-hit="true"/);
assert.match(renderWorkbench(routerHold), /192\.168\.2\.1/);

assert.match(renderWorkbench(routerHold), /解包查看目的 IP/);
assert.match(renderWorkbench(routerHold), /data-step="recv"/);
assert.match(renderWorkbench(routerHold), /data-step="net"/);
assert.match(renderWorkbench(routerHold), /data-step="pack"/);
assert.match(renderWorkbench(routerHold), /选出口后改写 MAC/);
assert.doesNotMatch(renderWorkbench(routerHold), /<h2>网络帧<\/h2>/);
assert.doesNotMatch(renderWorkbench(routerHold), /dlg-frame/);

const repacked = applyWsEvent(routerHold, {
  event: "frame.repack",
  frame: {
    frame_id: "F3",
    dst_mac: "aa:bb:cc:dd:ee:0b",
    src_mac: "aa:bb:cc:dd:ee:02",
    src_ip: "192.168.1.10",
    dst_ip: "192.168.2.10",
    payload: "你好",
    at_device_id: "R1",
    status: "inflight",
  },
});
assert.equal(repacked.kind, "claimed");
assert.deepEqual(repacked.frame?.changed.sort(), ["dst_mac", "src_mac"]);
assert.match(renderWorkbench(repacked), /frame-cell changed/);
assert.match(renderWorkbench(repacked), /data-step="recv"/);
assert.match(renderWorkbench(repacked), /重新打包的数据帧/);
assert.equal(renderWorkbench(repacked).includes("选出口后改写 MAC"), false);

const tap = applyWsEvent(
  blankClaimed("c-tap", {
    id: "TAP1",
    kind: "tap",
    ports: [{ id: "TAP1/01" }, { id: "TAP1/02" }],
  }),
  {
    event: "frame.logged",
    frame: {
      frame_id: "F4",
      dst_mac: "aa:bb:cc:dd:ee:02",
      src_mac: "aa:bb:cc:dd:ee:01",
      src_ip: "192.168.1.10",
      dst_ip: "192.168.2.10",
      payload: "过路",
      at_device_id: "TAP1",
      status: "inflight",
    },
  },
);
assert.equal(tap.kind, "claimed");
const tapHtml = renderWorkbench(tap);
assert.match(tapHtml, /过路帧/);
assert.match(tapHtml, /过路/);
assert.match(tapHtml, /<th>时间<\/th>/);
assert.match(tapHtml, /<th>源IP<\/th>/);
assert.match(tapHtml, /<th>目的IP<\/th>/);
assert.match(tapHtml, /<th>源MAC<\/th>/);
assert.match(tapHtml, /<th>目的MAC<\/th>/);
assert.match(tapHtml, /<th>数据<\/th>/);
assert.match(tapHtml, /192\.168\.1\.10/);
assert.match(tapHtml, /192\.168\.2\.10/);
assert.match(tapHtml, /aa:bb:cc:dd:ee:01/);
assert.match(tapHtml, /aa:bb:cc:dd:ee:02/);
assert.equal(tapHtml.includes("port-editor"), false);

const longMsg = "这是一条非常非常长的测试消息，用来检查帧视图会不会被撑开。";
const longCompose = renderComposeDialog(pc, "192.168.1.20", longMsg);
assert.equal(longCompose.includes(longMsg), false);
assert.match(longCompose, /\.\.\./);
assert.match(longCompose, /这是一条非常非常长的测试消息/);

const longFrame = (deviceId, extra = {}) => ({
  frame_id: "FL",
  dst_mac: "aa:bb:cc:dd:ee:02",
  src_mac: "aa:bb:cc:dd:ee:01",
  src_ip: "192.168.1.10",
  dst_ip: "192.168.2.10",
  payload: longMsg,
  at_device_id: deviceId,
  status: "inflight",
  ...extra,
});
const swLongHtml = renderWorkbench(
  applyWsEvent({ ...swTables, mode: "simulation" }, { event: "frame.arrived", frame: longFrame("S1") }),
);
assert.equal(swLongHtml.includes(longMsg), false);
assert.match(swLongHtml, /转发数据帧/);
assert.match(swLongHtml, /\.\.\./);

const routerLongHtml = renderWorkbench(
  applyWsEvent({ ...router, mode: "simulation" }, { event: "frame.arrived", frame: longFrame("R1") }),
);
assert.equal(routerLongHtml.includes(longMsg), false);
assert.match(routerLongHtml, /\.\.\./);

const tapLongHtml = renderWorkbench(
  applyWsEvent(
    blankClaimed("c-tap-long", {
      id: "TAP1",
      kind: "tap",
      ports: [{ id: "TAP1/01" }, { id: "TAP1/02" }],
    }),
    { event: "frame.logged", frame: longFrame("TAP1") },
  ),
);
assert.equal(tapLongHtml.includes(longMsg), false);
assert.match(tapLongHtml, /\.\.\./);

const pcLong = applyWsEvent(pc, {
  event: "frame.arrived",
  frame: longFrame("PC1", { status: "delivered", dst_mac: "aa:bb:cc:dd:ee:01" }),
});
const pcLongHtml = renderWorkbench({ ...pcLong, mode: "simulation" });
assert.match(pcLongHtml, new RegExp(`wx-text">${longMsg}`));
assert.equal(pcLongHtml.split(longMsg).length - 1, 1);


const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const studentMain = fs.readFileSync(path.join(root, "web/student/src/main.ts"), "utf8");
assert.match(studentMain, /data-router-ping/);
assert.match(studentMain, /router-ping-form/);
assert.match(studentMain, /linuxPing/);
assert.match(studentMain, /compose-form/);
assert.match(studentMain, /renderComposeDialog/);
assert.equal(studentMain.includes("classList.contains(\"ping-form\")"), false);

const okPing = linuxPing("192.168.1.10", true);
assert.match(okPing.header, /正在 Ping 192\.168\.1\.10 具有 32 字节的数据:/);
assert.equal(okPing.replies.length, 4);
assert.match(okPing.replies[0], /来自 192\.168\.1\.10 的回复: 字节=32 时间=1ms TTL=128/);
assert.match(okPing.replies[3], /时间=1ms TTL=128/);
assert.match(okPing.stats[0], /192\.168\.1\.10 的 Ping 统计信息:/);
assert.match(okPing.stats[1], /已发送 = 4，已接收 = 4，丢失 = 0 \(0% 丢失\)/);
assert.match(okPing.stats[3], /最短 = 1ms，最长 = 2ms，平均 = 1ms/);

const badPing = linuxPing("10.0.0.9", false);
assert.equal(badPing.replies.length, 4);
assert.match(badPing.replies[0], /无法访问目标主机/);
assert.match(badPing.stats[1], /已发送 = 4，已接收 = 0，丢失 = 4 \(100% 丢失\)/);

console.log("F3 checks passed");
