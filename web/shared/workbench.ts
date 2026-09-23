import type { ClaimedScreen, SimFrameView } from "./claim";

const MSG_WRONG_PORT = "端口不正确";

export function withoutTapPorts(ports: string[]): string[] {
  return ports.filter((id) => !id.startsWith("TAP"));
}

export function renderWorkbench(screen: ClaimedScreen): string {
  const kind = screen.device.kind;
  if (kind === "pc") {
    return pcBench(screen);
  }
  if (kind === "switch") {
    return switchBench(screen);
  }
  if (kind === "router") {
    return routerBench(screen);
  }
  return tapBench(screen);
}

function pcBench(screen: ClaimedScreen): string {
  const sim = screen.mode === "simulation";
  return `
    <section class="bench" data-role="pc">
      ${arpTable(screen)}
      ${chatWindow(screen)}
      ${sim ? frameCard(screen.frame) : ""}
      ${sim ? simForm() : `${chatForm()}${pingForm(screen.pingDetail)}`}
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
      ${frameCard(screen.frame)}
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
      ${frameCard(screen.frame)}
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
            ? frames.map((frame) => `<li>${frameLine(frame)}</li>`).join("")
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

function chatWindow(screen: ClaimedScreen): string {
  return `
    <div class="chat" data-window="dialog">
      <h2>对话窗口</h2>
      <ol class="chat-log">
        ${
          screen.chatLog.length
            ? screen.chatLog
                .map(
                  (line) =>
                    `<li data-dir="${line.dir}"><span>${escapeHtml(line.from_ip)} → ${escapeHtml(line.to_ip)}</span> ${escapeHtml(line.text)}</li>`,
                )
                .join("")
            : "<li class=\"empty\">尚无对话</li>"
        }
      </ol>
    </div>
  `;
}

function chatForm(): string {
  return `
    <form class="chat-form" data-mode="normal">
      <label>目的 IP <input name="to_ip" required /></label>
      <label>文字 <input name="text" required /></label>
      <button type="submit">发送</button>
    </form>
  `;
}

function simForm(): string {
  return `
    <form class="chat-form" data-mode="simulation">
      <label>目的 IP <input name="to_ip" required /></label>
      <label>文字 <input name="text" required /></label>
      <button type="submit">组帧发送</button>
    </form>
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

function frameCard(frame: SimFrameView | null): string {
  if (!frame) {
    return "";
  }
  return `
    <article class="frame" data-frame="${escapeAttr(frame.frame_id)}">
      <h2>网络帧</h2>
      <dl class="frame-head" data-part="header">
        <dt>目的 MAC</dt><dd>${escapeHtml(frame.dst_mac)}</dd>
        <dt>源 MAC</dt><dd>${escapeHtml(frame.src_mac)}</dd>
        <dt>源 IP</dt><dd>${escapeHtml(frame.src_ip)}</dd>
        <dt>目的 IP</dt><dd>${escapeHtml(frame.dst_ip)}</dd>
      </dl>
      <p class="frame-payload" data-part="payload">${escapeHtml(frame.payload)}</p>
    </article>
  `;
}

function frameLine(frame: SimFrameView): string {
  return `${escapeHtml(frame.src_ip)} → ${escapeHtml(frame.dst_ip)} ${escapeHtml(frame.payload)}`;
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
