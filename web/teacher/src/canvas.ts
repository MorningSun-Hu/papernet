import type { DeviceKind } from "@shared/claim";
import { logicalIconFile, type TopoLayout, type TopoSnapshot, type TopoView, buildTopo } from "@shared/topo";

export type IconUrls = Record<DeviceKind, string>;

export function renderCanvas(
  snap: TopoSnapshot,
  icons: IconUrls,
  layout: TopoLayout = {},
): { html: string; view: TopoView } {
  const view = buildTopo(snap, layout);
  const html = `
    <section class="topo" data-mode="${snap.mode}">
      <svg viewBox="0 0 ${view.width} ${view.height}" role="img" aria-label="课堂拓扑">
        ${view.edges.map((edge) => edgeMarkup(edge)).join("")}
        ${view.nodes.map((node) => nodeMarkup(node, icons)).join("")}
      </svg>
    </section>
  `;
  return { html, view };
}

export function patchTopo(svg: SVGSVGElement, view: TopoView): void {
  for (const node of view.nodes) {
    const g = svg.querySelector(`g.node[data-id="${cssAttr(node.id)}"]`);
    if (g) {
      g.setAttribute("transform", `translate(${node.x},${node.y})`);
    }
  }
  for (const edge of view.edges) {
    const line = svg.querySelector(`line[data-link="${cssAttr(edge.link_id)}"]`);
    if (line) {
      line.setAttribute("x1", String(edge.x1));
      line.setAttribute("y1", String(edge.y1));
      line.setAttribute("x2", String(edge.x2));
      line.setAttribute("y2", String(edge.y2));
    }
  }
}

function cssAttr(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export { logicalIconFile };

function edgeMarkup(edge: TopoView["edges"][number]): string {
  return `<line class="link ${edge.style}" data-link="${escapeAttr(edge.link_id)}" x1="${edge.x1}" y1="${edge.y1}" x2="${edge.x2}" y2="${edge.y2}" />`;
}

function nodeMarkup(node: TopoView["nodes"][number], icons: IconUrls): string {
  const href = icons[node.kind];
  const label = node.labels.map((line) => escapeHtml(line)).join(" · ");
  const on = node.onLink ? ` data-on-link="${escapeAttr(node.onLink)}"` : "";
  return `
    <g class="node" data-kind="${node.kind}" data-id="${escapeAttr(node.id)}" data-claimed="${node.claimed}"${on} transform="translate(${node.x},${node.y})">
      <image href="${href}" x="-32" y="-32" width="64" height="64" />
      <text y="48" text-anchor="middle">${label}</text>
    </g>
  `;
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
