export const MSG_WAITING_OPEN = "请等待教师确定本课设备";
export const MSG_CLASSROOM_FULL = "本课设备已领完，请看教师屏";

export const CLIENT_KIND_HOSTED = "student-hosted";
export const CLIENT_KIND_TEACHER = "teacher";

export const STORAGE_CONNECTION = "papernet.connection_id";
export const STORAGE_CLASSROOM = "papernet.classroom_id";

export type DeviceKind = "pc" | "switch" | "router" | "tap";

export type DevicePort = {
  id: string;
  ip?: string | null;
  mask?: string | null;
  gateway?: string | null;
  peer_port_id?: string | null;
  mac?: string | null;
};

export type Device = {
  id: string;
  kind: DeviceKind;
  mac?: string | null;
  ports: DevicePort[];
};

export type Screen =
  | { kind: "idle"; message: string }
  | { kind: "waiting_open"; message: string; connectionId: string }
  | { kind: "claimed"; connectionId: string; device: Device }
  | { kind: "full"; message: string }
  | { kind: "error"; message: string };

export const ROLE_SHELL: Record<DeviceKind, string> = {
  pc: "pc",
  switch: "switch",
  router: "router",
  tap: "tap",
};

export const ROLE_LABEL: Record<DeviceKind, string> = {
  pc: "PC",
  switch: "交换机",
  router: "路由器",
  tap: "特殊双口交换机",
};

export function roleShell(kind: string | undefined): DeviceKind | null {
  if (kind === "pc" || kind === "switch" || kind === "router" || kind === "tap") {
    return kind;
  }
  return null;
}

export function joinBody(connectionId?: string | null): {
  client_kind: typeof CLIENT_KIND_HOSTED;
  connection_id?: string;
} {
  const body: { client_kind: typeof CLIENT_KIND_HOSTED; connection_id?: string } = {
    client_kind: CLIENT_KIND_HOSTED,
  };
  if (connectionId) {
    body.connection_id = connectionId;
  }
  return body;
}

export function wsPath(connectionId: string, classroomId?: string | null): string {
  const q = new URLSearchParams({ connection_id: connectionId });
  if (classroomId) {
    q.set("classroom_id", classroomId);
  }
  return `/ws?${q.toString()}`;
}

export function screenFromHttp(httpStatus: number, body: unknown): Screen {
  const root = asRecord(body);
  const data = asRecord(root.data);
  const error = asRecord(root.error);
  const status = str(data.status);

  if (status === "waiting_open") {
    const connectionId = str(data.connection_id);
    if (!connectionId) {
      return { kind: "error", message: "加入课堂失败" };
    }
    return {
      kind: "waiting_open",
      connectionId,
      message: str(data.message) || MSG_WAITING_OPEN,
    };
  }

  if (status === "claimed") {
    const connectionId = str(data.connection_id);
    const device = parseDevice(data.device);
    if (!connectionId || !device) {
      return { kind: "error", message: "领取角色失败" };
    }
    return { kind: "claimed", connectionId, device };
  }

  if (
    httpStatus === 409 ||
    status === "full" ||
    str(error.code) === "CLASSROOM_FULL"
  ) {
    return {
      kind: "full",
      message: str(error.message) || MSG_CLASSROOM_FULL,
    };
  }

  const msg = str(error.message) || str(data.message) || "当前没有课堂";
  return { kind: "error", message: msg };
}

export function applyWsEvent(screen: Screen, payload: unknown): Screen {
  const root = asRecord(payload);
  const event = str(root.event);
  if (event === "claim.granted") {
    const device = parseDevice(root.device);
    const connectionId =
      screen.kind === "waiting_open" || screen.kind === "claimed"
        ? screen.connectionId
        : str(root.connection_id);
    if (!device || !connectionId) {
      return screen;
    }
    return { kind: "claimed", connectionId, device };
  }
  if (event === "claim.full") {
    return {
      kind: "full",
      message: str(root.message) || MSG_CLASSROOM_FULL,
    };
  }
  return screen;
}

export type InventoryForm = {
  pcCount: number;
  switchCount: number;
  switchPorts: number;
  routerCount: number;
  routerPorts: number;
  tapCount: number;
};

export function buildInventory(form: InventoryForm) {
  return {
    routers: numbered("R", form.routerCount).map((id) => ({
      id,
      port_count: Math.max(1, form.routerPorts),
    })),
    switches: numbered("S", form.switchCount).map((id) => ({
      id,
      port_count: Math.max(1, form.switchPorts),
    })),
    pcs: numbered("PC", form.pcCount).map((id) => ({ id })),
    taps: numbered("TAP", form.tapCount).map((id) => ({ id })),
  };
}

function numbered(prefix: string, count: number): string[] {
  const n = Math.max(0, Math.floor(count));
  return Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
}

function parseDevice(value: unknown): Device | null {
  const rec = asRecord(value);
  const id = str(rec.id);
  const kind = roleShell(str(rec.kind));
  if (!id || !kind) {
    return null;
  }
  const portsRaw = Array.isArray(rec.ports) ? rec.ports : [];
  const ports: DevicePort[] = portsRaw.map((p) => {
    const port = asRecord(p);
    return {
      id: str(port.id),
      ip: port.ip == null ? null : str(port.ip),
      mask: port.mask == null ? null : str(port.mask),
      gateway: port.gateway == null ? null : str(port.gateway),
      peer_port_id: port.peer_port_id == null ? null : str(port.peer_port_id),
      mac: port.mac == null ? null : str(port.mac),
    };
  });
  return { id, kind, mac: rec.mac == null ? null : str(rec.mac), ports };
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
