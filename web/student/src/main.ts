import "./style.css";
import switchUrl from "@icons/switch.svg?url";
import routerUrl from "@icons/router.svg?url";
import nicUrl from "@icons/nic.svg?url";
import rj45Url from "@icons/rj45.svg?url";
import {
  applyWsEvent,
  MSG_CLASSROOM_FULL,
  MSG_WAITING_OPEN,
  ROLE_LABEL,
  ROLE_SHELL,
  wsPath,
  type Screen,
} from "@shared/claim";
import { joinClassroom, listPeers, loadConnectionId, persistScreen, putPort } from "./api";
import { layoutWires, renderStage } from "./stage";

const app = mount();

function mount(): HTMLDivElement {
  const el = document.querySelector<HTMLDivElement>("#app");
  if (!el) {
    throw new Error("missing #app");
  }
  return el;
}

const CHASSIS: Record<string, string> = {
  pc: nicUrl,
  switch: switchUrl,
  router: routerUrl,
  tap: switchUrl,
};

let screen: Screen = { kind: "idle", message: "正在加入课堂…" };
let socket: WebSocket | null = null;
let heartbeat: number | null = null;
let reconnectTimer: number | null = null;
let selectedPortId: string | null = null;
let peers: string[] = [];

function render(): void {
  app.innerHTML = htmlFor(screen);
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
  const chassis = CHASSIS[s.device.kind] ?? switchUrl;
  const stage = renderStage(
    s.device,
    s.links,
    { chassis, rj45: rj45Url },
    selectedPortId,
    peers.filter((id) => !id.startsWith(`${s.device.id}/`)),
  );
  return `
    <main class="shell" data-kind="${shell}">
      <header>
        <p class="eyebrow">纸上谈网 · 学生席</p>
        <h1>${escapeHtml(ROLE_LABEL[s.device.kind])}</h1>
        <p class="device-id">${escapeHtml(s.device.id)}</p>
      </header>
      ${stage.html}
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
    const next = await joinClassroom(loadConnectionId());
    setScreen(next);
  } catch {
    setScreen({ kind: "error", message: "无法连接教师机" });
  }
}

app.addEventListener("click", (ev) => {
  const btn = (ev.target as HTMLElement).closest<HTMLElement>(".port");
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
  if (peer) {
    patch.peer_port_id = peer;
  }
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
    .catch(() => {
      /* keep current stage */
    });
});

window.addEventListener("resize", () => {
  if (screen.kind === "claimed") {
    layoutWires(app);
  }
});

void boot();
