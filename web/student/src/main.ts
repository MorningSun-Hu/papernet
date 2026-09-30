import "./style.css";
import {
  applyChatError,
  applyNotice,
  applyWsEvent,
  currentStudentClient,
  documentTitle,
  MSG_CLASSROOM_FULL,
  MSG_WAITING_OPEN,
  MSG_NO_CLASSROOM,
  MSG_CHAT_UNREACHABLE,
  ROLE_LABEL,
  ROLE_SHELL,
  STORAGE_CLASSROOM,
  wsPath,
  type Screen,
} from "@shared/claim";
import { linuxPing, renderArpTable, renderComposeDialog, renderPcChat, renderPcHosts, renderWorkbench, withoutTapPorts } from "@shared/workbench";
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
let pingOpen = false;
let pingIp = "";
let pingLines: string[] = [];
let pingRunning = false;
let pingTimer: number | null = null;
let composeOpen = false;
let composeToIp = "";
let composeText = "";

type PortDraft = {
  portId: string;
  peer: string;
  ip: string;
  gateway: string;
  field: string;
  start: number | null;
  end: number | null;
};

function capturePortDraft(): PortDraft | null {
  const form = app.querySelector<HTMLFormElement>("form.port-editor");
  if (!form) {
    return null;
  }
  const active = document.activeElement;
  const field = active instanceof HTMLInputElement && form.contains(active) ? active.name : "";
  return {
    portId: form.dataset.port || "",
    peer: String(new FormData(form).get("peer_port_id") || ""),
    ip: String(new FormData(form).get("ip") || ""),
    gateway: String(new FormData(form).get("gateway") || ""),
    field,
    start: active instanceof HTMLInputElement ? active.selectionStart : null,
    end: active instanceof HTMLInputElement ? active.selectionEnd : null,
  };
}

function restorePortDraft(draft: PortDraft | null): void {
  if (!draft) {
    return;
  }
  const form = app.querySelector<HTMLFormElement>("form.port-editor");
  if (!form || form.dataset.port !== draft.portId) {
    return;
  }
  const peer = form.querySelector<HTMLInputElement>('[name="peer_port_id"]');
  const ip = form.querySelector<HTMLInputElement>('[name="ip"]');
  const gateway = form.querySelector<HTMLInputElement>('[name="gateway"]');
  if (peer) {
    peer.value = draft.peer;
  }
  if (ip) {
    ip.value = draft.ip;
  }
  if (gateway) {
    gateway.value = draft.gateway;
  }
  if (!draft.field) {
    return;
  }
  const el = form.querySelector<HTMLInputElement>(`[name="${draft.field}"]`);
  if (!el) {
    return;
  }
  el.focus();
  if (draft.start != null && draft.end != null) {
    el.setSelectionRange(draft.start, draft.end);
  }
}

function render(): void {
  const draft = capturePortDraft();
  app.innerHTML = htmlFor(screen);
  document.title = documentTitle(screen);
  if (screen.kind === "claimed") {
    placePeerBoxes(app);
    layoutWires(app);
    placeForwardDlg(app);
  }
  restorePortDraft(draft);
  const pingOut = app.querySelector(".ping-out");
  if (pingOut) {
    pingOut.scrollTop = pingOut.scrollHeight;
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
      hostsHtml: isPc ? renderPcHosts(s) : undefined,
      arpHtml: isPc ? renderArpTable(s) : undefined,
    },
    selectedPortId,
    withoutTapPorts(peers.filter((id) => !id.startsWith(`${s.device.id}/`))),
    s.tapAttach,
    selectedPortId && s.notice && s.notice !== "端口不正确" ? s.notice : "",
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
      ${isPc ? `<p class="hero-sub">动手实验 · 理解网络 · 从这里开始</p>` : ""}
      <div class="lab">
        ${statusAside(s)}
        ${stage.html}
        ${renderWorkbench(s, { chatInStage: isPc, arpInStage: isPc })}
      </div>
      ${routerPingDialog(s)}
      ${isPc && composeOpen ? renderComposeDialog(s, composeToIp, composeText) : ""}
      ${switchNotice(s)}
      <footer class="hud-foot">
        ${brandLockup()}
        <p>在实验中遇见更好的自己。</p>
      </footer>
    </main>
  `;
}

function switchNotice(s: Extract<Screen, { kind: "claimed" }>): string {
  if (selectedPortId || s.device.kind !== "switch" || !s.notice || s.notice === "端口不正确") {
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
      ${
        s.device.kind === "router"
          ? `<button type="button" class="status-ping" data-router-ping>ping</button>`
          : ""
      }
    </aside>
  `;
}

function closePing(): void {
  if (pingTimer != null) {
    window.clearTimeout(pingTimer);
    pingTimer = null;
  }
  pingOpen = false;
  pingRunning = false;
}

function playPing(toIp: string, reachable: boolean): void {
  if (pingTimer != null) {
    window.clearTimeout(pingTimer);
    pingTimer = null;
  }
  const script = linuxPing(toIp, reachable);
  pingLines = [script.header, ""];
  pingRunning = true;
  render();
  let i = 0;
  const step = () => {
    pingTimer = null;
    if (!pingOpen) {
      pingRunning = false;
      return;
    }
    if (i < script.replies.length) {
      pingLines = [...pingLines, script.replies[i]];
      i += 1;
      pingTimer = window.setTimeout(step, 1000);
      render();
      return;
    }
    pingLines = [...pingLines, "", ...script.stats];
    pingRunning = false;
    render();
  };
  pingTimer = window.setTimeout(step, 1000);
}

function routerPingDialog(s: Extract<Screen, { kind: "claimed" }>): string {
  if (!pingOpen || (s.device.kind !== "router" && s.device.kind !== "pc")) {
    return "";
  }
  const out = pingLines.length ? `<pre class="ping-out">${escapeHtml(pingLines.join("\n"))}</pre>` : "";
  return `
    <div class="dlg-backdrop" data-open="true">
      <form class="dlg router-ping-form">
        <header class="dlg-hd"><h3>ping</h3><button type="button" class="dlg-x" data-dlg-close>×</button></header>
        <p class="dlg-sub">填写目标 IP，发送 4 个探测包</p>
        <label>目标 IP <input name="to_ip" value="${escapeHtml(pingIp)}" required ${pingRunning ? "readonly" : ""} /></label>
        <div class="dlg-actions">
          <button type="submit" class="status-ping" ${pingRunning ? "disabled" : ""}>ping</button>
        </div>
        ${out}
      </form>
    </div>
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
  const classroomId =
    (screen.kind === "waiting_open" || screen.kind === "claimed") && screen.classroomId
      ? screen.classroomId
      : sessionStorage.getItem(STORAGE_CLASSROOM);
  const url = `${proto}://${location.host}${wsPath(connectionId, classroomId)}`;
  const ws = new WebSocket(url);
  socket = ws;
  ws.onmessage = (ev) => {
    try {
      const payload = JSON.parse(String(ev.data));
      const next = applyWsEvent(screen, payload);
      if (next === screen) {
        return;
      }
      setScreen(next);
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

let backdropArmed = false;

app.addEventListener(
  "blur",
  (ev) => {
    const el = ev.target;
    if (!(el instanceof HTMLInputElement) || el.name !== "peer_port_id") {
      return;
    }
    const next = el.value.toUpperCase();
    if (el.value !== next) {
      el.value = next;
    }
  },
  true,
);

app.addEventListener("input", (ev) => {
  const el = ev.target;
  if (!(el instanceof HTMLInputElement) || el.name !== "to_ip" || !el.closest(".router-ping-form")) {
    return;
  }
  pingIp = el.value;
});

app.addEventListener("click", (ev) => {
  const target = ev.target as HTMLElement;
  const closeDlg = target.closest("[data-dlg-close]");
  const onBackdrop = target.classList.contains("dlg-backdrop");
  const blockBackdrop = Boolean(target.closest(".forward-form") || (onBackdrop && target.querySelector(".forward-form")));
  if (closeDlg || onBackdrop) {
    if (blockBackdrop) {
      backdropArmed = false;
      return;
    }
    if (onBackdrop && !backdropArmed) {
      return;
    }
    backdropArmed = false;
    selectedPortId = null;
    if (pingOpen) {
      closePing();
      render();
      return;
    }
    if (composeOpen) {
      composeOpen = false;
      render();
      return;
    }
    if (screen.kind === "claimed" && screen.chatPrompt) {
      setScreen({ ...screen, chatPrompt: false });
      return;
    }
    render();
    return;
  }
  backdropArmed = false;
  if (target.closest(".dlg")) {
    return;
  }
  if (target.closest("[data-chat-start]") && screen.kind === "claimed") {
    setScreen({ ...screen, chatPrompt: true, chatError: "" });
    return;
  }
  if (target.closest("[data-router-ping]") && screen.kind === "claimed" && screen.device.kind === "router") {
    pingOpen = true;
    pingRunning = false;
    pingLines = [];
    render();
    return;
  }
  if (target.closest("[data-chat-ping]") && screen.kind === "claimed") {
    pingOpen = true;
    pingRunning = false;
    pingLines = [];
    pingIp = screen.chatPeerIp || pingIp;
    render();
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
  const peer = String(data.get("peer_port_id") || "").trim().toUpperCase();
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
      selectedPortId = null;
      const next = applyWsEvent(screen, { event: "topology.updated", ...(body as object) });
      setScreen(next.kind === "claimed" ? { ...next, notice: "" } : next);
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
  if (form.classList.contains("compose-form")) {
    ev.preventDefault();
    const toIp = composeToIp;
    const text = composeText;
    if (!toIp || !text) {
      return;
    }
    const conn = screen.connectionId;
    composeOpen = false;
    void simSend(conn, toIp, text)
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
  if (form.classList.contains("chat-form")) {
    ev.preventDefault();
    const data = new FormData(form);
    const toIp = String(data.get("to_ip") || "");
    const text = String(data.get("text") || "");
    if (screen.mode === "simulation") {
      composeToIp = toIp;
      composeText = text;
      composeOpen = true;
      render();
      return;
    }
    const conn = screen.connectionId;
    const req = sendChat(conn, toIp, text);
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
  if (form.classList.contains("router-ping-form")) {
    ev.preventDefault();
    const toIp = String(new FormData(form).get("to_ip") || "").trim();
    pingIp = toIp;
    if (!toIp || pingRunning) {
      return;
    }
    pingRunning = true;
    render();
    void sendPing(screen.connectionId, toIp)
      .then(() => {
        playPing(toIp, true);
      })
      .catch((err) => {
        const unreachable = err instanceof ApiError && err.code === "UNREACHABLE";
        if (unreachable) {
          playPing(toIp, false);
          return;
        }
        pingRunning = false;
        pingLines = [err instanceof ApiError ? err.message : "ping 失败"];
        render();
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
      .then(() => {
        setScreen(applyWsEvent(screen, { event: "frame.departed", frame_id: frameId }));
      })
      .catch((err) => {
        setScreen(applyNotice(screen, err instanceof ApiError ? err.message : "转发失败"));
      });
  }
});

let drag: { portId: string; dx: number; dy: number } | null = null;
let fwdDrag: { dx: number; dy: number } | null = null;
let fwdPos: { left: number; top: number } | null = null;

function placeForwardDlg(root: HTMLElement): void {
  const dlg = root.querySelector<HTMLElement>(".forward-form.dlg");
  if (!dlg || !fwdPos) {
    return;
  }
  dlg.style.position = "fixed";
  dlg.style.left = `${fwdPos.left}px`;
  dlg.style.top = `${fwdPos.top}px`;
  dlg.style.margin = "0";
  dlg.style.transform = "none";
}

function clampFwd(left: number, top: number, w: number, h: number): { left: number; top: number } {
  const pad = 8;
  const maxL = Math.max(pad, window.innerWidth - w - pad);
  const maxT = Math.max(pad, window.innerHeight - h - pad);
  return {
    left: Math.min(Math.max(left, pad), maxL),
    top: Math.min(Math.max(top, pad), maxT),
  };
}

function moveForwardDlg(ev: PointerEvent): void {
  if (!fwdDrag) {
    return;
  }
  const dlg = app.querySelector<HTMLElement>(".forward-form.dlg");
  if (!dlg) {
    return;
  }
  const next = clampFwd(ev.clientX - fwdDrag.dx, ev.clientY - fwdDrag.dy, dlg.offsetWidth, dlg.offsetHeight);
  fwdPos = next;
  dlg.style.position = "fixed";
  dlg.style.left = `${next.left}px`;
  dlg.style.top = `${next.top}px`;
  dlg.style.margin = "0";
  dlg.style.transform = "none";
}

app.addEventListener("pointerdown", (ev) => {
  const t = ev.target as HTMLElement;
  backdropArmed = t.classList.contains("dlg-backdrop") && !t.querySelector(".forward-form");
  const handle = t.closest<HTMLElement>("[data-fwd-drag]");
  const dlg = handle?.closest<HTMLElement>(".forward-form.dlg");
  if (dlg) {
    ev.preventDefault();
    const br = dlg.getBoundingClientRect();
    fwdDrag = { dx: ev.clientX - br.left, dy: ev.clientY - br.top };
    dlg.classList.add("dragging");
    dlg.setPointerCapture(ev.pointerId);
    return;
  }
  const box = t.closest<HTMLElement>(".peer-box");
  const stage = app.querySelector<HTMLElement>(".stage");
  if (!box?.dataset.port || !stage || (stage.dataset.kind !== "switch" && stage.dataset.kind !== "router" && stage.dataset.kind !== "tap" && stage.dataset.kind !== "pc")) {
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
  if (fwdDrag) {
    moveForwardDlg(ev);
    return;
  }
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
  if (fwdDrag) {
    app.querySelector(".forward-form.dlg")?.classList.remove("dragging");
    fwdDrag = null;
  }
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
