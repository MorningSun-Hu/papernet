import type { DeviceKind, LinkView } from "./claim";

/** Swap this directory to `cisco` after vendor icons are uploaded. */
export const LOGICAL_ICON_DIR = "logical";

export type TopoPort = {
  id: string;
  ip: string | null;
  peer_port_id: string | null;
};

export type TopoDevice = {
  id: string;
  kind: DeviceKind;
  claimed: boolean;
  ports: TopoPort[];
};

export type TapAttach = {
  tap_id: string;
  link_id: string;
};

export type TopoSnapshot = {
  devices: TopoDevice[];
  links: LinkView[];
  tapAttach: TapAttach[];
  mode: "normal" | "simulation";
};

export type TopoNode = {
  id: string;
  kind: DeviceKind;
  x: number;
  y: number;
  labels: string[];
  onLink: string | null;
  claimed: boolean;
};

export type TopoEdge = {
  id: string;
  link_id: string;
  port_a: string;
  port_b: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  style: "up" | "pending";
};

export type TopoView = {
  width: number;
  height: number;
  nodes: TopoNode[];
  edges: TopoEdge[];
};

export type TopoLayout = Record<string, { x: number; y: number }>;

export function logicalIconFile(kind: DeviceKind): string {
  const name = kind === "pc" ? "pc.svg" : kind === "switch" ? "switch.svg" : kind === "router" ? "router.svg" : "tap.svg";
  return `${LOGICAL_ICON_DIR}/${name}`;
}

export function parseTopoSnapshot(raw: unknown): TopoSnapshot | null {
  const rec = asRecord(raw);
  const devicesRaw = Array.isArray(rec.devices) ? rec.devices : [];
  const devices: TopoDevice[] = [];
  for (const item of devicesRaw) {
    const d = asRecord(item);
    const id = str(d.id);
    const kind = role(str(d.kind));
    if (!id || !kind) {
      continue;
    }
    const portsRaw = Array.isArray(d.ports) ? d.ports : [];
    devices.push({
      id,
      kind,
      claimed: Boolean(d.claimed_connection_id) || d.claimed === true,
      ports: portsRaw.map((p) => {
        const port = asRecord(p);
        return {
          id: str(port.id),
          ip: port.ip == null ? null : str(port.ip),
          peer_port_id: port.peer_port_id == null ? null : str(port.peer_port_id),
        };
      }),
    });
  }
  if (!devices.length) {
    return null;
  }
  const attachRaw = rec.tap_attach ?? rec.tapAttach;
  return {
    devices,
    links: parseLinks(rec.links),
    tapAttach: parseAttach(attachRaw),
    mode: rec.mode === "simulation" ? "simulation" : "normal",
  };
}

export function applyTopoEvent(snap: TopoSnapshot, payload: unknown): TopoSnapshot {
  const rec = asRecord(payload);
  const event = str(rec.event);
  if (event === "mode.changed" || event === "hello") {
    const mode = str(rec.mode);
    if (mode === "normal" || mode === "simulation") {
      return { ...snap, mode };
    }
  }
  if (event === "claim.granted") {
    const granted = asRecord(rec.device);
    const id = str(granted.id);
    if (!id) {
      return snap;
    }
    return {
      ...snap,
      devices: snap.devices.map((device) =>
        device.id === id ? { ...device, claimed: true } : device,
      ),
    };
  }
  if (event === "claim.released") {
    const id = str(rec.device_id);
    if (!id) {
      return snap;
    }
    return {
      ...snap,
      devices: snap.devices.map((device) =>
        device.id === id ? { ...device, claimed: false } : device,
      ),
    };
  }
  if (event !== "topology.updated") {
    return snap;
  }
  let devices = snap.devices;
  if (Array.isArray(rec.ports)) {
    const incoming = rec.ports.map((item) => asRecord(item));
    devices = devices.map((device) => {
      const nextPorts = device.ports.map((port) => {
        const hit = incoming.find((row) => str(row.id) === port.id);
        if (!hit) {
          return port;
        }
        return {
          id: port.id,
          ip: hit.ip == null ? port.ip : str(hit.ip),
          peer_port_id: hit.peer_port_id == null ? port.peer_port_id : str(hit.peer_port_id),
        };
      });
      return { ...device, ports: nextPorts };
    });
  }
  const links = Array.isArray(rec.links) ? parseLinks(rec.links) : snap.links;
  let tapAttach = snap.tapAttach;
  if (rec.tap_attach) {
    const extra = parseAttach(rec.tap_attach);
    for (const row of extra) {
      tapAttach = tapAttach.filter((a) => a.tap_id !== row.tap_id).concat(row);
    }
  }
  return { ...snap, devices, links, tapAttach };
}

export function compareDeviceId(a: string, b: string): number {
  const [pa, na] = splitDeviceId(a);
  const [pb, nb] = splitDeviceId(b);
  if (pa !== pb) {
    return pa.localeCompare(pb, "en");
  }
  return na - nb;
}

function splitDeviceId(id: string): [string, number] {
  const m = /^([A-Za-z]+)(\d+)$/.exec(id);
  if (!m) {
    return [id, 0];
  }
  return [m[1], Number(m[2])];
}

function sortDevices(devices: TopoDevice[]): TopoDevice[] {
  return [...devices].sort((a, b) => compareDeviceId(a.id, b.id));
}

export function arrangeTopo(snap: TopoSnapshot): TopoLayout {
  return autoLayout(snap).positions;
}

export function buildTopo(snap: TopoSnapshot, layout: TopoLayout = {}): TopoView {
  const attached = new Map(snap.tapAttach.map((a) => [a.tap_id, a.link_id]));
  const auto = autoLayout(snap);
  const nodes: TopoNode[] = [];
  for (const device of snap.devices) {
    if (device.kind === "tap" && attached.has(device.id)) {
      continue;
    }
    const pos = layout[device.id] ?? auto.positions[device.id] ?? { x: auto.width / 2, y: 90 };
    nodes.push({
      id: device.id,
      kind: device.kind,
      x: pos.x,
      y: pos.y,
      labels: deviceLabels(device),
      onLink: null,
      claimed: device.claimed,
    });
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let width = auto.width;
  let height = auto.height;
  for (const device of snap.devices) {
    if (device.kind !== "tap") {
      continue;
    }
    const linkId = attached.get(device.id);
    if (!linkId) {
      continue;
    }
    const link = snap.links.find((row) => row.link_id === linkId);
    const a = link ? byId.get(ownerOf(link.port_a)) : undefined;
    const b = link ? byId.get(ownerOf(link.port_b)) : undefined;
    nodes.push({
      id: device.id,
      kind: "tap",
      x: layout[device.id]?.x ?? (a && b ? (a.x + b.x) / 2 : width / 2),
      y: layout[device.id]?.y ?? (a && b ? (a.y + b.y) / 2 : 320),
      labels: deviceLabels(device),
      onLink: linkId,
      claimed: device.claimed,
    });
  }
  const placed = new Map(nodes.map((n) => [n.id, n]));
  const hungTaps = new Map<string, string[]>();
  for (const [tapId, linkId] of attached) {
    const list = hungTaps.get(linkId) ?? [];
    list.push(tapId);
    hungTaps.set(linkId, list);
  }
  const edges: TopoEdge[] = [];
  for (const link of snap.links) {
    const a = placed.get(ownerOf(link.port_a));
    const b = placed.get(ownerOf(link.port_b));
    const style = link.physically_up ? "up" : "pending";
    const taps = (hungTaps.get(link.link_id) ?? []).filter((tapId) => placed.has(tapId));
    if (!taps.length) {
      edges.push({
        id: link.link_id,
        link_id: link.link_id,
        port_a: link.port_a,
        port_b: link.port_b,
        x1: a?.x ?? 80,
        y1: a?.y ?? 90,
        x2: b?.x ?? 880,
        y2: b?.y ?? 400,
        style,
      });
      continue;
    }
    for (const tapId of taps) {
      const tap = placed.get(tapId);
      edges.push({
        id: `${link.link_id}::${tapId}::a`,
        link_id: link.link_id,
        port_a: link.port_a,
        port_b: link.port_b,
        x1: a?.x ?? 80,
        y1: a?.y ?? 90,
        x2: tap?.x ?? a?.x ?? 80,
        y2: tap?.y ?? a?.y ?? 90,
        style,
      });
      edges.push({
        id: `${link.link_id}::${tapId}::b`,
        link_id: link.link_id,
        port_a: link.port_a,
        port_b: link.port_b,
        x1: tap?.x ?? b?.x ?? 880,
        y1: tap?.y ?? b?.y ?? 400,
        x2: b?.x ?? 880,
        y2: b?.y ?? 400,
        style,
      });
    }
  }
  return { width, height, nodes, edges };
}

export function topoDensity(nodeCount: number): 0 | 1 | 2 {
  if (nodeCount > 36) {
    return 2;
  }
  if (nodeCount > 16) {
    return 1;
  }
  return 0;
}

type LayoutTree = {
  id: string;
  kind: DeviceKind;
  children: LayoutTree[];
};

function autoLayout(snap: TopoSnapshot): { positions: TopoLayout; width: number; height: number } {
  const attached = new Set(snap.tapAttach.map((a) => a.tap_id));
  const byId = new Map(snap.devices.map((d) => [d.id, d]));
  const adj = adjacency(snap);
  const visited = new Set<string>();

  const grow = (id: string, parentId: string): LayoutTree => {
    visited.add(id);
    const kids = (adj.get(id) ?? []).filter((n) => {
      if (n === parentId || visited.has(n)) {
        return false;
      }
      const k = byId.get(n)?.kind;
      return Boolean(k && k !== "tap");
    });
    kids.sort((a, b) => {
      const ra = kindRank(byId.get(a)?.kind ?? "pc");
      const rb = kindRank(byId.get(b)?.kind ?? "pc");
      if (ra !== rb) {
        return ra - rb;
      }
      return compareDeviceId(a, b);
    });
    return {
      id,
      kind: byId.get(id)?.kind ?? "pc",
      children: kids.map((kid) => grow(kid, id)),
    };
  };

  const routers = sortDevices(snap.devices.filter((d) => d.kind === "router"));
  const routerTrees = routers.map((d) => grow(d.id, ""));
  const orphanTrees: LayoutTree[] = [];
  while (true) {
    const rest = snap.devices.filter(
      (d) => d.kind !== "tap" && !visited.has(d.id) && (adj.get(d.id)?.length ?? 0) > 0,
    );
    if (!rest.length) {
      break;
    }
    const switches = rest.filter((d) => d.kind === "switch").sort((a, b) => compareDeviceId(a.id, b.id));
    const fallback = [...rest].sort((a, b) => compareDeviceId(a.id, b.id));
    orphanTrees.push(grow((switches[0] ?? fallback[0]).id, ""));
  }

  const isolates = snap.devices
    .filter((d) => {
      if (attached.has(d.id) || d.kind === "router" || visited.has(d.id)) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const rk = kindRank(a.kind) - kindRank(b.kind);
      return rk !== 0 ? rk : compareDeviceId(a.id, b.id);
    });

  const widest = Math.max(isolates.length, snap.devices.length, 1);
  const { maxCols, gap, rowDy, pad } = spacingForCount(widest);
  const routerPlaced = routerTrees.map(layoutCluster);
  const orphanPlaced = orphanTrees.map(layoutCluster);
  const gapX = 56;
  const routerW = sumWidth(routerPlaced, gapX);
  const orphanW = sumWidth(orphanPlaced, gapX);
  const treesTotal = routerW + (orphanPlaced.length && routerPlaced.length ? gapX : 0) + orphanW;
  const isolateSpan = isolates.length ? gap * (Math.min(isolates.length, maxCols) - 1) : 0;
  const width = Math.max(960, pad * 2 + Math.max(treesTotal, isolateSpan));
  const positions: TopoLayout = {};
  const yRouter = 90;
  let maxBottom = 0;
  let cursor = (width - treesTotal) / 2;
  for (const placed of routerPlaced) {
    stampCluster(placed, cursor, yRouter, positions);
    cursor += placed.width + gapX;
    maxBottom = Math.max(maxBottom, yRouter + placed.height);
  }
  const yOrphan = routerPlaced.length ? yRouter + 80 : 90;
  for (const placed of orphanPlaced) {
    stampCluster(placed, cursor, yOrphan, positions);
    cursor += placed.width + gapX;
    maxBottom = Math.max(maxBottom, yOrphan + placed.height);
  }
  if (routerPlaced.length) {
    maxBottom = Math.max(maxBottom, yRouter);
  }

  if (isolates.length) {
    const y0 = maxBottom > 0 ? maxBottom + rowDy : 90;
    const dummy: TopoNode[] = [];
    const yEnd = placeWrapped(dummy, isolates, y0, width, gap, maxCols, rowDy);
    for (const node of dummy) {
      positions[node.id] = { x: node.x, y: node.y };
    }
    maxBottom = yEnd;
  }

  return { positions, width, height: Math.max(640, maxBottom + 80) };
}

type ClusterBox = {
  positions: TopoLayout;
  width: number;
  height: number;
};

function sumWidth(boxes: ClusterBox[], gapX: number): number {
  if (!boxes.length) {
    return 0;
  }
  return boxes.reduce((s, b) => s + b.width, 0) + gapX * (boxes.length - 1);
}

function stampCluster(box: ClusterBox, ox: number, oy: number, out: TopoLayout): void {
  for (const [id, pos] of Object.entries(box.positions)) {
    out[id] = { x: Math.round(pos.x + ox), y: Math.round(pos.y + oy) };
  }
}

function starMetrics(n: number): { inner: number; outer: number } {
  if (n <= 1) {
    return { inner: 150, outer: 150 };
  }
  const innerCount = Math.ceil(n / 2);
  const minChord = 128;
  const inner = Math.max(150, Math.ceil(minChord / (2 * Math.sin(Math.PI / Math.max(innerCount, 2)))));
  return { inner, outer: inner + 88 };
}

function placeStar(cx: number, cy: number, pcs: LayoutTree[], inner: number, outer: number, out: TopoLayout): void {
  const n = pcs.length;
  if (n === 1) {
    out[pcs[0].id] = { x: cx, y: cy + inner };
    return;
  }
  const start = -Math.PI / 2 + Math.PI / n;
  for (let i = 0; i < n; i += 1) {
    const r = i % 2 === 0 ? inner : outer;
    const a = start + (2 * Math.PI * i) / n;
    out[pcs[i].id] = { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  }
}

function layoutStarHub(id: string, pcs: LayoutTree[]): ClusterBox {
  const n = pcs.length;
  if (!n) {
    return { positions: { [id]: { x: 80, y: 40 } }, width: 160, height: 80 };
  }
  const { inner, outer } = starMetrics(n);
  const pad = 56;
  const width = 2 * outer + pad * 2;
  const height = 2 * outer + pad * 2;
  const hubX = width / 2;
  const hubY = height / 2;
  const positions: TopoLayout = { [id]: { x: hubX, y: hubY } };
  placeStar(hubX, hubY, pcs, inner, outer, positions);
  return { positions, width, height };
}

function layoutCluster(tree: LayoutTree): ClusterBox {
  const pcs = tree.children.filter((c) => c.kind === "pc" && !c.children.length);
  const rest = tree.children.filter((c) => c.kind !== "pc" || c.children.length);
  if (!rest.length) {
    return layoutStarHub(tree.id, pcs);
  }
  const kids = rest.map(layoutCluster);
  const gapX = 56;
  const stagger = 96;
  const star = pcs.length ? starMetrics(pcs.length) : { inner: 0, outer: 0 };
  const rowW = sumWidth(kids, gapX);
  const starW = pcs.length ? 2 * star.outer + 112 : 0;
  const width = Math.max(rowW, starW, 160);
  const hubY = pcs.length ? star.outer + 56 : 40;
  const hubX = width / 2;
  const positions: TopoLayout = { [tree.id]: { x: hubX, y: hubY } };
  if (pcs.length) {
    placeStar(hubX, hubY, pcs, star.inner, star.outer, positions);
  }
  const rowTop = hubY + Math.max(120, pcs.length ? star.outer + 48 : 0);
  let x = (width - rowW) / 2;
  let height = hubY + 80;
  kids.forEach((k, i) => {
    const oy = rowTop + (i % 2 === 1 ? stagger : 0);
    stampCluster(k, x, oy, positions);
    height = Math.max(height, oy + k.height);
    x += k.width + gapX;
  });
  return { positions, width, height };
}

function kindRank(kind: DeviceKind): number {
  if (kind === "switch") {
    return 0;
  }
  if (kind === "router") {
    return 1;
  }
  if (kind === "pc") {
    return 2;
  }
  return 3;
}

function adjacency(snap: TopoSnapshot): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  const add = (a: string, b: string) => {
    if (!a || !b || a === b) {
      return;
    }
    const list = adj.get(a) ?? [];
    if (!list.includes(b)) {
      list.push(b);
    }
    adj.set(a, list);
  };
  for (const link of snap.links) {
    add(ownerOf(link.port_a), ownerOf(link.port_b));
    add(ownerOf(link.port_b), ownerOf(link.port_a));
  }
  return adj;
}

function spacingForCount(widestRow: number): { maxCols: number; gap: number; rowDy: number; pad: number } {
  if (widestRow <= 8) {
    return { maxCols: 5, gap: 168, rowDy: 160, pad: 110 };
  }
  if (widestRow <= 16) {
    return { maxCols: 6, gap: 140, rowDy: 140, pad: 90 };
  }
  if (widestRow <= 28) {
    return { maxCols: 8, gap: 120, rowDy: 124, pad: 80 };
  }
  return { maxCols: 10, gap: 108, rowDy: 116, pad: 72 };
}

function placeWrapped(
  nodes: TopoNode[],
  devices: TopoDevice[],
  y: number,
  width: number,
  gap: number,
  maxCols: number,
  rowDy: number,
): number {
  if (!devices.length) {
    return y;
  }
  for (let i = 0; i < devices.length; i += maxCols) {
    placeRow(nodes, devices.slice(i, i + maxCols), y, width, gap);
    y += rowDy;
  }
  return y;
}

function placeRow(nodes: TopoNode[], devices: TopoDevice[], y: number, width: number, gap: number): void {
  const n = devices.length;
  const span = n > 1 ? gap * (n - 1) : 0;
  const start = (width - span) / 2;
  devices.forEach((device, i) => {
    nodes.push({
      id: device.id,
      kind: device.kind,
      x: start + gap * i,
      y,
      labels: deviceLabels(device),
      onLink: null,
      claimed: device.claimed,
    });
  });
}

function deviceLabels(device: TopoDevice): string[] {
  const lines = [device.id];
  for (const port of device.ports) {
    lines.push(port.ip ? `${port.id} ${port.ip}` : port.id);
  }
  return lines;
}

function ownerOf(portId: string): string {
  const i = portId.lastIndexOf("/");
  return i === -1 ? portId : portId.slice(0, i);
}

function parseLinks(raw: unknown): LinkView[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item) => {
      const rec = asRecord(item);
      return {
        link_id: str(rec.link_id),
        port_a: str(rec.port_a),
        port_b: str(rec.port_b),
        physically_up: rec.physically_up === true,
      };
    })
    .filter((link) => link.port_a && link.port_b);
}

function parseAttach(raw: unknown): TapAttach[] {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => asRecord(item))
      .map((rec) => ({ tap_id: str(rec.tap_id), link_id: str(rec.link_id) }))
      .filter((row) => row.tap_id && row.link_id);
  }
  const rec = asRecord(raw);
  const tap_id = str(rec.tap_id);
  const link_id = str(rec.link_id);
  return tap_id && link_id ? [{ tap_id, link_id }] : [];
}

function role(kind: string): DeviceKind | null {
  if (kind === "pc" || kind === "switch" || kind === "router" || kind === "tap") {
    return kind;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
