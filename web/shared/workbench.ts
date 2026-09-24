import type { ClaimedScreen, DeviceKind, SimFrameView } from "./claim";

const MSG_WRONG_PORT = "端口不正确";

export function withoutTapPorts(ports: string[]): string[] {
  return ports.filter((id) => !id.startsWith("TAP"));
}

export function renderWorkbench(screen: ClaimedScreen, opts: { chatInStage?: boolean } = {}): string {
  const kind = screen.device.kind;
  if (kind === "pc") {
    return pcBench(screen, opts.chatInStage === true);
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

function pcBench(screen: ClaimedScreen, chatInStage: boolean): string {
  const sim = screen.mode === "simulation";
  return `
    <section class="bench" data-role="pc">
      ${arpTable(screen)}
      ${sim ? frameCard(screen.frame, "pc") : ""}
      ${chatInStage ? "" : chatPanel(screen)}
      ${notice(screen.notice)}
    </section>
  `;
}

function switchBench(screen: ClaimedScreen): string {
  const rows = screen.macTable.filter((row) => row.switch_id === screen.device.id);
  return `
    <section class="bench" data-role="switch">
      <h2>MAC 表</h2>
      <table class="mac-table">
        <thead><tr><th>端口</th><th>MAC</th></tr></thead>
        <tbody>
          ${
            rows.length
              ? rows
                  .map(
                    (row) =>
                      `<tr><td>${escapeHtml(row.port_id)}</td><td>${escapeHtml(row.mac)}</td></tr>`,
                  )
                  .join("")
              : `<tr><td colspan="2">暂无</td></tr>`
          }
        </tbody>
      </table>
      ${frameCard(screen.frame, "switch")}
      ${screen.mode === "simulation" && screen.frame ? forwardForm(screen) : ""}
      ${notice(screen.notice)}
    </section>
  `;
}

function routerBench(screen: ClaimedScreen): string {
  return `
    <section class="bench" data-role="router">
      ${arpTable(screen)}
      ${screen.mode === "normal" ? pingForm(screen.pingDetail) : ""}
      ${frameCard(screen.frame, "router")}
      ${screen.mode === "simulation" && screen.frame ? forwardForm(screen) : ""}
      ${notice(screen.notice)}
    </section>
  `;
}

function tapBench(screen: ClaimedScreen): string {
  const frames = screen.tapLog;
  return `
    <section class="bench" data-role="tap">
      <h2>过路帧</h2>
      <ul class="tap-log">
        ${
          frames.length
            ? frames.map((frame) => `<li>${frameStrip(frame)}</li>`).join("")
            : "<li>暂无过路帧</li>"
        }
      </ul>
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
    ? `<p class="chat-fail">${escapeHtml(screen.chatError)}</p>`
    : "";
  const modal = screen.chatPrompt
    ? `<form class="wx-peer-form">
         <p>对方 IP</p>
         <label>对方 IP <input name="peer_ip" value="${escapeAttr(peer)}" required /></label>
         <button type="submit">开始</button>
       </form>`
    : "";
  const composer = peer
    ? `<form class="chat-form" data-mode="${sim ? "simulation" : "normal"}">
         <input type="hidden" name="to_ip" value="${escapeAttr(peer)}" />
         <input name="text" required placeholder="发送消息" />
         <button type="submit">${sim ? "组帧发送" : "发送"}</button>
       </form>`
    : `<p class="wx-hint">点击发起聊天，输入对方 IP</p>`;
  const lines = screen.chatLog.length
    ? screen.chatLog
        .map(
          (line) =>
            `<li class="wx-bubble" data-dir="${line.dir}"><span class="wx-meta">${escapeHtml(line.from_ip)} → ${escapeHtml(line.to_ip)}</span> ${escapeHtml(line.text)}</li>`,
        )
        .join("")
    : `<li class="empty">尚无对话</li>`;
  return `
    <div class="wx chat" data-window="dialog">
      <header class="wx-hd">
        <h2>对话窗口</h2>
        <p class="wx-peer">${peer ? escapeHtml(peer) : "未选择对象"}</p>
        <button type="button" data-chat-start>发起聊天</button>
        <button type="button" class="wx-ping" data-chat-ping ${peer ? "" : "disabled"}>ping</button>
      </header>
      ${fail}
      ${modal}
      <ol class="chat-log wx-log">${lines}</ol>
      ${composer}
    </div>
  `;
}

function pingForm(detail: string): string {
  return `
    <form class="ping-form">
      <label>ping 目标 IP <input name="to_ip" required /></label>
      <button type="submit">ping</button>
      ${detail ? `<p class="ping-result">${escapeHtml(detail)}</p>` : ""}
    </form>
  `;
}

function forwardForm(screen: ClaimedScreen): string {
  const ports = screen.device.ports;
  return `
    <form class="forward-form">
      <p>模拟选口</p>
      ${ports
        .map(
          (port) =>
            `<button type="submit" class="fwd-port" name="out_port_id" value="${escapeAttr(port.id)}">${escapeHtml(port.id)}</button>`,
        )
        .join("")}
    </form>
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
      ? `<div class="encap-plain" data-step="payload"><span class="encap-label">消息</span><span>${escapeHtml(frame.payload)}</span></div><p class="encap-arrow">打包</p>`
      : "";
  const unpack =
    kind === "pc" && delivered
      ? `<p class="frame-message" data-part="message">消息：${escapeHtml(frame.payload)}</p>`
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
        <div class="frame-cell" data-field="payload" data-part="payload"><span class="k">数据</span><span class="v">${escapeHtml(frame.payload)}</span></div>
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
      ${cell("payload", "数据", frame.payload, "payload")}
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
