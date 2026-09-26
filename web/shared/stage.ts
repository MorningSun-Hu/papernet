import type { Device, DeviceKind, LinkView, TapAttachView } from "./claim";

export const MASK_C = "255.255.255.0";

export type StagePort = {
  portId: string;
  overlay: boolean;
  x: number;
  y: number;
  peerPortId: string | null;
  peerDeviceId: string | null;
  physicallyUp: boolean;
  ip: string | null;
  gateway: string | null;
  mask: string;
};

export type StageModel = {
  deviceId: string;
  kind: DeviceKind;
  overlayCount: number;
  ports: StagePort[];
  boxes: StagePort[];
};

export function deviceIdFromPort(portId: string): string {
  const cut = portId.lastIndexOf("/");
  return cut === -1 ? portId : portId.slice(0, cut);
}

export function buildStage(device: Device, links: LinkView[], tapAttach: TapAttachView[] = []): StageModel {
  const overlay = true;
  const coords =
    device.kind === "pc"
      ? device.ports.map(() => ({ x: 63, y: 43 }))
      : device.kind === "tap"
        ? tapSlots(device.ports.length)
        : device.kind === "router"
          ? routerSlots(device.ports.length)
          : slotPositions(device.ports.length);
  const hang = hungLink(device.id, links, tapAttach);
  const ports: StagePort[] = device.ports.map((port, i) => {
    let peerPortId = port.peer_port_id ? port.peer_port_id : null;
    let physicallyUp = isUp(port.id, links, tapAttach);
    if (device.kind === "tap" && hang) {
      peerPortId = i === 0 ? hang.port_a : hang.port_b;
      physicallyUp = hang.physically_up;
    }
    return {
      portId: port.id,
      overlay,
      x: coords[i]?.x ?? 50,
      y: coords[i]?.y ?? 65,
      peerPortId,
      peerDeviceId: peerPortId ? deviceIdFromPort(peerPortId) : null,
      physicallyUp,
      ip: port.ip ?? null,
      gateway: port.gateway ?? null,
      mask: port.mask || MASK_C,
    };
  });
  return {
    deviceId: device.id,
    kind: device.kind,
    overlayCount: overlay ? ports.length : 0,
    ports,
    boxes: ports.filter((p) => p.peerPortId),
  };
}

function hungLink(deviceId: string, links: LinkView[], tapAttach: TapAttachView[]): LinkView | undefined {
  const row = tapAttach.find((item) => item.tap_id === deviceId);
  if (!row) {
    return undefined;
  }
  return links.find((link) => link.link_id === row.link_id);
}

function isUp(portId: string, links: LinkView[], tapAttach: TapAttachView[]): boolean {
  if (
    links.some(
      (link) => link.physically_up && (link.port_a === portId || link.port_b === portId),
    )
  ) {
    return true;
  }
  return tapAttach.some((row) => {
    const link = links.find((item) => item.link_id === row.link_id);
    return Boolean(link && (link.port_a === portId || link.port_b === portId));
  });
}

function slotPositions(n: number): { x: number; y: number }[] {
  if (n <= 0) {
    return [];
  }
  const cols = 12;
  return Array.from({ length: n }, (_, i) => {
    const row = i < cols ? 0 : 1;
    const col = i % cols;
    return {
      x: lerp(32.7, 76.3, (col + 0.5) / cols),
      y: row === 0 ? 38 : 70,
    };
  });
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function tapSlots(n: number): { x: number; y: number }[] {
  const xs = [40.2, 51.8];
  return Array.from({ length: n }, (_, i) => ({
    x: xs[Math.min(i, xs.length - 1)] ?? 46,
    y: 49,
  }));
}

function routerSlots(n: number): { x: number; y: number }[] {
  const xs = [44.4, 50.2, 56.0];
  return Array.from({ length: n }, (_, i) => ({
    x: xs[Math.min(i, xs.length - 1)] ?? 50,
    y: 47,
  }));
}
export const SWITCH_MANY_PORTS = 8;

export function switchChassisKind(portCount: number): "switch" | "switch-many" {
  return portCount > SWITCH_MANY_PORTS ? "switch-many" : "switch";
}
