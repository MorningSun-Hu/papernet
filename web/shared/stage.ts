import type { Device, DeviceKind, LinkView } from "./claim";

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

export function buildStage(device: Device, links: LinkView[]): StageModel {
  const overlay = device.kind !== "pc";
  const coords =
    device.kind === "pc"
      ? device.ports.map(() => ({ x: 18, y: 62 }))
      : slotPositions(device.ports.length);
  const ports: StagePort[] = device.ports.map((port, i) => {
    const peerPortId = port.peer_port_id ? port.peer_port_id : null;
    return {
      portId: port.id,
      overlay,
      x: coords[i]?.x ?? 50,
      y: coords[i]?.y ?? 65,
      peerPortId,
      peerDeviceId: peerPortId ? deviceIdFromPort(peerPortId) : null,
      physicallyUp: isUp(port.id, links),
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

function isUp(portId: string, links: LinkView[]): boolean {
  return links.some(
    (link) =>
      link.physically_up && (link.port_a === portId || link.port_b === portId),
  );
}

function slotPositions(n: number): { x: number; y: number }[] {
  if (n <= 0) {
    return [];
  }
  if (n <= 8) {
    return Array.from({ length: n }, (_, i) => ({
      x: lerp(12, 88, (i + 0.5) / n),
      y: 65,
    }));
  }
  const cols = Math.ceil(n / 2);
  return Array.from({ length: n }, (_, i) => {
    const row = i < cols ? 0 : 1;
    const col = row === 0 ? i : i - cols;
    const rowN = row === 0 ? cols : n - cols;
    return {
      x: lerp(12, 88, (col + 0.5) / rowN),
      y: row === 0 ? 54 : 76,
    };
  });
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
