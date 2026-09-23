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
  type Device,
  type Screen,
} from "@shared/claim";
import { joinClassroom, loadConnectionId, persistScreen } from "./api";

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

function render(): void {
  app.innerHTML = htmlFor(screen);
}

function htmlFor(s: Screen): string {
  if (s.kind === "waiting_open") {
    return board(MSG_WAITING_OPEN, "wait");
  }
  if (s.kind === "full") {
    return board(MSG_CLASSROOM_FULL, "full");
  }
  if (s.kind === "claimed") {
    return claimedShell(s.device);
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

function claimedShell(device: Device): string {
  const shell = ROLE_SHELL[device.kind];
  const chassis = CHASSIS[device.kind] ?? switchUrl;
  return `
    <main class="shell" data-kind="${shell}">
      <header>
        <p class="eyebrow">纸上谈网 · 学生席</p>
        <h1>${escapeHtml(ROLE_LABEL[device.kind])}</h1>
        <p class="device-id">${escapeHtml(device.id)}</p>
      </header>
      <figure class="chassis">
        <img src="${chassis}" alt="${escapeHtml(ROLE_LABEL[device.kind])}底图" />
        ${device.kind === "pc" ? `<img class="rj45-mark" src="${rj45Url}" alt="RJ45" />` : ""}
      </figure>
      <p class="hint">设备舞台将在下一阶段叠加端口与接线。</p>
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
  screen = next;
  persistScreen(next);
  render();
  if (next.kind === "waiting_open" || next.kind === "claimed") {
    openSocket(next.connectionId);
  } else {
    closeSocket();
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

void boot();
