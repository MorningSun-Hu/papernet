import { MASK_C, buildStage, type StageModel, type StagePort } from "@shared/stage";
import { ROLE_LABEL, type Device, type DeviceKind, type LinkView } from "@shared/claim";

export type StageAssets = {
  chassis: string;
  rj45: string;
};

export function renderStage(
  device: Device,
  links: LinkView[],
  assets: StageAssets,
  selectedPortId: string | null,
  peers: string[],
): { html: string; model: StageModel } {
  const model = buildStage(device, links);
  const selected = model.ports.find((p) => p.portId === selectedPortId) ?? null;
  const html = `
    <section class="stage" data-kind="${model.kind}" data-overlay="${model.overlayCount}">
      <div class="canvas">
        <img class="chassis-img" src="${assets.chassis}" alt="${escapeHtml(ROLE_LABEL[model.kind])}底图" />
        ${model.ports.map((port) => portMarkup(port, assets.rj45)).join("")}
        <svg class="wires" aria-hidden="true"></svg>
      </div>
      <aside class="peers">
        ${model.boxes.map((port) => boxMarkup(port)).join("")}
      </aside>
    </section>
    ${editorMarkup(model.kind, selected, peers)}
  `;
  return { html, model };
}

function portMarkup(port: StagePort, rj45: string): string {
  const up = port.physicallyUp ? "up" : "";
  const overlay = port.overlay ? "overlay" : "hotspot";
  return `
    <button type="button" class="port ${overlay} ${up}" data-port="${escapeAttr(port.portId)}" data-overlay="${port.overlay}" style="left:${port.x}%;top:${port.y}%;">
      ${port.overlay ? `<img src="${rj45}" alt="" />` : ""}
      <span class="pid">${escapeHtml(port.portId)}</span>
      <span class="dot port-dot" data-up="${port.physicallyUp}"></span>
    </button>
  `;
}

function boxMarkup(port: StagePort): string {
  return `
    <article class="peer-box" data-port="${escapeAttr(port.portId)}" data-up="${port.physicallyUp}">
      <span class="dot box-dot" data-up="${port.physicallyUp}"></span>
      <p class="peer-device">${escapeHtml(port.peerDeviceId || "")}</p>
      <p class="peer-port">${escapeHtml(port.peerPortId || "")}</p>
    </article>
  `;
}

function editorMarkup(kind: DeviceKind, port: StagePort | null, peers: string[]): string {
  if (!port) {
    return `<p class="hint">点击端口填写对端${kind === "pc" || kind === "router" ? "与地址" : ""}。</p>`;
  }
  if (kind === "tap") {
    return `
      <div class="port-editor" data-readonly="true">
        <p>端口 ${escapeHtml(port.portId)} · 对端由教师挂接</p>
        <p>${escapeHtml(port.peerPortId || "尚未挂接")}</p>
      </div>
    `;
  }
  const options = [`<option value="">未接线</option>`]
    .concat(
      peers.map((id) => {
        const selected = id === (port.peerPortId || "") ? " selected" : "";
        return `<option value="${escapeAttr(id)}"${selected}>${escapeHtml(id)}</option>`;
      }),
    )
    .join("");
  const ip =
    kind === "pc" || kind === "router"
      ? `<label>IP <input name="ip" value="${escapeAttr(port.ip || "")}" /></label>
         <p class="mask">掩码 ${MASK_C}</p>`
      : "";
  const gw =
    kind === "pc"
      ? `<label>网关 <input name="gateway" value="${escapeAttr(port.gateway || "")}" /></label>`
      : "";
  return `
    <form class="port-editor" data-port="${escapeAttr(port.portId)}">
      <p>端口 ${escapeHtml(port.portId)}</p>
      <label>对端端口 <select name="peer_port_id">${options}</select></label>
      ${ip}
      ${gw}
      <button type="submit">保存</button>
    </form>
  `;
}

export function layoutWires(root: HTMLElement): void {
  const svg = root.querySelector<SVGSVGElement>("svg.wires");
  const canvas = root.querySelector<HTMLElement>(".canvas");
  const stage = root.querySelector<HTMLElement>(".stage");
  if (!svg || !canvas || !stage) {
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
    const x1 = a.left + a.width / 2 - stageBox.left;
    const y1 = a.top + a.height / 2 - stageBox.top;
    const x2 = b.left - stageBox.left;
    const y2 = b.top + b.height / 2 - stageBox.top;
    const up = box.dataset.up === "true";
    lines.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${up ? "up" : "pending"}" />`,
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
