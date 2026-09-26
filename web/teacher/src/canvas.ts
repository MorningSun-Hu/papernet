import type { DeviceKind } from "@shared/claim";
import { TOPO_MODEL } from "@shared/models";
import { logicalIconFile, type TopoLayout, type TopoSnapshot, type TopoView, buildTopo } from "@shared/topo";

export type IconUrls = Partial<Record<DeviceKind, string>>;

export function renderCanvas(
  snap: TopoSnapshot,
  _icons: IconUrls = {},
  layout: TopoLayout = {},
): { html: string; view: TopoView } {
  const view = buildTopo(snap, layout);
  const html = `
    <section class="topo" data-mode="${snap.mode}">
      <p class="topo-tab">网络拓扑</p>
      <svg class="topo-wires" viewBox="0 0 ${view.width} ${view.height}" role="img" aria-label="课堂拓扑">
        ${view.edges.map((edge) => edgeMarkup(edge)).join("")}
      </svg>
      <div class="topo-nodes">
        ${view.nodes.map((node) => nodeMarkup(node, view)).join("")}
      </div>
    </section>
  `;
  return { html, view };
}

export function patchTopo(root: HTMLElement, view: TopoView): void {
  for (const node of view.nodes) {
    const el = root.querySelector<HTMLElement>(`.node[data-id="${cssAttr(node.id)}"]`);
    if (el) {
      el.style.left = `${(node.x / view.width) * 100}%`;
      el.style.top = `${(node.y / view.height) * 100}%`;
    }
  }
  for (const edge of view.edges) {
    const line = root.querySelector(`line[data-link="${cssAttr(edge.link_id)}"]`);
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

function nodeMarkup(node: TopoView["nodes"][number], view: TopoView): string {
  const on = node.onLink ? ` data-on-link="${escapeAttr(node.onLink)}"` : "";
  const left = (node.x / view.width) * 100;
  const top = (node.y / view.height) * 100;
  const meta = node.labels.slice(1).join(" · ");
  return `
    <article class="node" data-kind="${node.kind}" data-id="${escapeAttr(node.id)}" data-claimed="${node.claimed}"${on} style="left:${left}%;top:${top}%">
      <img class="model-img" src="${TOPO_MODEL[node.kind]}" alt="" />
      <p class="nid">${escapeHtml(node.labels[0] || node.id)}</p>
      <p class="nmeta">${escapeHtml(meta)}</p>
    </article>
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
