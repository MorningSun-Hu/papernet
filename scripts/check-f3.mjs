import assert from "node:assert/strict";
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
import { renderPcChat, renderWorkbench, withoutTapPorts } from "../web/shared/workbench.ts";

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
assert.match(pcHtml, /ping/);
assert.match(pcHtml, /发起聊天/);
assert.match(renderPcChat(pc), /发起聊天/);
assert.match(renderPcChat(pc), /data-chat-ping/);

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
assert.match(frameHtml, /data-part="header"/);
assert.match(frameHtml, /data-part="payload"/);
assert.match(frameHtml, /目的 MAC/);
assert.match(frameHtml, /源 MAC/);
assert.match(frameHtml, /源 IP/);
assert.match(frameHtml, /目的 IP/);
assert.match(frameHtml, /aa:bb:cc:dd:ee:02/);
assert.match(frameHtml, /你好/);

assert.match(frameHtml, /打包/);
assert.match(frameHtml, /frame-cell/);

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
const deliveredHtml = renderWorkbench({ ...delivered, mode: "simulation" });
assert.match(deliveredHtml, /解包/);
assert.match(deliveredHtml, /消息：你好/);

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
  mac_table: [{ switch_id: "S1", port_id: "S1/01", mac: "aa:bb:cc:dd:ee:01" }],
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
assert.match(routerHtml, /ping/);

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

assert.match(renderWorkbench(routerHold), /解包查看目的 IP/);
assert.match(renderWorkbench(routerHold), /data-step="recv"/);
assert.match(renderWorkbench(routerHold), /data-step="net"/);
assert.match(renderWorkbench(routerHold), /data-step="pack"/);
assert.match(renderWorkbench(routerHold), /选出口后改写 MAC/);

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
assert.equal(tapHtml.includes("port-editor"), false);

console.log("F3 checks passed");
