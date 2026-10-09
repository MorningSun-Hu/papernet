import "./style.css";
import { buildInventory, formatClaimRoster, labTestInventory, wsPath } from "@shared/claim";
import { brandLockup, hudClock, hudVersion } from "@shared/brand";
import { applyTopoEvent, arrangeTopo, buildTopo, parseTopoSnapshot, type TopoLayout, type TopoSnapshot, type TopoView } from "@shared/topo";
import { attachTap, clearClassroomId, createClassroom, endClassroom, fetchCurrentClassroomId, fetchSnapshot, loadClassroomId, openClaim, pauseClaim, setMode, unbindDevice } from "./api";
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
  routerIps: string[];
};

const form: FormState = {
  title: "八年级1班",
  pcCount: 2,
  switchCount: 2,
  switchPorts: 4,
  routerCount: 1,
  routerPorts: 2,
  tapCount: 0,
  routerIps: ["", ""],
};

let classroomId = loadClassroomId();
let claimState = classroomId ? "draft" : "";
let notice = "";
let snap: TopoSnapshot | null = null;
let socket: WebSocket | null = null;
let labTestMode = false;
let menu: { x: number; y: number; deviceId: string } | null = null;
let layout: TopoLayout = {};
let lastView: TopoView | null = null;
let topoZoom = 100;
let railOpen: "claim" | "tap" | "" = "claim";
let claimFoldedByFull = false;
let tapPick = { tapId: "", link: "" };

const FIELD_LIMIT: Record<string, { min: number; max: number }> = {
  pcCount: { min: 0, max: 48 },
  switchCount: { min: 0, max: 24 },
  routerCount: { min: 0, max: 12 },
  tapCount: { min: 0, max: 8 },
  switchPorts: { min: 1, max: 24 },
  routerPorts: { min: 1, max: 3 },
};

function render(): void {
  const live = Boolean(classroomId);
  const canvas = snap ? renderCanvas(snap, {}, layout, topoZoom) : null;
  lastView = canvas?.view ?? null;
  app.innerHTML = `
    <main class="console" data-phase="${live ? "live" : "draft"}">
      <header class="mast hud">
        ${brandLockup()}
        <div class="brand">
          <h1>纸上谈网 · 教师席</h1>
          <p class="eyebrow">以实践见真知 · 让网络触手可及</p>
        </div>
        <p class="hud-clock">${hudClock()}</p>
        ${hudVersion()}
        ${live ? `${modeBar()}${claimToggle()}<button type="button" id="end">结束课堂</button>` : ""}
      </header>
      ${live ? liveDeck(canvas?.html ?? "") : `<div class="topo-empty"><p>暂无拓扑，先确定本课设备</p></div>`}
      ${live ? "" : rosterDialog()}
      ${unbindMenu()}
    </main>
  `;
  bind();
}

function liveDeck(canvasHtml: string): string {
  const roster = snap ? formatClaimRoster(snap.devices) : { taken: 0, total: 0, claimed: "", free: "" };
  if (roster.total > 0 && roster.taken === roster.total) {
    if (!claimFoldedByFull) {
      if (railOpen === "claim") {
        railOpen = "";
      }
      claimFoldedByFull = true;
    }
  } else {
    claimFoldedByFull = false;
  }
  const claimOpen = railOpen === "claim";
  const tapHtml = tapBar();
  const tapOpen = railOpen === "tap";
  return `
    <div class="deck">
      <aside class="rail">
        <section class="acc" data-acc="claim" data-open="${claimOpen}">
          <button type="button" class="acc-hd" data-acc-toggle="claim">
            <span>设备领取</span>
            <strong>已领取 ${roster.taken}/${roster.total}</strong>
          </button>
          ${claimOpen ? `<div class="acc-bd">${claimPanel()}</div>` : ""}
        </section>
        ${
          tapHtml
            ? `<section class="acc" data-acc="tap" data-open="${tapOpen}">
          <button type="button" class="acc-hd" data-acc-toggle="tap">
            <span>挂接网络分流器</span>
          </button>
          ${tapOpen ? `<div class="acc-bd">${tapHtml}</div>` : ""}
        </section>`
            : ""
        }
        <p class="tip">从左侧查看领取进度，在拓扑图中右击已领设备可解除绑定。</p>
      </aside>
      ${canvasHtml}
    </div>
  `;
}

function rosterDialog(): string {
  const ips = Array.from({ length: Math.max(1, form.routerPorts) }, (_, i) => form.routerIps[i] || "");
  const switchIds = Array.from({ length: form.switchCount }, (_, i) => `S${i + 1}`).join("、") || "—";
  const routerIds = Array.from({ length: form.routerCount }, (_, i) => `R${i + 1}`).join("、") || "—";
  return `
    <div class="dlg-backdrop" data-open="true">
      <form id="roster" class="dlg roster-dlg">
        <header class="dlg-hd">
          ${brandLockup()}
          <div>
            <h3>确定本课设备</h3>
            <p class="dlg-sub">课前定员、定设备，创建课堂后本窗口收起。</p>
            ${hudVersion()}
          </div>
        </header>
        <section class="dlg-block">
          <h4>定员</h4>
          <label>课堂名称 <input name="title" value="${escapeAttr(form.title)}" /></label>
          <div class="grid">
            ${stepper("pcCount", "PC 台数", form.pcCount, 0, 48)}
            ${stepper("switchCount", "交换机台数", form.switchCount, 0, 24)}
            ${stepper("routerCount", "路由器台数", form.routerCount, 0, 12)}
            ${stepper("tapCount", "网络分流器", form.tapCount, 0, 8)}
          </div>
        </section>
        <section class="dlg-block">
          <h4>定设备</h4>
          <div class="grid">
            ${stepper("switchPorts", "交换机口数", form.switchPorts, 1, 24)}
            ${stepper("routerPorts", "路由器口数", form.routerPorts, 1, 3)}
          </div>
          <p class="hint">应用于每台交换机：${escapeHtml(switchIds)}。设备：${escapeHtml(routerIds)}。</p>
          <fieldset class="preset-ips">
            <legend>预置路由器口 IP</legend>
            ${ips
              .map(
                (ip, i) =>
                  `<label>R1/${String(i + 1).padStart(2, "0")} <input name="router_ip_${i}" value="${escapeAttr(ip)}" placeholder="可选" /></label>`,
              )
              .join("")}
            <p class="hint">不填则由领取该路由器的学生填写。掩码固定 255.255.255.0</p>
          </fieldset>
        </section>
        <p class="status" data-claim="${escapeAttr(claimState)}">${statusLine()}</p>
        <div class="dlg-actions">
          <button type="button" id="lab-test">载入环境测试任务</button>
          <button type="submit" id="create">创建课堂</button>
        </div>
      </form>
    </div>
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
  if (claimState === "paused") {
    return "领取已暂停。学生此时看到等待文案。";
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

function claimBrief(): string {
  if (!classroomId) {
    return "先确定本课设备。";
  }
  if (claimState === "paused") {
    return "领取已暂停。";
  }
  if (claimState === "full") {
    return "本课设备已领完。";
  }
  if (claimState === "open") {
    return "已开放领取。";
  }
  return "课堂已创建，尚未开放领取。";
}

function claimDeviceRows(claimed: boolean): string {
  if (!snap) {
    return "<li>暂无</li>";
  }
  const order: Record<string, number> = { pc: 0, switch: 1, router: 2, tap: 3 };
  const rows = snap.devices
    .filter((d) => d.claimed === claimed)
    .sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || a.id.localeCompare(b.id, "en", { numeric: true }));
  if (!rows.length) {
    return "<li>暂无</li>";
  }
  return rows
    .map((d) => {
      const label = d.kind === "pc" ? "PC" : d.kind === "switch" ? "交换机" : d.kind === "router" ? "路由器" : "网络分流器";
      return `<li data-kind="${escapeAttr(d.kind)}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(d.id)}</strong></li>`;
    })
    .join("");
}

function claimPanel(): string {
  const roster = snap ? formatClaimRoster(snap.devices) : { taken: 0, total: 0, claimed: "", free: "" };
  const pct = roster.total ? Math.round((roster.taken / roster.total) * 100) : 0;
  return `
    <p class="status" data-claim="${escapeAttr(claimState)}">${claimBrief()}</p>
    <div class="claim-meter">
      <p>已领取 <strong>${roster.taken}/${roster.total}</strong></p>
      <span class="meter"><i style="width:${pct}%"></i></span>
    </div>
    <div class="claim-list">
      <h3>已领取</h3>
      <ul>${claimDeviceRows(true)}</ul>
    </div>
    <div class="claim-list free">
      <h3>未领取</h3>
      <ul>${claimDeviceRows(false)}</ul>
    </div>
  `;
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

function claimToggle(): string {
  if (!classroomId) {
    return "";
  }
  const full = claimState === "full";
  if (claimState === "open") {
    return `<button type="button" id="pause"${full ? " disabled" : ""}>暂停领取</button>`;
  }
  return `<button type="button" id="open"${full || labTestMode ? " disabled" : ""}>开放领取</button>`;
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
  const tapId = taps.some((t) => t.id === tapPick.tapId) ? tapPick.tapId : taps[0].id;
  const linkValue = (portA: string, portB: string) => `${portA}|${portB}`;
  const linkSel = links.some((l) => linkValue(l.port_a, l.port_b) === tapPick.link)
    ? tapPick.link
    : linkValue(links[0].port_a, links[0].port_b);
  return `
    <form class="tap-form">
      <fieldset class="tap-pick">
        <legend>网络分流器</legend>
        ${taps
          .map((t) => {
            const hung = current.get(t.id);
            const mark = hung ? "（已挂接）" : "";
            const on = t.id === tapId ? "checked" : "";
            return `<label class="tap-opt"><input type="radio" name="tap_id" value="${escapeAttr(t.id)}" ${on} /><span>${escapeHtml(t.id)}${mark}</span></label>`;
          })
          .join("")}
      </fieldset>
      <fieldset class="tap-pick tap-links">
        <legend>链路</legend>
        <div class="tap-opt-list">
          ${links
            .map((l) => {
              const value = linkValue(l.port_a, l.port_b);
              const on = value === linkSel ? "checked" : "";
              return `<label class="tap-opt"><input type="radio" name="link" value="${escapeAttr(value)}" ${on} /><span>${escapeHtml(l.port_a)} — ${escapeHtml(l.port_b)}</span></label>`;
            })
            .join("")}
        </div>
      </fieldset>
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
    clampRosterInputs(roster, false);
    syncRosterForm(roster);
  });
  roster?.addEventListener("change", () => {
    clampRosterInputs(roster, true);
    const ports = roster.querySelectorAll('input[name^="router_ip_"]').length;
    syncRosterForm(roster);
    if (form.routerPorts !== ports) {
      render();
    }
  });
  roster?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    notice = "";
    try {
      classroomId = await createClassroom(
        form.title,
        form,
        inventoryFromForm(),
      );
      claimState = "draft";
      labTestMode = false;
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
  document.querySelector<HTMLButtonElement>("#pause")?.addEventListener("click", async () => {
    if (!classroomId) {
      return;
    }
    notice = "";
    try {
      claimState = await pauseClaim(classroomId);
      await loadSnap();
    } catch (err) {
      notice = err instanceof Error ? err.message : "暂停领取失败";
    }
    render();
  });
  for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-acc-toggle]")) {
    btn.addEventListener("click", () => {
      const id = btn.dataset.accToggle;
      if (id !== "claim" && id !== "tap") {
        return;
      }
      railOpen = railOpen === id ? "" : id;
      render();
    });
  }
  document.querySelector<HTMLButtonElement>("#lab-test")?.addEventListener("click", async () => {
    const rosterEl = document.querySelector<HTMLFormElement>("#roster");
    if (rosterEl) {
      clampRosterInputs(rosterEl, true);
      syncRosterForm(rosterEl);
    }
    notice = "";
    try {
      classroomId = await createClassroom(form.title, form, labTestInventory(form));
      claimState = await openClaim(classroomId);
      labTestMode = true;
      notice = "已载入环境测试任务，领取已开放。";
      await loadSnap();
    } catch (err) {
      notice = err instanceof Error ? err.message : "载入环境测试任务失败";
    }
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
      railOpen = "claim";
      claimFoldedByFull = false;
      labTestMode = false;
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
  bindTopoTools();
  bindTapPick();
}

function bindTapPick(): void {
  const form = app.querySelector<HTMLFormElement>(".tap-form");
  form?.addEventListener("change", () => {
    const data = new FormData(form);
    tapPick = {
      tapId: String(data.get("tap_id") || ""),
      link: String(data.get("link") || ""),
    };
  });
}

function bindTopoTools(): void {
  const tools = app.querySelector(".topo-tools");
  if (!tools) {
    return;
  }
  tools.querySelector<HTMLButtonElement>("[data-topo-zoom=out]")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    topoZoom = Math.max(50, topoZoom - 10);
    render();
  });
  tools.querySelector<HTMLButtonElement>("[data-topo-zoom=in]")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    topoZoom = Math.min(110, topoZoom + 10);
    render();
  });
  tools.querySelector<HTMLButtonElement>("[data-topo-arrange]")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (!snap) {
      return;
    }
    layout = arrangeTopo(snap);
    render();
  });
}

function num(data: FormData, name: string, fallback: number): number {
  const raw = Number(data.get(name));
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  const lim = FIELD_LIMIT[name];
  if (!lim) {
    return raw;
  }
  return Math.min(lim.max, Math.max(lim.min, raw));
}

function clampRosterInputs(roster: HTMLFormElement, clampMin: boolean): void {
  for (const el of roster.querySelectorAll<HTMLInputElement>("input[type=number]")) {
    const lim = FIELD_LIMIT[el.name];
    if (!lim || el.value === "") {
      continue;
    }
    const n = Number(el.value);
    if (!Number.isFinite(n)) {
      continue;
    }
    let next = n;
    if (n > lim.max) {
      next = lim.max;
    } else if (clampMin && n < lim.min) {
      next = lim.min;
    }
    if (String(next) !== el.value) {
      el.value = String(next);
    }
  }
}

function syncRosterForm(roster: HTMLFormElement): void {
  const data = new FormData(roster);
  form.title = String(data.get("title") || form.title);
  form.pcCount = num(data, "pcCount", form.pcCount);
  form.switchCount = num(data, "switchCount", form.switchCount);
  form.switchPorts = num(data, "switchPorts", form.switchPorts);
  form.routerCount = num(data, "routerCount", form.routerCount);
  form.routerPorts = num(data, "routerPorts", form.routerPorts);
  form.tapCount = num(data, "tapCount", form.tapCount);
  form.routerIps = Array.from({ length: Math.max(1, form.routerPorts) }, (_, i) =>
    String(data.get(`router_ip_${i}`) || ""),
  );
}

function inventoryFromForm() {
  const inventory = buildInventory(form);
  if (!inventory.routers.length) {
    return inventory;
  }
  return {
    ...inventory,
    routers: inventory.routers.map((router, index) => {
      if (index > 0) {
        return router;
      }
      const ports = Array.from({ length: router.port_count }, (_, i) => ({
        id: `${router.id}/${String(i + 1).padStart(2, "0")}`,
        ip: form.routerIps[i]?.trim() || "",
      })).filter((port) => port.ip);
      return ports.length ? { ...router, ports } : router;
    }),
  };
}

function bindTopoDrag(): void {
  const topo = app.querySelector<HTMLElement>(".topo");
  const world = topo?.querySelector<HTMLElement>(".topo-world");
  if (!topo || !world) {
    return;
  }
  const fit = topo.querySelector<HTMLElement>(".topo-fit") ?? world;
  for (const g of topo.querySelectorAll<HTMLElement>(".node")) {
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
      const pt = pointerToLayout(fit, ev);
      const dx = pt.x - (origin?.x ?? 0);
      const dy = pt.y - (origin?.y ?? 0);
      const move = (e: PointerEvent) => {
        const next = pointerToLayout(fit, e);
        layout = { ...layout, [id]: { x: next.x - dx, y: next.y - dy } };
        if (!snap) {
          return;
        }
        lastView = buildTopo(snap, layout);
        patchTopo(topo, lastView);
      };
      const up = () => {
        g.removeEventListener("pointermove", move);
        g.removeEventListener("pointerup", up);
        g.removeEventListener("pointercancel", up);
      };
      g.addEventListener("pointermove", move);
      g.addEventListener("pointerup", up);
      g.addEventListener("pointercancel", up);
      g.setPointerCapture(ev.pointerId);
    });
  }
}

function pointerToLayout(world: HTMLElement, ev: PointerEvent): { x: number; y: number } {
  const rect = world.getBoundingClientRect();
  const width = lastView?.width ?? 960;
  const height = lastView?.height ?? 640;
  if (!rect.width || !rect.height) {
    return { x: 0, y: 0 };
  }
  return {
    x: ((ev.clientX - rect.left) / rect.width) * width,
    y: ((ev.clientY - rect.top) / rect.height) * height,
  };
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
    if (
      rec.claim_state === "open" ||
      rec.claim_state === "full" ||
      rec.claim_state === "draft" ||
      rec.claim_state === "paused"
    ) {
      claimState = rec.claim_state;
    }
    openSocket();
  } catch (err) {
    if (err instanceof Error && err.name === "ClassroomGone") {
      clearClassroomId();
      classroomId = null;
      snap = null;
      claimState = "";
      lastView = null;
      layout = {};
    }
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
      if (payload.event === "hello") {
        const mode = payload.mode === "simulation" ? "simulation" : payload.mode === "normal" ? "normal" : "";
        if (snap && mode && mode !== snap.mode) {
          snap = applyTopoEvent(snap, payload);
          render();
        }
        return;
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
        const next = applyTopoEvent(snap, payload);
        if (next === snap) {
          return;
        }
        snap = next;
        lastView = buildTopo(snap, layout);
        const topo = app.querySelector<HTMLElement>(".topo");
        if (!topo || !patchTopo(topo, lastView)) {
          render();
        }
      }
    } catch {
      /* ignore */
    }
  };
  ws.onclose = () => {
    socket = null;
    window.setTimeout(() => {
      if (!classroomId) {
        return;
      }
      void loadSnap();
    }, 1000);
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
  const node = (ev.target as Element | null)?.closest?.(".node");
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

async function boot(): Promise<void> {
  if (!classroomId) {
    try {
      classroomId = await fetchCurrentClassroomId();
    } catch (err) {
      notice = err instanceof Error ? err.message : "读取当前课堂失败";
    }
  }
  await loadSnap();
  render();
}

void boot();
