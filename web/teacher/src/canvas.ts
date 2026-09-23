import type { DeviceKind } from "@shared/claim";
import { logicalIconFile, type TopoSnapshot, type TopoView, buildTopo } from "@shared/topo";

export type IconUrls = Record<DeviceKind, string>;

export function renderCanvas(snap: TopoSnapshot, icons: IconUrls): { html: string; view: TopoView } {
  const view = buildTopo(snap);
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

export { logicalIconFile };

function edgeMarkup(edge: TopoView["edges"][number]): string {
  return `<line class="link ${edge.style}" data-link="${escapeAttr(edge.link_id)}" x1="${edge.x1}" y1="${edge.y1}" x2="${edge.x2}" y2="${edge.y2}" />`;
}

function nodeMarkup(node: TopoView["nodes"][number], icons: IconUrls): string {
  const href = icons[node.kind];
  const label = node.labels.map((line) => escapeHtml(line)).join(" · ");
  const on = node.onLink ? ` data-on-link="${escapeAttr(node.onLink)}"` : "";
  return `
    <g class="node" data-kind="${node.kind}" data-id="${escapeAttr(node.id)}"${on} transform="translate(${node.x},${node.y})">
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
