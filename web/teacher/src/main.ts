import "./style.css";
import routerUrl from "@icons/logical/router.svg?url";
import switchUrl from "@icons/logical/switch.svg?url";
import pcUrl from "@icons/logical/pc.svg?url";
import tapUrl from "@icons/logical/tap.svg?url";
import { buildInventory, formatClaimRoster, targetClassroomInventory, wsPath } from "@shared/claim";
import { applyTopoEvent, buildTopo, parseTopoSnapshot, type TopoLayout, type TopoSnapshot, type TopoView } from "@shared/topo";
import { attachTap, createClassroom, endClassroom, fetchSnapshot, loadClassroomId, openClaim, setMode, unbindDevice } from "./api";
import { patchTopo, renderCanvas } from "./canvas";

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
let targetScene = false;
let menu: { x: number; y: number; deviceId: string } | null = null;
let layout: TopoLayout = {};
let lastView: TopoView | null = null;

const icons = {
  pc: pcUrl,
  switch: switchUrl,
  router: routerUrl,
  tap: tapUrl,
};

function render(): void {
  const claiming = claimState === "open" || claimState === "full";
  const canvas = snap ? renderCanvas(snap, icons, layout) : null;
  lastView = canvas?.view ?? null;
  app.innerHTML = `
    <main class="console" data-phase="${claiming ? "live" : "draft"}">
      <header class="mast hud">
        <div class="brand">
          <p class="eyebrow">纸上谈网 · 教师席</p>
          <h1>${claiming ? "课堂拓扑" : "本课设备定员"}</h1>
        </div>
        <div class="icons" aria-hidden="true">
          <img src="${pcUrl}" alt="" />
          <img src="${switchUrl}" alt="" />
          <img src="${routerUrl}" alt="" />
          <img src="${tapUrl}" alt="" />
        </div>
        ${claiming ? `<button type="button" id="end">结束课堂</button>` : ""}
      </header>
      ${claiming ? liveDeck(canvas?.html ?? "") : draftDeck()}
      ${unbindMenu()}
    </main>
  `;
  bind();
}

function liveDeck(canvasHtml: string): string {
  return `
    <div class="deck">
      <aside class="rail">
        <p class="status" data-claim="${escapeAttr(claimState)}">${statusLine()}</p>
        ${modeBar()}
        ${tapBar()}
      </aside>
      ${canvasHtml}
    </div>
  `;
}

function draftDeck(): string {
  return `
    <div class="draft">
      ${rosterForm()}
      <p class="status" data-claim="${escapeAttr(claimState)}">${statusLine()}</p>
      ${modeBar()}
      ${tapBar()}
    </div>
  `;
}

function rosterForm(): string {
  return `
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
        ${stepper("tapCount", "网络分流器", form.tapCount, 0, 8)}
      </div>
      <div class="actions">
        <button type="submit" id="create">创建课堂</button>
        <button type="button" id="target-scene">载入目标课堂</button>
        <button type="button" id="open" ${classroomId ? "" : "disabled"}>开放领取</button>
      </div>
    </form>
  `;
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
  if (claimState !== "open" && claimState !== "full") {
    return "课堂已创建，尚未开放领取。";
  }
  if (!snap) {
    return claimState === "full" ? "本课设备已领完。" : "已开放领取。";
  }
  const roster = formatClaimRoster(snap.devices);
  const bits = [`已领取 ${roster.taken}/${roster.total}`];
  if (roster.claimed) {
    bits.push(`已领 ${roster.claimed}`);
  }
  if (roster.free) {
    bits.push(`未领 ${roster.free}`);
  }
  const head = claimState === "full" ? "本课设备已领完。" : "已开放领取。";
  return `${head}${bits.join("。")}`;
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
  const taps = snap.devices.filter((d) => d.kind === "tap");
  const links = snap.links.filter((l) => l.physically_up);
  if (!taps.length || !links.length) {
    return "";
  }
  const current = new Map(snap.tapAttach.map((row) => [row.tap_id, row.link_id]));
  return `
    <form class="tap-form">
      <label>挂接网络分流器
        <select name="tap_id">${taps
          .map((t) => {
            const hung = current.get(t.id);
            const mark = hung ? "（已挂接）" : "";
            return `<option value="${escapeAttr(t.id)}">${escapeHtml(t.id)}${mark}</option>`;
          })
          .join("")}</select>
      </label>
      <label>链路
        <select name="link">${links
          .map((l) => `<option value="${escapeAttr(l.port_a)}|${escapeAttr(l.port_b)}">${escapeHtml(l.port_a)} — ${escapeHtml(l.port_b)}</option>`)
          .join("")}</select>
      </label>
      <button type="submit">挂接</button>
    </form>
  `;
}

function unbindMenu(): string {
  if (!menu) {
    return "";
  }
  return `
    <div class="ctx-menu" style="left:${menu.x}px;top:${menu.y}px">
      <button type="button" data-unbind="${escapeAttr(menu.deviceId)}">解除绑定</button>
    </div>
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
    targetScene = false;
  });
  roster?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    notice = "";
    try {
      classroomId = await createClassroom(
        form.title,
        form,
        targetScene ? targetClassroomInventory() : undefined,
      );
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
      await loadSnap();
    } catch (err) {
      notice = err instanceof Error ? err.message : "开放领取失败";
    }
    render();
  });
  document.querySelector<HTMLButtonElement>("#target-scene")?.addEventListener("click", () => {
    form.title = "目标课堂";
    form.pcCount = 2;
    form.switchCount = 2;
    form.switchPorts = 2;
    form.routerCount = 1;
    form.routerPorts = 2;
    form.tapCount = 0;
    targetScene = true;
    notice = "已载入目标课堂：PCA — S1 — R1 — S2 — PCB";
    render();
  });
  document.querySelector<HTMLButtonElement>("#end")?.addEventListener("click", async () => {
    if (!classroomId) {
      return;
    }
    notice = "";
    try {
      await endClassroom(classroomId);
      classroomId = null;
      claimState = "";
      snap = null;
      lastView = null;
      layout = {};
      if (socket) {
        socket.onclose = null;
        socket.close();
        socket = null;
      }
    } catch (err) {
      notice = err instanceof Error ? err.message : "结束课堂失败";
    }
    render();
  });
  bindTopoDrag();
}

function num(data: FormData, name: string, fallback: number): number {
  const raw = Number(data.get(name));
  return Number.isFinite(raw) ? raw : fallback;
}

function bindTopoDrag(): void {
  const svg = app.querySelector<SVGSVGElement>(".topo svg");
  if (!svg) {
    return;
  }
  for (const g of svg.querySelectorAll<SVGGElement>("g.node")) {
    g.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0 || !snap) {
        return;
      }
      const id = g.dataset.id || "";
      if (!id) {
        return;
      }
      ev.preventDefault();
      const origin = lastView?.nodes.find((n) => n.id === id);
      const pt = svgPoint(svg, ev);
      const dx = pt.x - (origin?.x ?? 0);
      const dy = pt.y - (origin?.y ?? 0);
      const move = (e: PointerEvent) => {
        const next = svgPoint(svg, e);
        layout = { ...layout, [id]: { x: next.x - dx, y: next.y - dy } };
        lastView = buildTopo(snap, layout);
        patchTopo(svg, lastView);
      };
      const up = () => {
        g.removeEventListener("pointermove", move);
        g.removeEventListener("pointerup", up);
      };
      g.addEventListener("pointermove", move);
      g.addEventListener("pointerup", up);
      g.setPointerCapture(ev.pointerId);
    });
  }
}

function svgPoint(svg: SVGSVGElement, ev: PointerEvent): { x: number; y: number } {
  const pt = svg.createSVGPoint();
  pt.x = ev.clientX;
  pt.y = ev.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) {
    return { x: 0, y: 0 };
  }
  const mapped = pt.matrixTransform(ctm.inverse());
  return { x: mapped.x, y: mapped.y };
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
    const raw = await fetchSnapshot(classroomId);
    snap = parseTopoSnapshot(raw);
    const rec = raw && typeof raw === "object" ? (raw as { claim_state?: string }) : {};
    if (rec.claim_state === "open" || rec.claim_state === "full" || rec.claim_state === "draft") {
      claimState = rec.claim_state;
    }
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
      if (payload.event === "claim.full") {
        claimState = "full";
      }
      if (
        payload.event === "classroom.online" ||
        payload.event === "claim.full" ||
        payload.event === "claim.released"
      ) {
        void loadSnap().then(() => render());
        return;
      }
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
      const next = { ...layout };
      delete next[tapId];
      layout = next;
      render();
    })
    .catch((err) => {
      notice = err instanceof Error ? err.message : "挂接失败";
      render();
    });
});

document.addEventListener("contextmenu", (ev) => {
  const node = (ev.target as Element | null)?.closest?.("g.node");
  if (!node) {
    if (menu) {
      menu = null;
      render();
    }
    return;
  }
  ev.preventDefault();
  const el = node as HTMLElement;
  if (el.dataset.claimed !== "true") {
    notice = "该设备尚未绑定";
    menu = null;
    render();
    return;
  }
  menu = { x: ev.clientX, y: ev.clientY, deviceId: el.dataset.id || "" };
  notice = "";
  render();
});

document.addEventListener("click", (ev) => {
  const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-unbind]");
  if (btn && classroomId) {
    const deviceId = btn.dataset.unbind || "";
    menu = null;
    void unbindDevice(classroomId, deviceId)
      .then(() => loadSnap())
      .then(() => {
        notice = `已解除 ${deviceId} 的绑定`;
        render();
      })
      .catch((err) => {
        notice = err instanceof Error ? err.message : "解除绑定失败";
        render();
      });
    return;
  }
  if (menu) {
    menu = null;
    render();
  }
});

void loadSnap().then(() => render());
