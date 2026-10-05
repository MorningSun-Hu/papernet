import type { ClaimedScreen, DeviceKind, SimFrameView } from "./claim";

const MSG_WRONG_PORT = "端口不正确";

export function withoutTapPorts(ports: string[]): string[] {
  return ports.filter((id) => !id.startsWith("TAP"));
}

export function renderWorkbench(
  screen: ClaimedScreen,
  opts: { chatInStage?: boolean; arpInStage?: boolean } = {},
): string {
  const kind = screen.device.kind;
  if (kind === "pc") {
    return pcBench(screen, opts.chatInStage === true, opts.arpInStage === true);
  }
  if (kind === "switch") {
    return switchBench(screen);
  }
  if (kind === "router") {
    return routerBench(screen);
  }
  return tapBench(screen);
}

export function renderPcChat(screen: ClaimedScreen): string {
  return chatPanel(screen);
}

export function renderPcHosts(screen: ClaimedScreen): string {
  const cards: string[] = [];
  const seen = new Set<string>();
  for (const host of reachablePcHosts(screen)) {
    const key = host.id;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const sub = [host.ip, host.port_id].filter(Boolean).join(" · ");
    cards.push(`
      <article class="host-card" data-up="${host.online}">
        <span class="host-ico" aria-hidden="true"></span>
        <div>
          <p class="host-name">${escapeHtml(host.id)}</p>
          <p class="host-meta">${escapeHtml(sub || "未配置")}</p>
        </div>
        <span class="host-state">${host.online ? "在线" : "离线"}</span>
      </article>`);
  }
  return cards.join("") || `<p class="hint">暂无可达主机</p>`;
}

export function renderArpTable(screen: ClaimedScreen): string {
  return arpTable(screen);
}

function reachablePcHosts(screen: ClaimedScreen): { id: string; ip: string; port_id: string; online: boolean }[] {
  const hosts = screen.pcHosts.length ? screen.pcHosts : hostsFromLinks(screen);
  const out = [];
  for (const host of hosts) {
    if (host.id === screen.device.id || !/^PC\d+$/i.test(host.id)) {
      continue;
    }
    out.push({
      id: host.id,
      ip: host.ip || "",
      port_id: host.port_id || `${host.id}/01`,
      online: host.online === true,
    });
  }
  return out;
}

function hostsFromLinks(screen: ClaimedScreen): { id: string; ip: string; port_id: string; online: boolean }[] {
  const ids = new Set<string>();
  for (const link of screen.links) {
    for (const portId of [link.port_a, link.port_b]) {
      const dev = portId.split("/")[0] || portId;
      if (/^PC\d+$/i.test(dev)) {
        ids.add(dev);
      }
    }
  }
  return [...ids].sort().map((id) => ({
    id,
    ip: "",
    port_id: `${id}/01`,
    online: false,
  }));
}

export function previewPcFrame(screen: ClaimedScreen, toIp: string, text: string): SimFrameView {
  const port = screen.device.ports[0];
  const srcIp = port?.ip || "";
  const srcMac = (port?.mac || screen.device.mac || "??:??:??:??:??:??").toLowerCase();
  const lookupIp = srcIp && sameCClass(srcIp, toIp) ? toIp : port?.gateway || toIp;
  const arp = screen.arpTable.find((row) => row.device_id === screen.device.id && row.ip === lookupIp);
  return {
    frame_id: "preview",
    dst_mac: (arp?.mac || "??:??:??:??:??:??").toLowerCase(),
    src_mac: srcMac,
    src_ip: srcIp,
    dst_ip: toIp,
    payload: text,
    at_device_id: screen.device.id,
    status: "inflight",
    changed: [],
    ingress: null,
    at: 0,
  };
}

export function renderComposeDialog(screen: ClaimedScreen, toIp: string, text: string): string {
  const frame = previewPcFrame(screen, toIp, text);
  return `
    <div class="dlg-backdrop" data-open="true">
      <form class="dlg compose-form">
        <header class="dlg-hd"><h3>组帧发送</h3><button type="button" class="dlg-x" data-dlg-close>×</button></header>
        <p class="dlg-sub">确认网络帧后再转发</p>
        ${frameStrip(frame)}
        <div class="dlg-actions">
          <button type="button" data-dlg-close>取消</button>
          <button type="submit">发送</button>
        </div>
      </form>
    </div>
  `;
}

function sameCClass(a: string, b: string): boolean {
  const left = a.split(".");
  const right = b.split(".");
  return (
    left.length >= 3 &&
    right.length >= 3 &&
    left[0] === right[0] &&
    left[1] === right[1] &&
    left[2] === right[2]
  );
}

export type LinuxPing = {
  header: string;
  replies: string[];
  stats: string[];
};

export function linuxPing(toIp: string, reachable: boolean): LinuxPing {
  const header = `正在 Ping ${toIp} 具有 32 字节的数据:`;
  if (!reachable) {
    return {
      header,
      replies: Array.from({ length: 4 }, () => `来自 ${toIp} 的回复: 无法访问目标主机。`),
      stats: [
        `${toIp} 的 Ping 统计信息:`,
        "    数据包: 已发送 = 4，已接收 = 0，丢失 = 4 (100% 丢失)，",
      ],
    };
  }
  const times = [1, 1, 2, 1];
  const min = Math.min(...times);
  const max = Math.max(...times);
  const avg = Math.round(times.reduce((sum, n) => sum + n, 0) / times.length);
  return {
    header,
    replies: times.map((ms) => `来自 ${toIp} 的回复: 字节=32 时间=${ms}ms TTL=128`),
    stats: [
      `${toIp} 的 Ping 统计信息:`,
      "    数据包: 已发送 = 4，已接收 = 4，丢失 = 0 (0% 丢失)，",
      "往返行程的估计时间(以毫秒为单位):",
      `    最短 = ${min}ms，最长 = ${max}ms，平均 = ${avg}ms`,
    ],
  };
}

function pcBench(screen: ClaimedScreen, chatInStage: boolean, arpInStage: boolean): string {
  return `
    <section class="bench" data-role="pc">
      ${localNet(screen)}
      ${arpInStage ? "" : arpTable(screen)}
      ${chatInStage ? "" : chatPanel(screen)}
      ${notice(screen.notice)}
    </section>
  `;
}

function localNet(screen: ClaimedScreen): string {
  const port = screen.device.ports[0];
  const ip = port?.ip || "—";
  const mac = port?.mac || screen.device.mac || "—";
  const mask = port?.mask || "255.255.255.0";
  const gw = port?.gateway || "—";
  const portId = port?.id || "";
  const peer = port?.peer_port_id || "未连接";
  const up = Boolean(
    portId &&
      screen.links.some(
        (link) => link.physically_up && (link.port_a === portId || link.port_b === portId),
      ),
  );
  return `
    <section class="local-net">
      <h2>本机网络信息</h2>
      <dl>
        <div class="net-cell" data-k="ip"><span class="net-ico" aria-hidden="true"></span><div><dt>IP 地址</dt><dd>${escapeHtml(ip)}</dd></div></div>
        <div class="net-cell" data-k="mac"><span class="net-ico" aria-hidden="true"></span><div><dt>MAC 地址</dt><dd>${escapeHtml(mac)}</dd></div></div>
        <div class="net-cell" data-k="mask"><span class="net-ico" aria-hidden="true"></span><div><dt>子网掩码</dt><dd>${escapeHtml(mask)}</dd></div></div>
        <div class="net-cell" data-k="gw"><span class="net-ico" aria-hidden="true"></span><div><dt>默认网关</dt><dd>${escapeHtml(gw)}</dd></div></div>
        <div class="net-cell" data-k="peer"><span class="net-ico" aria-hidden="true"></span><div><dt>对端端口</dt><dd>${escapeHtml(peer)}${up ? " (已连接)" : ""}</dd></div></div>
        <div class="net-cell" data-k="${up ? "up" : "down"}"><span class="net-ico" aria-hidden="true"></span><div><dt>网络</dt><dd>${up ? "网络正常" : "未连通"}</dd></div></div>
      </dl>
    </section>
  `;
}

function switchBench(screen: ClaimedScreen): string {
  return `
    <section class="bench" data-role="switch">
      <h2>MAC 表</h2>
      <div class="mac-scroll">
        <table class="mac-table">
          <thead><tr><th>端口</th><th>MAC</th></tr></thead>
          <tbody>${macTableRows(screen)}</tbody>
        </table>
      </div>
      ${screen.mode === "simulation" ? "" : frameCard(screen.frame, "switch")}
      ${screen.mode === "simulation" && screen.frame ? forwardForm(screen) : ""}
    </section>
  `;
}

function routerBench(screen: ClaimedScreen): string {
  return `
    <section class="bench" data-role="router">
      ${arpTable(screen)}
      ${frameCard(screen.frame, "router")}
      ${screen.mode === "simulation" && screen.frame ? forwardForm(screen) : ""}
      ${notice(screen.notice)}
    </section>
  `;
}

function tapBench(screen: ClaimedScreen): string {
  const frames = screen.tapLog;
  const rows = frames.length
    ? frames
        .map(
          (frame) =>
            `<tr>
               <td>${escapeHtml(formatStamp(frame.at))}</td>
               <td>${escapeHtml(frame.src_ip)}</td>
               <td>${escapeHtml(frame.dst_ip)}</td>
               <td>${escapeHtml(frame.src_mac)}</td>
               <td>${escapeHtml(frame.dst_mac)}</td>
               <td class="tap-data">${escapeHtml(payloadSummary(frame.payload))}</td>
             </tr>`,
        )
        .join("")
    : `<tr><td colspan="6" class="tap-empty">暂无过路帧</td></tr>`;
  return `
    <section class="bench" data-role="tap">
      <h2>过路帧</h2>
      <table class="tap-log">
        <thead><tr><th>时间</th><th>源IP</th><th>目的IP</th><th>源MAC</th><th>目的MAC</th><th>数据</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;
}

function arpTable(screen: ClaimedScreen): string {
  const rows = screen.arpTable.filter((row) => row.device_id === screen.device.id);
  return `
    <h2>ARP 表</h2>
    <table class="arp-table">
      <thead><tr><th>IP</th><th>MAC</th></tr></thead>
      <tbody>
        ${
          rows.length
            ? rows
                .map(
                  (row) =>
                    `<tr><td>${escapeHtml(row.ip)}</td><td>${escapeHtml(row.mac)}</td></tr>`,
                )
                .join("")
            : `<tr><td colspan="2">暂无</td></tr>`
        }
      </tbody>
    </table>
  `;
}

function chatPanel(screen: ClaimedScreen): string {
  const peer = screen.chatPeerIp;
  const sim = screen.mode === "simulation";
  const fail = screen.chatError
    ? `<li class="wx-row" data-dir="sent"><p class="chat-fail">${escapeHtml(screen.chatError)}</p></li>`
    : "";
  const modal = screen.chatPrompt
    ? `<div class="dlg-backdrop" data-open="true">
         <form class="wx-peer-form dlg">
           <header class="dlg-hd"><h3>发起聊天</h3><button type="button" class="dlg-x" data-dlg-close>×</button></header>
           <p class="dlg-sub">填写对端 PC 的 IP</p>
           <label>对方 IP <input name="peer_ip" value="${escapeAttr(peer)}" required /></label>
           <div class="dlg-actions">
             <button type="button" data-dlg-close>取消</button>
             <button type="submit">开始</button>
           </div>
         </form>
       </div>`
    : "";
  const composer = peer
    ? `<form class="chat-form" data-mode="${sim ? "simulation" : "normal"}">
         <input type="hidden" name="to_ip" value="${escapeAttr(peer)}" />
         <input name="text" required placeholder="输入消息...（按 Enter 发送）" autocomplete="off" />
         <button type="submit">${sim ? "组帧发送" : "发送"}</button>
       </form>`
    : `<p class="wx-hint">点击发起聊天，输入对方 IP</p>`;
  const lines = screen.chatLog.length
    ? screen.chatLog
        .map((line) => {
          const mine = line.dir === "sent";
          const name = mine ? screen.device.id : line.from_ip;
          const recFrame = !mine && sim ? line.frame : undefined;
          const frameHtml = recFrame
            ? `<div class="wx-frame" data-frame="${escapeAttr(recFrame.frame_id)}">${frameStrip(recFrame)}</div>`
            : "";
          return `<li class="wx-row" data-dir="${line.dir}"${recFrame ? ' data-has-frame="true"' : ""}>
            <span class="wx-avatar" aria-hidden="true"></span>
            <div class="wx-col">
              <span class="wx-name">${escapeHtml(name)}</span>
              <span class="wx-bubble"><span class="wx-text">${escapeHtml(line.text)}</span>${frameHtml}</span>
            </div>
          </li>`;
        })
        .join("")
    : `<li class="empty">尚无对话</li>`;
  const peerTitle = peer ? `与 ${escapeHtml(peer)} 的聊天` : "未选择对象";
  return `
    <div class="wx chat" data-window="dialog">
      <header class="wx-hd">
        <span class="wx-ico" aria-hidden="true"></span>
        <div class="wx-hd-copy">
          <h2>对话窗口</h2>
          <p class="wx-peer">${peerTitle}</p>
        </div>
        ${peer ? `<span class="wx-online">在线</span>` : ""}
        <button type="button" data-chat-start>发起聊天</button>
        <button type="button" class="wx-ping" data-chat-ping>ping</button>
      </header>
      ${modal}
      <ol class="chat-log wx-log">${lines}${fail}</ol>
      ${composer}
    </div>
  `;
}

function macTableRows(screen: ClaimedScreen, highlightMac?: string): string {
  const rows = screen.macTable.filter((row) => row.switch_id === screen.device.id);
  if (!rows.length) {
    return `<tr><td colspan="2">暂无</td></tr>`;
  }
  const hit = (highlightMac ?? "").toLowerCase();
  return rows
    .map((row) => {
      const match = Boolean(hit) && row.mac.toLowerCase() === hit;
      return `<tr${match ? ' data-hit="true"' : ""}><td>${escapeHtml(row.port_id)}</td><td>${escapeHtml(row.mac)}</td></tr>`;
    })
    .join("");
}

function switchMacLookup(screen: ClaimedScreen, dstMac?: string): string {
  return `
    <aside class="fwd-mac" aria-label="MAC 地址表">
      <h4>MAC 地址表</h4>
      <div class="mac-scroll">
        <table class="mac-table">
          <thead><tr><th>端口</th><th>MAC</th></tr></thead>
          <tbody>${macTableRows(screen, dstMac)}</tbody>
        </table>
      </div>
    </aside>`;
}

function forwardForm(screen: ClaimedScreen): string {
  const ports = screen.device.ports;
  const kind = screen.device.kind;
  const frame = screen.frame;
  const pending = frame ? [frame, ...screen.frameQueue] : screen.frameQueue;
  const byMac = kind === "switch";
  const hint = byMac ? "根据目的 MAC 选择转发端口" : "根据目的 IP 选择转发端口";
  const queue = `
    <aside class="fwd-queue" aria-label="待转发帧">
      <h4>待转发帧</h4>
      <ol>
        ${
          pending.length
            ? pending
                .map(
                  (item, i) =>
                    `<li data-current="${i === 0}" data-frame="${escapeAttr(item.frame_id)}">
                       <p class="fwd-q-route">${escapeHtml(item.src_ip)} → ${escapeHtml(item.dst_ip)}</p>
                       <p class="fwd-q-data">${escapeHtml(payloadSummary(item.payload))}</p>
                     </li>`,
                )
                .join("")
            : `<li class="fwd-q-empty">暂无</li>`
        }
      </ol>
    </aside>`;
  const frameRows = frame
    ? `<table class="dlg-frame">
         <tr><th>目的 MAC</th><td>${escapeHtml(frame.dst_mac)}</td></tr>
         <tr><th>源 MAC</th><td>${escapeHtml(frame.src_mac)}</td></tr>
         <tr><th>源 IP</th><td>${escapeHtml(frame.src_ip)}</td></tr>
         <tr><th>目的 IP</th><td>${escapeHtml(frame.dst_ip)}</td></tr>
         <tr><th>数据</th><td>${escapeHtml(payloadSummary(frame.payload))}</td></tr>
       </table>`
    : "";
  return `
    <div class="dlg-backdrop" data-open="true">
      <form class="forward-form dlg"${byMac ? ' data-lookup="mac"' : ""}>
        <header class="dlg-hd" data-fwd-drag>
          <h3>转发数据帧</h3>
          <span class="mode-pill">模拟选口 · ${escapeHtml(screen.device.id)}</span>
        </header>
        <div class="fwd-body"${byMac ? ' data-lookup="mac"' : ""}>
          ${queue}
          <div class="fwd-main">
            <p class="dlg-sub">${hint}</p>
            ${frameRows}
            <p>选择出端口</p>
            <div class="fwd-grid">
              ${ports
                .map(
                  (port) =>
                    `<button type="submit" class="fwd-port" name="out_port_id" value="${escapeAttr(port.id)}">${escapeHtml(port.id)}</button>`,
                )
                .join("")}
            </div>
            ${screen.notice === "端口不正确" ? `<p class="notice wrong-port">端口不正确</p>` : ""}
            <p class="hint">选错口时提示「端口不正确」；帧留在本机</p>
          </div>
          ${byMac ? switchMacLookup(screen, frame?.dst_mac) : ""}
        </div>
      </form>
    </div>
  `;
}

function frameCard(frame: SimFrameView | null, kind?: DeviceKind): string {
  if (!frame) {
    return "";
  }
  const delivered = frame.status === "delivered";
  const note =
    kind === "pc" && delivered
      ? "解包：取出消息"
      : kind === "pc"
        ? "打包：把消息装进数据帧"
        : kind === "router"
          ? "解包查看目的 IP，再重新打包转发"
          : kind === "switch"
            ? "按目的 MAC 转发数据帧"
            : "";
  const packing =
    kind === "pc" && !delivered
      ? `<div class="encap-plain" data-step="payload"><span class="encap-label">消息</span><span>${escapeHtml(payloadSummary(frame.payload))}</span></div><p class="encap-arrow">打包</p>`
      : "";
  const unpack =
    kind === "pc" && delivered
      ? `<p class="frame-message" data-part="message">消息：${escapeHtml(payloadSummary(frame.payload))}</p>`
      : "";
  const routerSteps = kind === "router" ? routerFrameSteps(frame) : "";
  return `
    <article class="frame" data-frame="${escapeAttr(frame.frame_id)}" data-status="${escapeAttr(frame.status)}">
      <h2>网络帧</h2>
      ${note ? `<p class="frame-note">${note}</p>` : ""}
      ${packing}
      ${routerSteps || frameStrip(frame)}
      ${unpack}
    </article>
  `;
}

function routerFrameSteps(frame: SimFrameView): string {
  const recv = frame.ingress ?? { dst_mac: frame.dst_mac, src_mac: frame.src_mac };
  const recvFrame: SimFrameView = {
    ...frame,
    dst_mac: recv.dst_mac,
    src_mac: recv.src_mac,
    changed: [],
    ingress: null,
  };
  const packed = frame.ingress
    ? frameStrip(frame)
    : `<p class="encap-wait">选出口后改写 MAC 并重新打包</p>`;
  return `
    <div class="encap-step" data-step="recv">
      <p class="encap-label">1. 收到数据帧</p>
      ${frameStrip(recvFrame)}
    </div>
    <p class="encap-arrow">解包</p>
    <div class="encap-step" data-step="net">
      <p class="encap-label">2. 网络层</p>
      <div class="frame-strip" data-part="network">
        <div class="frame-cell" data-field="src_ip"><span class="k">源 IP</span><span class="v">${escapeHtml(frame.src_ip)}</span></div>
        <div class="frame-cell" data-field="dst_ip"><span class="k">目的 IP</span><span class="v">${escapeHtml(frame.dst_ip)}</span></div>
        <div class="frame-cell" data-field="payload" data-part="payload"><span class="k">数据</span><span class="v">${escapeHtml(payloadSummary(frame.payload))}</span></div>
      </div>
    </div>
    <p class="encap-arrow">重新打包</p>
    <div class="encap-step" data-step="pack">
      <p class="encap-label">3. 重新打包的数据帧</p>
      ${packed}
    </div>
  `;
}

function frameStrip(frame: SimFrameView): string {
  const changed = new Set(frame.changed ?? []);
  const cell = (field: string, label: string, value: string, part?: string) => {
    const mark = changed.has(field) ? " changed" : "";
    const partAttr = part ? ` data-part="${part}"` : "";
    return `<div class="frame-cell${mark}" data-field="${field}"${partAttr}><span class="k">${label}</span><span class="v">${escapeHtml(value)}</span></div>`;
  };
  return `
    <div class="frame-strip" data-part="header">
      ${cell("dst_mac", "目的 MAC", frame.dst_mac)}
      ${cell("src_mac", "源 MAC", frame.src_mac)}
      ${cell("src_ip", "源 IP", frame.src_ip)}
      ${cell("dst_ip", "目的 IP", frame.dst_ip)}
    </div>
    <div class="frame-strip payload-strip">
      ${cell("payload", "数据", payloadSummary(frame.payload), "payload")}
    </div>
  `;
}

function notice(text: string): string {
  if (!text) {
    return "";
  }
  const wrong = text === MSG_WRONG_PORT ? "wrong-port" : "";
  return `<p class="notice ${wrong}">${escapeHtml(text)}</p>`;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(text: string): string {
  return escapeHtml(text);
}

function payloadSummary(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= 24 ? t : `${t.slice(0, 24)}...`;
}

function formatStamp(at: number): string {
  if (!at) {
    return "--:--:--";
  }
  const ms = at < 1e12 ? at * 1000 : at;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) {
    return "--:--:--";
  }
  return d.toLocaleTimeString("zh-CN", { hour12: false });
}
