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

export function buildTopo(snap: TopoSnapshot, layout: TopoLayout = {}): TopoView {
  const width = 960;
  const height = 640;
  const attached = new Map(snap.tapAttach.map((a) => [a.tap_id, a.link_id]));
  const row: Record<Exclude<DeviceKind, "tap"> | "tap-free", TopoDevice[]> = {
    pc: [],
    switch: [],
    router: [],
    "tap-free": [],
  };
  for (const device of snap.devices) {
    if (device.kind === "tap" && attached.has(device.id)) {
      continue;
    }
    if (device.kind === "tap") {
      row["tap-free"].push(device);
    } else {
      row[device.kind].push(device);
    }
  }
  const nodes: TopoNode[] = [];
  placeRow(nodes, row.pc, 90, width);
  placeRow(nodes, row.switch, 250, width);
  placeRow(nodes, row.router, 400, width);
  placeRow(nodes, row["tap-free"], 520, width);
  for (const node of nodes) {
    const pos = layout[node.id];
    if (pos) {
      node.x = pos.x;
      node.y = pos.y;
    }
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: TopoEdge[] = snap.links.map((link) => {
    const a = byId.get(ownerOf(link.port_a));
    const b = byId.get(ownerOf(link.port_b));
    return {
      link_id: link.link_id,
      port_a: link.port_a,
      port_b: link.port_b,
      x1: a?.x ?? 80,
      y1: a?.y ?? 90,
      x2: b?.x ?? 880,
      y2: b?.y ?? 400,
      style: link.physically_up ? "up" : "pending",
    };
  });
  const edgeById = new Map(edges.map((e) => [e.link_id, e]));
  for (const device of snap.devices) {
    if (device.kind !== "tap") {
      continue;
    }
    const linkId = attached.get(device.id);
    if (!linkId) {
      continue;
    }
    const edge = edgeById.get(linkId);
    nodes.push({
      id: device.id,
      kind: "tap",
      x: layout[device.id]?.x ?? (edge ? (edge.x1 + edge.x2) / 2 : width / 2),
      y: layout[device.id]?.y ?? (edge ? (edge.y1 + edge.y2) / 2 : 320),
      labels: deviceLabels(device),
      onLink: linkId,
      claimed: device.claimed,
    });
  }
  return { width, height, nodes, edges };
}

function placeRow(nodes: TopoNode[], devices: TopoDevice[], y: number, width: number): void {
  const n = devices.length;
  if (!n) {
    return;
  }
  const pad = 100;
  const span = width - pad * 2;
  devices.forEach((device, i) => {
    const x = n === 1 ? width / 2 : pad + (span * i) / (n - 1);
    nodes.push({
      id: device.id,
      kind: device.kind,
      x,
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
