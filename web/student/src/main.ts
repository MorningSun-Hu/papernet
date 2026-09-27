import "./style.css";
import {
  applyChatError,
  applyNotice,
  applyPingDetail,
  applyWsEvent,
  currentStudentClient,
  documentTitle,
  MSG_CLASSROOM_FULL,
  MSG_WAITING_OPEN,
  MSG_NO_CLASSROOM,
  MSG_CHAT_UNREACHABLE,
  ROLE_LABEL,
  ROLE_SHELL,
  wsPath,
  type Screen,
} from "@shared/claim";
import { renderPcChat, renderWorkbench, withoutTapPorts } from "@shared/workbench";
import { brandLockup, hudClock, studentNav } from "@shared/brand";
import {
  ApiError,
  forwardFrame,
  joinClassroom,
  listPeers,
  loadConnectionId,
  persistScreen,
  putPort,
  sendChat,
  sendPing,
  simSend,
} from "./api";
import { layoutWires, placePeerBoxes, rememberPeerBox, renderStage } from "./stage";

const app = mount();

function mount(): HTMLDivElement {
  const el = document.querySelector<HTMLDivElement>("#app");
  if (!el) {
    throw new Error("missing #app");
  }
  return el;
}

let screen: Screen = { kind: "idle", message: "正在加入课堂…" };
let socket: WebSocket | null = null;
let heartbeat: number | null = null;
let reconnectTimer: number | null = null;
let selectedPortId: string | null = null;
let peers: string[] = [];

function render(): void {
  app.innerHTML = htmlFor(screen);
  document.title = documentTitle(screen);
  if (screen.kind === "claimed") {
    placePeerBoxes(app);
    layoutWires(app);
  }
}

function htmlFor(s: Screen): string {
  if (s.kind === "waiting_open") {
    return board(MSG_WAITING_OPEN, "wait");
  }
  if (s.kind === "full") {
    return board(MSG_CLASSROOM_FULL, "full");
  }
  if (s.kind === "claimed") {
    return claimedShell(s);
  }
  if (s.kind === "idle") {
    return board(s.message || MSG_NO_CLASSROOM, "wait");
  }
  return board(s.message, "idle");
}

function board(message: string, tone: string): string {
  return `
    <main class="board ${tone}">
      <p class="eyebrow">纸上谈网 · 学生席</p>
      <p class="copy" data-screen="${tone}">${escapeHtml(message)}</p>
    </main>
  `;
}

function claimedShell(s: Extract<Screen, { kind: "claimed" }>): string {
  const shell = ROLE_SHELL[s.device.kind];
  const isPc = s.device.kind === "pc";
  const stage = renderStage(
    s.device,
    s.links,
    {
      chatHtml: isPc ? renderPcChat(s) : undefined,
    },
    selectedPortId,
    withoutTapPorts(peers.filter((id) => !id.startsWith(`${s.device.id}/`))),
    s.tapAttach,
  );
  return `
    <main class="shell" data-kind="${shell}">
      <header class="hud">
        ${brandLockup()}
        ${studentNav(s.device.kind)}
        <p class="hud-clock">${hudClock()}</p>
        <span class="hud-user">学生</span>
      </header>
      <h1 class="hero-title">${escapeHtml(s.device.kind === "pc" ? "主机" : ROLE_LABEL[s.device.kind])} ${escapeHtml(s.device.id)} <span class="mode-pill" data-mode="${s.mode}">${s.mode === "simulation" ? "模拟" : "普通"}</span></h1>
      <div class="lab">
        ${statusAside(s)}
        ${stage.html}
        ${renderWorkbench(s, { chatInStage: isPc })}
      </div>
      ${switchNotice(s)}
      <footer class="hud-foot">
        ${brandLockup()}
        <p>在实验中遇见更好的自己。</p>
      </footer>
    </main>
  `;
}

function switchNotice(s: Extract<Screen, { kind: "claimed" }>): string {
  if (s.device.kind !== "switch" || !s.notice || s.notice === "端口不正确") {
    return "";
  }
  return `<p class="toast-notice" role="status">${escapeHtml(s.notice)}</p>`;
}

function statusAside(s: Extract<Screen, { kind: "claimed" }>): string {
  if (s.device.kind === "pc") {
    return "";
  }
  const up = s.device.ports.filter((p) =>
    s.links.some((l) => l.physically_up && (l.port_a === p.id || l.port_b === p.id)),
  ).length;
  return `
    <aside class="status-aside">
      <h2>${escapeHtml(ROLE_LABEL[s.device.kind])}状态</h2>
      <p class="device-id">${escapeHtml(s.device.id)}</p>
      <dl>
        <div><dt>运行状态</dt><dd><span class="dot" data-up="true"></span> 正常</dd></div>
        <div><dt>端口总数</dt><dd>${s.device.ports.length}</dd></div>
        <div><dt>UP 端口</dt><dd>${up}</dd></div>
      </dl>
    </aside>
  `;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

let noticeTimer: number | null = null;

function armNoticeTimer(next: Screen): void {
  if (noticeTimer !== null) {
    window.clearTimeout(noticeTimer);
    noticeTimer = null;
  }
  if (next.kind !== "claimed" || !next.notice || next.notice === "端口不正确") {
    return;
  }
  const token = next.notice;
  noticeTimer = window.setTimeout(() => {
    noticeTimer = null;
    if (screen.kind === "claimed" && screen.notice === token) {
      setScreen({ ...screen, notice: "" });
    }
  }, 3200);
}

function setScreen(next: Screen): void {
  const needPeers = next.kind === "claimed" && (screen.kind !== "claimed" || peers.length === 0);
  screen = next;
  persistScreen(next);
  armNoticeTimer(next);
  render();
  if (next.kind === "waiting_open" || next.kind === "claimed") {
    openSocket(next.connectionId);
  } else {
    closeSocket();
  }
  if (next.kind === "idle" || next.kind === "error" || next.kind === "full") {
    scheduleJoinRetry();
  }
  if (needPeers && next.kind === "claimed") {
    void refreshPeers(next.connectionId);
  }
}

async function refreshPeers(connectionId: string): Promise<void> {
  try {
    peers = await listPeers(connectionId);
    if (screen.kind === "claimed") {
      render();
    }
  } catch {
    /* keep last list */
  }
}

function closeSocket(): void {
  if (heartbeat !== null) {
    window.clearInterval(heartbeat);
    heartbeat = null;
  }
  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
}

function openSocket(connectionId: string): void {
  if (socket && socket.readyState <= WebSocket.OPEN) {
    return;
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const url = `${proto}://${location.host}${wsPath(connectionId)}`;
  const ws = new WebSocket(url);
  socket = ws;
  ws.onmessage = (ev) => {
    try {
      const payload = JSON.parse(String(ev.data));
      setScreen(applyWsEvent(screen, payload));
    } catch {
      /* ignore malformed frames */
    }
  };
  ws.onopen = () => {
    if (heartbeat !== null) {
      window.clearInterval(heartbeat);
    }
    heartbeat = window.setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: "heartbeat" }));
      }
    }, 10_000);
  };
  ws.onclose = () => {
    socket = null;
    if (heartbeat !== null) {
      window.clearInterval(heartbeat);
      heartbeat = null;
    }
    if (screen.kind === "waiting_open" || screen.kind === "claimed") {
      scheduleReconnect(screen.connectionId);
    }
  };
}

function scheduleJoinRetry(): void {
  if (reconnectTimer !== null) {
    return;
  }
  reconnectTimer = window.setTimeout(async () => {
    reconnectTimer = null;
    if (screen.kind !== "idle" && screen.kind !== "error" && screen.kind !== "full") {
      return;
    }
    try {
      const fromUrl = currentStudentClient().connectionId;
      const next = await joinClassroom(fromUrl || null);
      setScreen(next);
    } catch {
      scheduleJoinRetry();
    }
  }, 1500);
}

function scheduleReconnect(connectionId: string): void {
  if (reconnectTimer !== null) {
    return;
  }
  reconnectTimer = window.setTimeout(async () => {
    reconnectTimer = null;
    try {
      const next = await joinClassroom(connectionId);
      setScreen(next);
    } catch {
      scheduleReconnect(connectionId);
    }
  }, 1000);
}

let bootStarted = false;

function pageIsActive(): boolean {
  const doc = document as Document & { prerendering?: boolean };
  return doc.visibilityState === "visible" && !doc.prerendering;
}

function waitUntilActive(): Promise<void> {
  if (pageIsActive()) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const tick = () => {
      if (!pageIsActive()) {
        return;
      }
      document.removeEventListener("visibilitychange", tick);
      document.removeEventListener("prerenderingchange", tick);
      resolve();
    };
    document.addEventListener("visibilitychange", tick);
    document.addEventListener("prerenderingchange", tick);
  });
}

async function boot(): Promise<void> {
  if (bootStarted) {
    return;
  }
  bootStarted = true;
  render();
  await waitUntilActive();
  try {
    const fromUrl = currentStudentClient().connectionId;
    const next = await joinClassroom(fromUrl || loadConnectionId());
    setScreen(next);
  } catch {
    bootStarted = false;
    setScreen({ kind: "error", message: "无法连接教师机" });
  }
}

app.addEventListener("click", (ev) => {
  const target = ev.target as HTMLElement;
  const closeDlg = target.closest("[data-dlg-close]");
  const onBackdrop = target.classList.contains("dlg-backdrop");
  if (closeDlg || onBackdrop) {
    if (target.closest(".forward-form") || (onBackdrop && target.querySelector(".forward-form"))) {
      return;
    }
    selectedPortId = null;
    if (screen.kind === "claimed" && screen.chatPrompt) {
      setScreen({ ...screen, chatPrompt: false });
      return;
    }
    render();
    return;
  }
  if (target.closest("[data-chat-start]") && screen.kind === "claimed") {
    setScreen({ ...screen, chatPrompt: true, chatError: "" });
    return;
  }
  if (target.closest("[data-chat-ping]") && screen.kind === "claimed") {
    const toIp = screen.chatPeerIp;
    if (!toIp) {
      return;
    }
    void sendPing(screen.connectionId, toIp)
      .then((res) => {
        setScreen(applyPingDetail(screen, res.detail));
      })
      .catch((err) => {
        const unreachable = err instanceof ApiError && err.code === "UNREACHABLE";
        setScreen(
          unreachable
            ? applyChatError(screen, MSG_CHAT_UNREACHABLE)
            : applyNotice(screen, err instanceof ApiError ? err.message : "ping 失败"),
        );
      });
    return;
  }
  const btn = target.closest<HTMLElement>(".port");
  if (!btn?.dataset.port) {
    return;
  }
  if (screen.kind === "claimed" && screen.device.kind === "tap") {
    return;
  }
  selectedPortId = btn.dataset.port;
  render();
});

app.addEventListener("submit", (ev) => {
  const form = ev.target as HTMLFormElement;
  if (!form.classList.contains("port-editor") || screen.kind !== "claimed") {
    return;
  }
  ev.preventDefault();
  const portId = form.dataset.port;
  if (!portId) {
    return;
  }
  const data = new FormData(form);
  const patch: { ip?: string; gateway?: string; peer_port_id?: string } = {};
  const peer = String(data.get("peer_port_id") || "");
  patch.peer_port_id = peer;
  const ip = String(data.get("ip") || "");
  if (ip) {
    patch.ip = ip;
  }
  const gateway = String(data.get("gateway") || "");
  if (gateway) {
    patch.gateway = gateway;
  }
  void putPort(screen.connectionId, screen.device.id, portId, patch)
    .then((body) => {
      setScreen(applyWsEvent(screen, { event: "topology.updated", ...(body as object) }));
    })
    .catch((err) => {
      setScreen(applyNotice(screen, err instanceof Error ? err.message : "保存端口失败"));
    });
});

app.addEventListener("submit", (ev) => {
  const form = ev.target as HTMLFormElement;
  if (screen.kind !== "claimed") {
    return;
  }
  if (form.classList.contains("chat-form")) {
    ev.preventDefault();
    const data = new FormData(form);
    const toIp = String(data.get("to_ip") || "");
    const text = String(data.get("text") || "");
    const conn = screen.connectionId;
    const req =
      screen.mode === "simulation" ? simSend(conn, toIp, text) : sendChat(conn, toIp, text);
    void req
      .then((body) => {
        const rec = body as { frame?: unknown };
        if (rec.frame) {
          setScreen(applyWsEvent(screen, { event: "frame.built", frame: rec.frame }));
        }
      })
      .catch((err) => {
        const unreachable = err instanceof ApiError && err.code === "UNREACHABLE";
        setScreen(
          unreachable
            ? applyChatError(screen, MSG_CHAT_UNREACHABLE)
            : applyNotice(screen, err instanceof ApiError ? err.message : "发送失败"),
        );
      });
    return;
  }
  if (form.classList.contains("wx-peer-form")) {
    ev.preventDefault();
    const ip = String(new FormData(form).get("peer_ip") || "").trim();
    setScreen({ ...screen, chatPeerIp: ip, chatPrompt: false, chatError: "" });
    return;
  }
  if (form.classList.contains("ping-form")) {
    ev.preventDefault();
    const data = new FormData(form);
    const toIp = String(data.get("to_ip") || "");
    void sendPing(screen.connectionId, toIp)
      .then((res) => {
        setScreen(applyPingDetail(screen, res.detail));
      })
      .catch((err) => {
        setScreen(applyNotice(screen, err instanceof ApiError ? err.message : "ping 失败"));
      });
    return;
  }
  if (form.classList.contains("forward-form")) {
    ev.preventDefault();
    const submitter = (ev as SubmitEvent).submitter as HTMLButtonElement | null;
    const outPort = submitter?.value || String(new FormData(form).get("out_port_id") || "");
    const frameId = screen.frame?.frame_id;
    if (!frameId || !outPort) {
      return;
    }
    void forwardFrame(screen.connectionId, frameId, outPort)
      .then((body) => {
        const rec = body as { frame?: unknown };
        if (rec.frame) {
          const next = applyWsEvent(screen, { event: "frame.repack", frame: rec.frame });
          if (next.kind === "claimed" && next.frame?.changed.length) {
            setScreen(next);
            return;
          }
        }
        setScreen(applyWsEvent(screen, { event: "frame.departed", frame_id: frameId }));
      })
      .catch((err) => {
        setScreen(applyNotice(screen, err instanceof ApiError ? err.message : "转发失败"));
      });
  }
});

let drag: { portId: string; dx: number; dy: number } | null = null;

app.addEventListener("pointerdown", (ev) => {
  const box = (ev.target as HTMLElement).closest<HTMLElement>(".peer-box");
  const stage = app.querySelector<HTMLElement>(".stage");
  if (!box?.dataset.port || !stage || stage.dataset.kind !== "switch") {
    return;
  }
  ev.preventDefault();
  const br = box.getBoundingClientRect();
  drag = {
    portId: box.dataset.port,
    dx: ev.clientX - br.left,
    dy: ev.clientY - br.top,
  };
  box.classList.add("dragging");
  box.setPointerCapture(ev.pointerId);
});

app.addEventListener("pointermove", (ev) => {
  if (!drag) {
    return;
  }
  const stage = app.querySelector<HTMLElement>(".stage");
  const box = app.querySelector<HTMLElement>(`.peer-box[data-port="${cssSel(drag.portId)}"]`);
  if (!stage || !box) {
    return;
  }
  const sr = stage.getBoundingClientRect();
  const left = ev.clientX - sr.left - drag.dx;
  const top = ev.clientY - sr.top - drag.dy;
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
  rememberPeerBox(drag.portId, left, top);
  layoutWires(app);
});

function endDrag(): void {
  if (!drag) {
    return;
  }
  app.querySelector(".peer-box.dragging")?.classList.remove("dragging");
  drag = null;
}

app.addEventListener("pointerup", endDrag);
app.addEventListener("pointercancel", endDrag);

function cssSel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

window.addEventListener("resize", () => {
  if (screen.kind === "claimed") {
    placePeerBoxes(app);
    layoutWires(app);
  }
});

void boot();

window.setInterval(() => {
  const clock = app.querySelector(".hud-clock");
  if (clock) {
    clock.textContent = hudClock();
  }
}, 1000);
