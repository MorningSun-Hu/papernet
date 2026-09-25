import "./style.css";
import switchUrl from "@icons/switch.svg?url";
import routerUrl from "@icons/router.svg?url";
import switchManyUrl from "@icons/switch-many.svg?url";
import pcFrontUrl from "@icons/pc-front.svg?url";
import pcBackUrl from "@icons/pc-back.svg?url";
import rj45Url from "@icons/rj45.svg?url";
import {
  applyChatError,
  applyNotice,
  applyPingDetail,
  applyWsEvent,
  currentStudentClient,
  documentTitle,
  MSG_CLASSROOM_FULL,
  MSG_WAITING_OPEN,
  MSG_CHAT_UNREACHABLE,
  ROLE_LABEL,
  ROLE_SHELL,
  wsPath,
  type Screen,
} from "@shared/claim";
import { renderPcChat, renderWorkbench, withoutTapPorts } from "@shared/workbench";
import { switchChassisKind } from "@shared/stage";
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
import { layoutWires, renderStage } from "./stage";

const app = mount();

function mount(): HTMLDivElement {
  const el = document.querySelector<HTMLDivElement>("#app");
  if (!el) {
    throw new Error("missing #app");
  }
  return el;
}

function chassisFor(kind: string, portCount: number): string {
  if (kind === "pc") {
    return pcBackUrl;
  }
  if (kind === "router") {
    return routerUrl;
  }
  if (kind === "switch" && switchChassisKind(portCount) === "switch-many") {
    return switchManyUrl;
  }
  return switchUrl;
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
  const chassis = chassisFor(s.device.kind, s.device.ports.length);
  const isPc = s.device.kind === "pc";
  const stage = renderStage(
    s.device,
    s.links,
    {
      chassis,
      front: isPc ? pcFrontUrl : undefined,
      rj45: rj45Url,
      chatHtml: isPc ? renderPcChat(s) : undefined,
    },
    selectedPortId,
    withoutTapPorts(peers.filter((id) => !id.startsWith(`${s.device.id}/`))),
    s.tapAttach,
  );
  return `
    <main class="shell" data-kind="${shell}">
      <header class="hud">
        <p class="eyebrow">纸上谈网 · 学生席</p>
        <h1>${escapeHtml(ROLE_LABEL[s.device.kind])}</h1>
        <p class="device-id">${escapeHtml(s.device.id)}</p>
      </header>
      <div class="lab">
        ${stage.html}
        ${renderWorkbench(s, { chatInStage: isPc })}
      </div>
    </main>
  `;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setScreen(next: Screen): void {
  const needPeers = next.kind === "claimed" && (screen.kind !== "claimed" || peers.length === 0);
  screen = next;
  persistScreen(next);
  render();
  if (next.kind === "waiting_open" || next.kind === "claimed") {
    openSocket(next.connectionId);
  } else {
    closeSocket();
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

async function boot(): Promise<void> {
  render();
  try {
    const fromUrl = currentStudentClient().connectionId;
    const next = await joinClassroom(fromUrl || loadConnectionId());
    setScreen(next);
  } catch {
    setScreen({ kind: "error", message: "无法连接教师机" });
  }
}

app.addEventListener("click", (ev) => {
  const target = ev.target as HTMLElement;
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

window.addEventListener("resize", () => {
  if (screen.kind === "claimed") {
    layoutWires(app);
  }
});

void boot();
