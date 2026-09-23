import "./style.css";
import routerUrl from "@icons/logical/router.svg?url";
import switchUrl from "@icons/logical/switch.svg?url";
import pcUrl from "@icons/logical/pc.svg?url";
import tapUrl from "@icons/logical/tap.svg?url";
import { wsPath } from "@shared/claim";
import { applyTopoEvent, parseTopoSnapshot, type TopoSnapshot } from "@shared/topo";
import { attachTap, createClassroom, fetchSnapshot, loadClassroomId, openClaim, setMode } from "./api";
import { renderCanvas } from "./canvas";

const app = mount();

function mount(): HTMLDivElement {
  const el = document.querySelector<HTMLDivElement>("#app");
  if (!el) {
    throw new Error("missing #app");
  }
  return el;
}

type FormState = {
  title: string;
  pcCount: number;
  switchCount: number;
  switchPorts: number;
  routerCount: number;
  routerPorts: number;
  tapCount: number;
};

const form: FormState = {
  title: "八年级1班",
  pcCount: 2,
  switchCount: 2,
  switchPorts: 4,
  routerCount: 1,
  routerPorts: 2,
  tapCount: 0,
};

let classroomId = loadClassroomId();
let claimState = classroomId ? "draft" : "";
let notice = "";
let snap: TopoSnapshot | null = null;
let socket: WebSocket | null = null;

const icons = {
  pc: pcUrl,
  switch: switchUrl,
  router: routerUrl,
  tap: tapUrl,
};

function render(): void {
  app.innerHTML = `
    <main>
      <header class="mast">
        <p class="eyebrow">纸上谈网 · 教师席</p>
        <h1>本课设备定员</h1>
        <div class="icons" aria-hidden="true">
          <img src="${pcUrl}" alt="" />
          <img src="${switchUrl}" alt="" />
          <img src="${routerUrl}" alt="" />
          <img src="${tapUrl}" alt="" />
        </div>
      </header>
      <form id="roster">
        <label>课堂名称
          <input name="title" value="${escapeAttr(form.title)}" />
        </label>
        <div class="grid">
          ${stepper("pcCount", "PC 台数", form.pcCount, 0, 48)}
          ${stepper("switchCount", "交换机台数", form.switchCount, 0, 24)}
          ${stepper("switchPorts", "交换机口数", form.switchPorts, 1, 24)}
          ${stepper("routerCount", "路由器台数", form.routerCount, 0, 12)}
          ${stepper("routerPorts", "路由器口数", form.routerPorts, 1, 8)}
          ${stepper("tapCount", "特殊双口交换机", form.tapCount, 0, 8)}
        </div>
        <div class="actions">
          <button type="submit" id="create">创建课堂</button>
          <button type="button" id="open" ${classroomId ? "" : "disabled"}>开放领取</button>
        </div>
      </form>
      <p class="status" data-claim="${escapeAttr(claimState)}">${statusLine()}</p>
      ${modeBar()}
      ${tapBar()}
      ${snap ? renderCanvas(snap, icons).html : ""}
    </main>
  `;
  bind();
}

function stepper(name: keyof FormState, label: string, value: number, min: number, max: number): string {
  return `
    <label>${label}
      <input name="${name}" type="number" min="${min}" max="${max}" value="${value}" />
    </label>
  `;
}

function statusLine(): string {
  if (notice) {
    return notice;
  }
  if (!classroomId) {
    return "填写数量后创建课堂。学生此时看到等待文案。";
  }
  if (claimState === "open" || claimState === "full") {
    return `课堂 ${classroomId} 已开放领取（${claimState}）。`;
  }
  return `课堂 ${classroomId} 已创建，尚未开放领取。`;
}

function modeBar(): string {
  if (!classroomId) {
    return "";
  }
  const mode = snap?.mode ?? "normal";
  return `
    <div class="mode-bar" data-mode="${mode}">
      <button type="button" data-mode="normal" ${mode === "normal" ? "disabled" : ""}>普通模式</button>
      <button type="button" data-mode="simulation" ${mode === "simulation" ? "disabled" : ""}>模拟模式</button>
    </div>
  `;
}

function tapBar(): string {
  if (!snap) {
    return "";
  }
  const taps = snap.devices.filter(
    (d) => d.kind === "tap" && !snap!.tapAttach.some((a) => a.tap_id === d.id),
  );
  const links = snap.links.filter((l) => l.physically_up);
  if (!taps.length || !links.length) {
    return "";
  }
  return `
    <form class="tap-form">
      <label>放置 TAP
        <select name="tap_id">${taps.map((t) => `<option value="${escapeAttr(t.id)}">${escapeHtml(t.id)}</option>`).join("")}</select>
      </label>
      <label>链路
        <select name="link">${links.map((l) => `<option value="${escapeAttr(l.port_a)}|${escapeAttr(l.port_b)}">${escapeHtml(l.port_a)} — ${escapeHtml(l.port_b)}</option>`).join("")}</select>
      </label>
      <button type="submit">挂接</button>
    </form>
  `;
}

function bind(): void {
  const roster = document.querySelector<HTMLFormElement>("#roster");
  roster?.addEventListener("input", () => {
    const data = new FormData(roster);
    form.title = String(data.get("title") || form.title);
    form.pcCount = num(data, "pcCount", form.pcCount);
    form.switchCount = num(data, "switchCount", form.switchCount);
    form.switchPorts = num(data, "switchPorts", form.switchPorts);
    form.routerCount = num(data, "routerCount", form.routerCount);
    form.routerPorts = num(data, "routerPorts", form.routerPorts);
    form.tapCount = num(data, "tapCount", form.tapCount);
  });
  roster?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    notice = "";
    try {
      classroomId = await createClassroom(form.title, form);
      claimState = "draft";
      await loadSnap();
    } catch (err) {
      notice = err instanceof Error ? err.message : "创建课堂失败";
    }
    render();
  });
  document.querySelector<HTMLButtonElement>("#open")?.addEventListener("click", async () => {
    if (!classroomId) {
      return;
    }
    notice = "";
    try {
      claimState = await openClaim(classroomId);
    } catch (err) {
      notice = err instanceof Error ? err.message : "开放领取失败";
    }
    render();
  });
}

function num(data: FormData, name: string, fallback: number): number {
  const raw = Number(data.get(name));
  return Number.isFinite(raw) ? raw : fallback;
}

function escapeAttr(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function escapeHtml(text: string): string {
  return escapeAttr(text).replaceAll(">", "&gt;");
}

async function loadSnap(): Promise<void> {
  if (!classroomId) {
    return;
  }
  try {
    snap = parseTopoSnapshot(await fetchSnapshot(classroomId));
    openSocket();
  } catch (err) {
    notice = err instanceof Error ? err.message : "读取拓扑失败";
  }
}

function openSocket(): void {
  if (!classroomId || (socket && socket.readyState <= WebSocket.OPEN)) {
    return;
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const url = `${proto}://${location.host}${wsPath(`teacher:${classroomId}`, classroomId)}`;
  const ws = new WebSocket(url);
  socket = ws;
  ws.onmessage = (ev) => {
    try {
      const payload = JSON.parse(String(ev.data));
      if (snap) {
        snap = applyTopoEvent(snap, payload);
        render();
      }
    } catch {
      /* ignore */
    }
  };
  ws.onclose = () => {
    socket = null;
  };
}

document.addEventListener("click", (ev) => {
  const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-mode]");
  if (!btn || !classroomId) {
    return;
  }
  const mode = btn.dataset.mode === "simulation" ? "simulation" : "normal";
  void setMode(classroomId, mode)
    .then((next) => {
      if (snap) {
        snap = { ...snap, mode: next === "simulation" ? "simulation" : "normal" };
      }
      render();
    })
    .catch((err) => {
      notice = err instanceof Error ? err.message : "切换模式失败";
      render();
    });
});

document.addEventListener("submit", (ev) => {
  const form = ev.target as HTMLFormElement;
  if (!form.classList.contains("tap-form") || !classroomId) {
    return;
  }
  ev.preventDefault();
  const data = new FormData(form);
  const tapId = String(data.get("tap_id") || "");
  const link = String(data.get("link") || "");
  const [portA, portB] = link.split("|");
  if (!tapId || !portA || !portB) {
    return;
  }
  void attachTap(classroomId, tapId, portA, portB)
    .then((body) => {
      if (snap) {
        snap = applyTopoEvent(snap, { event: "topology.updated", tap_attach: body });
      }
      render();
    })
    .catch((err) => {
      notice = err instanceof Error ? err.message : "挂接失败";
      render();
    });
});

void loadSnap().then(() => render());
