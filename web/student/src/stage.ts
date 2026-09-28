import { MASK_C, buildStage, type StageModel, type StagePort } from "@shared/stage";
import { type Device, type DeviceKind, type LinkView, type TapAttachView } from "@shared/claim";
import { CHASSIS, PC_BACK, PC_FRONT } from "@shared/models";

export type StageAssets = {
  chatHtml?: string;
};

export function renderStage(
  device: Device,
  links: LinkView[],
  assets: StageAssets,
  selectedPortId: string | null,
  peers: string[],
  tapAttach: TapAttachView[] = [],
  notice = "",
): { html: string; model: StageModel } {
  const model = buildStage(device, links, tapAttach);
  const selected = model.ports.find((p) => p.portId === selectedPortId) ?? null;
  const html = `
    <section class="stage" data-kind="${model.kind}" data-overlay="${model.overlayCount}">
      ${
        model.kind === "pc"
          ? pcStage(model, assets.chatHtml || "")
          : rackStage(model)
      }
      <svg class="wires" aria-hidden="true"></svg>
    </section>
    ${editorMarkup(model.kind, selected, peers, notice)}
  `;
  return { html, model };
}

function pcStage(model: StageModel, chatHtml: string): string {
  const port = model.ports[0];
  return `
    <figure class="pc-front photo-chassis">
      <img class="chassis-img" src="${PC_FRONT}" alt="机箱正面" />
    </figure>
    <div class="pc-chat">${chatHtml}</div>
    <div class="canvas photo-chassis pc-back" aria-label="机箱背面">
      <img class="chassis-img" src="${PC_BACK}" alt="机箱背面" />
      ${port ? portMarkup(port, true) : ""}
    </div>
    <aside class="peers pc-peers">
      <h2>对端主机信息</h2>
      ${model.boxes.map((item) => boxMarkup(item)).join("") || `<p class="hint">暂无对端</p>`}
    </aside>
  `;
}

function rackStage(model: StageModel): string {
  const n = model.ports.length;
  const two = n > 8;
  const cols = two ? Math.ceil(n / 2) : n;
  const top = two ? model.ports.slice(0, cols) : model.ports;
  const bot = two ? model.ports.slice(cols) : [];
  const wired = model.kind === "switch" || model.kind === "router" || model.kind === "tap";
  const above = wired ? top.filter((p) => p.peerPortId) : [];
  const below = (wired ? bot : model.ports).filter((p) => p.peerPortId);
  const src = model.kind === "pc" ? PC_BACK : CHASSIS[model.kind];
  return `
    <div class="peers above">${above.map((p) => boxMarkup(p, "top", model.kind)).join("")}</div>
    <div class="canvas photo-chassis" data-kind="${model.kind}">
      <img class="chassis-img" src="${src}" alt="" />
      ${model.ports.map((port, i) => portMarkup(port, true, !two || i < cols ? "top" : "bot")).join("")}
    </div>
    <div class="peers below">${below.map((p) => boxMarkup(p, "bot", model.kind)).join("")}</div>
  `;
}

function portMarkup(port: StagePort, positioned = true, row = "top"): string {
  const up = port.physicallyUp ? "up" : "";
  const overlay = port.overlay ? "overlay" : "hotspot";
  const pos = positioned ? ` style="left:${port.x}%;top:${port.y}%;"` : "";
  return `
    <button type="button" class="port ${overlay} ${up}" data-port="${escapeAttr(port.portId)}" data-overlay="${port.overlay}" data-row="${row}"${pos}>
      <span class="pid">${escapeHtml(port.portId)}</span>
      <span class="dot port-dot" data-up="${port.physicallyUp}"></span>
    </button>
  `;
}

function boxMarkup(port: StagePort, row = "top", kind: DeviceKind = "switch"): string {
  const addr =
    kind === "router"
      ? `<p class="peer-ip">IP ${escapeHtml(port.ip || "未配置")}</p>
         <p class="peer-mask">掩码 ${escapeHtml(port.mask)}</p>`
      : "";
  return `
    <article class="peer-box" data-port="${escapeAttr(port.portId)}" data-up="${port.physicallyUp}" data-row="${row}">
      <span class="dot box-dot" data-up="${port.physicallyUp}"></span>
      <p class="peer-device">${escapeHtml(port.peerDeviceId || "")}</p>
      <p class="peer-port">${escapeHtml(port.peerPortId || "")}</p>
      ${addr}
      <p class="peer-link">${port.physicallyUp ? "已连接" : "待互指"}</p>
    </article>
  `;
}

function editorMarkup(kind: DeviceKind, port: StagePort | null, peers: string[], notice = ""): string {
  if (!port) {
    return `<p class="hint">点击端口填写对端${kind === "pc" || kind === "router" ? "与地址" : ""}。</p>`;
  }
  if (kind === "tap") {
    return `
      <p class="hint">端口 ${escapeHtml(port.portId)} · 对端由教师挂接 · ${escapeHtml(port.peerPortId || "尚未挂接")}</p>
    `;
  }
  void peers;
  const ip =
    kind === "pc" || kind === "router"
      ? `<div class="dlg-block"><h4>配置 IP</h4>
           <label>IP 地址 <input name="ip" value="${escapeAttr(port.ip || "")}" /></label>
           <p class="mask">掩码 ${MASK_C}</p>
           ${kind === "pc" ? `<label>网关 <input name="gateway" value="${escapeAttr(port.gateway || "")}" /></label>` : ""}
         </div>`
      : "";
  return `
    <div class="dlg-backdrop" data-open="true">
      <form class="port-editor dlg" data-port="${escapeAttr(port.portId)}">
        <header class="dlg-hd"><h3>填写对端端口</h3><button type="button" class="dlg-x" data-dlg-close>×</button></header>
        <p class="dlg-sub">端口 ${escapeHtml(port.portId)} · 手输对端端口编号</p>
        <label>本口 <input value="${escapeAttr(port.portId)}" readonly /></label>
        <label>对端端口编号 <input name="peer_port_id" value="${escapeAttr(port.peerPortId || "")}" placeholder="例如 S1/01" autocapitalize="characters" spellcheck="false" autocomplete="off" /></label>
        <p class="hint">格式为设备号/端口号，如 PC1/01、R1/02。两端互指后才会物理连通。</p>
        ${ip}
        ${notice ? `<p class="notice dlg-err" role="alert">${escapeHtml(notice)}</p>` : ""}
        <div class="dlg-actions">
          <button type="button" data-dlg-close>取消</button>
          <button type="submit">保存</button>
        </div>
      </form>
    </div>
  `;
}

const peerBoxPos = new Map<string, { left: number; top: number }>();

export function rememberPeerBox(portId: string, left: number, top: number): void {
  peerBoxPos.set(portId, { left, top });
}

export function placePeerBoxes(root: HTMLElement): void {
  const stage = root.querySelector<HTMLElement>(".stage");
  if (!stage || (stage.dataset.kind !== "switch" && stage.dataset.kind !== "router" && stage.dataset.kind !== "tap")) {
    return;
  }
  const stageBox = stage.getBoundingClientRect();
  for (const box of root.querySelectorAll<HTMLElement>(".peer-box")) {
    const portId = box.dataset.port || "";
    box.style.position = "absolute";
    box.style.transform = "none";
    const saved = peerBoxPos.get(portId);
    if (saved) {
      box.style.left = `${saved.left}px`;
      box.style.top = `${saved.top}px`;
      continue;
    }
    const port = root.querySelector<HTMLElement>(`.port[data-port="${cssAttr(portId)}"]`);
    if (!port) {
      continue;
    }
    const p = port.getBoundingClientRect();
    const above = box.dataset.row === "top";
    const width = box.offsetWidth || 88;
    const height = box.offsetHeight || 64;
    const left = p.left + p.width / 2 - stageBox.left - width / 2;
    const top = above ? p.top - stageBox.top - height - 18 : p.bottom - stageBox.top + 18;
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
  }
}

export function layoutWires(root: HTMLElement): void {
  const svg = root.querySelector<SVGSVGElement>("svg.wires");
  const canvas = root.querySelector<HTMLElement>(".canvas");
  const stage = root.querySelector<HTMLElement>(".stage");
  if (!svg || !canvas || !stage || stage.dataset.kind === "pc") {
    if (svg) {
      svg.innerHTML = "";
    }
    return;
  }
  const stageBox = stage.getBoundingClientRect();
  svg.setAttribute("viewBox", `0 0 ${stageBox.width} ${stageBox.height}`);
  svg.style.width = `${stageBox.width}px`;
  svg.style.height = `${stageBox.height}px`;
  const lines: string[] = [];
  for (const box of root.querySelectorAll<HTMLElement>(".peer-box")) {
    const portId = box.dataset.port;
    const port = root.querySelector<HTMLElement>(`.port[data-port="${cssAttr(portId || "")}"]`);
    if (!port) {
      continue;
    }
    const a = port.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const ax = a.left + a.width / 2 - stageBox.left;
    const bx = b.left + b.width / 2 - stageBox.left;
    const above = box.dataset.row === "top" || b.bottom < a.top;
    const x1 = ax;
    const y1 = (above ? a.top : a.bottom) - stageBox.top;
    const x2 = bx;
    const y2 = (above ? b.bottom : b.top) - stageBox.top;
    const d = `M ${x1} ${y1} C ${x1} ${y1 + (y2 - y1) * 0.45}, ${x2} ${y1 + (y2 - y1) * 0.45}, ${x2} ${y2}`;
    const up = box.dataset.up === "true";
    lines.push(
      `<path d="${d}" class="${up ? "up" : "pending"}" />`,
    );
  }
  svg.innerHTML = lines.join("");
}

function cssAttr(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
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
