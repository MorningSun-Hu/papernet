export const MSG_WAITING_OPEN = "请等待教师确定本课设备";
export const MSG_CLASSROOM_FULL = "本课设备已领完，请看教师屏";
export const MSG_WRONG_PORT = "端口不正确";

export const CLIENT_KIND_HOSTED = "student-hosted";
export const CLIENT_KIND_STANDALONE = "student-standalone";
export const CLIENT_KIND_TEACHER = "teacher";

export const STORAGE_CONNECTION = "papernet.connection_id";
export const STORAGE_CLASSROOM = "papernet.classroom_id";

export type DeviceKind = "pc" | "switch" | "router" | "tap";

export type StudentClientKind =
  | typeof CLIENT_KIND_HOSTED
  | typeof CLIENT_KIND_STANDALONE;

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

export type LinkView = {
  link_id: string;
  port_a: string;
  port_b: string;
  physically_up: boolean;
};

export type TapAttachView = {
  tap_id: string;
  link_id: string;
};

export type MacEntry = {
  switch_id: string;
  port_id: string;
  mac: string;
};

export type ArpEntry = {
  device_id: string;
  ip: string;
  mac: string;
};

export type ChatLine = {
  from_ip: string;
  to_ip: string;
  text: string;
  dir: "sent" | "received";
};

export type SimFrameView = {
  frame_id: string;
  dst_mac: string;
  src_mac: string;
  src_ip: string;
  dst_ip: string;
  payload: string;
  at_device_id: string;
  status: string;
  changed: string[];
  ingress: { dst_mac: string; src_mac: string } | null;
};

export type ClaimedScreen = {
  kind: "claimed";
  connectionId: string;
  device: Device;
  links: LinkView[];
  mode: "normal" | "simulation";
  macTable: MacEntry[];
  arpTable: ArpEntry[];
  chatLog: ChatLine[];
  pingDetail: string;
  notice: string;
  frame: SimFrameView | null;
  tapLog: SimFrameView[];
  tapAttach: TapAttachView[];
  chatPeerIp: string;
  chatError: string;
  chatPrompt: boolean;
};

export type Screen =
  | { kind: "idle"; message: string }
  | { kind: "waiting_open"; message: string; connectionId: string }
  | ClaimedScreen
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
  tap: "网络分流器",
};

export function roleShell(kind: string | undefined): DeviceKind | null {
  if (kind === "pc" || kind === "switch" || kind === "router" || kind === "tap") {
    return kind;
  }
  return null;
}

export function deviceTitle(kind: DeviceKind, id: string): string {
  return `${ROLE_LABEL[kind]} ${id}`;
}

export function documentTitle(screen: Screen): string {
  if (screen.kind === "claimed") {
    return `纸上谈网 · ${deviceTitle(screen.device.kind, screen.device.id)}`;
  }
  if (screen.kind === "waiting_open") {
    return `纸上谈网 · ${MSG_WAITING_OPEN}`;
  }
  if (screen.kind === "full") {
    return `纸上谈网 · ${MSG_CLASSROOM_FULL}`;
  }
  return `纸上谈网 · ${screen.message}`;
}

const KIND_ORDER: Record<DeviceKind, number> = { pc: 0, switch: 1, router: 2, tap: 3 };

export function formatClaimRoster(
  devices: { kind: DeviceKind; id: string; claimed: boolean }[],
): { taken: number; total: number; claimed: string; free: string } {
  const sorted = [...devices].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id.localeCompare(b.id));
  const claimed = sorted.filter((d) => d.claimed).map((d) => deviceTitle(d.kind, d.id)).join("、");
  const free = sorted.filter((d) => !d.claimed).map((d) => deviceTitle(d.kind, d.id)).join("、");
  return {
    taken: sorted.filter((d) => d.claimed).length,
    total: sorted.length,
    claimed,
    free,
  };
}

export function joinBody(
  connectionId?: string | null,
  kind: StudentClientKind = CLIENT_KIND_HOSTED,
  nicMac?: string | null,
): {
  client_kind: StudentClientKind;
  connection_id?: string;
  nic_mac?: string;
} {
  const body: {
    client_kind: StudentClientKind;
    connection_id?: string;
    nic_mac?: string;
  } = {
    client_kind: kind,
  };
  if (connectionId) {
    body.connection_id = connectionId;
  }
  if (kind === CLIENT_KIND_STANDALONE && nicMac) {
    body.nic_mac = nicMac;
  }
  return body;
}

export function studentClientFromSearch(search = ""): {
  kind: StudentClientKind;
  nicMac: string | null;
  connectionId: string | null;
} {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const q = new URLSearchParams(raw);
  const kind =
    q.get("client_kind") === CLIENT_KIND_STANDALONE
      ? CLIENT_KIND_STANDALONE
      : CLIENT_KIND_HOSTED;
  const nicMac = (q.get("nic_mac") || "").trim();
  const connectionId = (q.get("connection_id") || "").trim();
  return {
    kind,
    nicMac: nicMac || null,
    connectionId: connectionId || null,
  };
}

export function currentStudentClient(): {
  kind: StudentClientKind;
  nicMac: string | null;
  connectionId: string | null;
} {
  if (typeof location === "undefined") {
    return { kind: CLIENT_KIND_HOSTED, nicMac: null, connectionId: null };
  }
  return studentClientFromSearch(location.search);
}

export function studentUiUrl(
  teacherBase: string,
  nicMac: string,
  connectionId?: string | null,
): string {
  const base = teacherBase.replace(/\/+$/, "");
  let url = `${base}/student/?client_kind=${CLIENT_KIND_STANDALONE}&nic_mac=${nicMac}`;
  if (connectionId) {
    url += `&connection_id=${connectionId}`;
  }
  return url;
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
    return {
      ...blankClaimed(connectionId, device),
      tapAttach: parseTapAttach(data.tap_attach),
    };
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
    return blankClaimed(connectionId, device);
  }
  if (event === "claim.released") {
    if (screen.kind === "claimed" && str(root.device_id) && str(root.device_id) !== screen.device.id) {
      return screen;
    }
    const connectionId =
      screen.kind === "waiting_open" || screen.kind === "claimed" ? screen.connectionId : "";
    if (!connectionId) {
      return screen;
    }
    return {
      kind: "waiting_open",
      connectionId,
      message: str(root.message) || MSG_WAITING_OPEN,
    };
  }
  if (event === "claim.full") {
    return {
      kind: "full",
      message: str(root.message) || MSG_CLASSROOM_FULL,
    };
  }
  if (event === "topology.updated" && screen.kind === "claimed") {
    const next = applyTopologyPatch(screen.device, screen.links, root);
    return {
      ...screen,
      device: next.device,
      links: next.links,
      macTable: Array.isArray(root.mac_table) ? parseMacTable(root.mac_table) : screen.macTable,
      arpTable: Array.isArray(root.arp_table) ? parseArpTable(root.arp_table) : screen.arpTable,
      tapAttach:
        root.tap_attach != null ? mergeTapAttach(screen.tapAttach, root.tap_attach) : screen.tapAttach,
    };
  }
  if ((event === "hello" || event === "mode.changed") && screen.kind === "claimed") {
    const mode = str(root.mode);
    const tapAttach =
      root.tap_attach != null ? parseTapAttach(root.tap_attach) : screen.tapAttach;
    if (mode === "normal" || mode === "simulation") {
      return { ...screen, mode, notice: "", tapAttach };
    }
    if (root.tap_attach != null) {
      return { ...screen, tapAttach };
    }
  }
  if ((event === "chat.sent" || event === "chat.received") && screen.kind === "claimed") {
    return {
      ...screen,
      chatLog: [
        ...screen.chatLog,
        {
          from_ip: str(root.from_ip),
          to_ip: str(root.to_ip),
          text: str(root.text),
          dir: event === "chat.sent" ? "sent" : "received",
        },
      ],
      chatError: "",
    };
  }
  if (event === "frame.built" && screen.kind === "claimed") {
    const frame = parseFrame(root.frame);
    if (!frame) {
      return screen;
    }
    if (screen.frame?.frame_id === frame.frame_id) {
      return screen;
    }
    return {
      ...screen,
      frame,
      chatLog: [
        ...screen.chatLog,
        { from_ip: frame.src_ip, to_ip: frame.dst_ip, text: frame.payload, dir: "sent" },
      ],
      notice: "",
    };
  }
  if ((event === "frame.arrived" || event === "frame.repack") && screen.kind === "claimed") {
    const frame = parseFrame(root.frame);
    if (!frame) {
      return screen;
    }
    const prev = parseFrame(root.prev_frame) ?? (screen.frame?.frame_id === frame.frame_id ? screen.frame : null);
    const nextFrame = withChangedFields(frame, prev, screen);
    if (event === "frame.arrived" && nextFrame.status === "delivered") {
      const line = {
        from_ip: nextFrame.src_ip,
        to_ip: nextFrame.dst_ip,
        text: nextFrame.payload,
        dir: "received" as const,
      };
      const dup = screen.chatLog.some(
        (row) =>
          row.dir === "received" &&
          row.from_ip === line.from_ip &&
          row.to_ip === line.to_ip &&
          row.text === line.text,
      );
      return {
        ...screen,
        frame: nextFrame,
        notice: "",
        chatLog: dup ? screen.chatLog : [...screen.chatLog, line],
      };
    }
    return { ...screen, frame: nextFrame, notice: "" };
  }
  if (event === "frame.departed" && screen.kind === "claimed") {
    const id = str(root.frame_id);
    if (screen.frame && screen.frame.frame_id === id && screen.frame.changed.length) {
      return screen;
    }
    return {
      ...screen,
      frame: screen.frame && screen.frame.frame_id === id ? null : screen.frame,
      notice: "",
    };
  }
  if (event === "frame.logged" && screen.kind === "claimed") {
    const frame = parseFrame(root.frame);
    return {
      ...screen,
      tapLog: frame ? [...screen.tapLog, frame] : screen.tapLog,
    };
  }
  return screen;
}

export function blankClaimed(
  connectionId: string,
  device: Device,
  links: LinkView[] = [],
): ClaimedScreen {
  return {
    kind: "claimed",
    connectionId,
    device,
    links,
    mode: "normal",
    macTable: [],
    arpTable: [],
    chatLog: [],
    pingDetail: "",
    notice: "",
    frame: null,
    tapLog: [],
    tapAttach: [],
    chatPeerIp: "",
    chatError: "",
    chatPrompt: false,
  };
}

export function applyNotice(screen: Screen, message: string): Screen {
  if (screen.kind !== "claimed") {
    return screen;
  }
  return { ...screen, notice: message };
}

export function applyPingDetail(screen: Screen, detail: string): Screen {
  if (screen.kind !== "claimed") {
    return screen;
  }
  const line = {
    from_ip: screen.chatPeerIp || "",
    to_ip: screen.chatPeerIp || "",
    text: detail,
    dir: "sent" as const,
  };
  return {
    ...screen,
    pingDetail: detail,
    notice: "",
    chatError: "",
    chatLog: screen.device.kind === "pc" ? [...screen.chatLog, line] : screen.chatLog,
  };
}

export function applyChatError(screen: Screen, message: string): Screen {
  if (screen.kind !== "claimed") {
    return screen;
  }
  return { ...screen, chatError: message, notice: "" };
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

export function targetClassroomInventory() {
  return {
    routers: [
      {
        id: "R1",
        port_count: 2,
        ports: [
          { id: "R1/01", ip: "192.168.1.1" },
          { id: "R1/02", ip: "192.168.2.1" },
        ],
      },
    ],
    switches: [
      { id: "S1", port_count: 2 },
      { id: "S2", port_count: 2 },
    ],
    pcs: [{ id: "PCA" }, { id: "PCB" }],
    taps: [] as { id: string }[],
  };
}

function numbered(prefix: string, count: number): string[] {
  const n = Math.max(0, Math.floor(count));
  return Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
}

export function parseLinks(raw: unknown): LinkView[] {
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

export function applyTopologyPatch(
  device: Device,
  links: LinkView[],
  payload: unknown,
): { device: Device; links: LinkView[] } {
  const root = asRecord(payload);
  let ports = device.ports;
  if (Array.isArray(root.ports)) {
    const incoming = new Map(
      root.ports.map((item) => {
        const port = parsePort(item);
        return [port.id, port] as const;
      }),
    );
    ports = device.ports.map((port) => incoming.get(port.id) ?? port);
  }
  return {
    device: { ...device, ports },
    links: Array.isArray(root.links) ? parseLinks(root.links) : links,
  };
}

function parseDevice(value: unknown): Device | null {
  const rec = asRecord(value);
  const id = str(rec.id);
  const kind = roleShell(str(rec.kind));
  if (!id || !kind) {
    return null;
  }
  const portsRaw = Array.isArray(rec.ports) ? rec.ports : [];
  const ports: DevicePort[] = portsRaw.map((p) => parsePort(p));
  return { id, kind, mac: rec.mac == null ? null : str(rec.mac), ports };
}

function parsePort(value: unknown): DevicePort {
  const port = asRecord(value);
  return {
    id: str(port.id),
    ip: port.ip == null ? null : str(port.ip),
    mask: port.mask == null ? null : str(port.mask),
    gateway: port.gateway == null ? null : str(port.gateway),
    peer_port_id: port.peer_port_id == null ? null : str(port.peer_port_id),
    mac: port.mac == null ? null : str(port.mac),
  };
}

function parseMacTable(raw: unknown): MacEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item) => {
      const rec = asRecord(item);
      return {
        switch_id: str(rec.switch_id),
        port_id: str(rec.port_id),
        mac: str(rec.mac),
      };
    })
    .filter((row) => row.switch_id && row.port_id && row.mac);
}

function parseArpTable(raw: unknown): ArpEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item) => {
      const rec = asRecord(item);
      return {
        device_id: str(rec.device_id),
        ip: str(rec.ip),
        mac: str(rec.mac),
      };
    })
    .filter((row) => row.device_id && row.ip && row.mac);
}

function parseFrame(value: unknown): SimFrameView | null {
  const rec = asRecord(value);
  const frame_id = str(rec.frame_id);
  if (!frame_id) {
    return null;
  }
  return {
    frame_id,
    dst_mac: str(rec.dst_mac),
    src_mac: str(rec.src_mac),
    src_ip: str(rec.src_ip),
    dst_ip: str(rec.dst_ip),
    payload: str(rec.payload),
    at_device_id: str(rec.at_device_id),
    status: str(rec.status),
    changed: Array.isArray(rec.changed)
      ? rec.changed.filter((item): item is string => typeof item === "string")
      : [],
    ingress: parseIngress(rec.ingress),
  };
}

function parseIngress(value: unknown): { dst_mac: string; src_mac: string } | null {
  const rec = asRecord(value);
  const dst_mac = str(rec.dst_mac);
  const src_mac = str(rec.src_mac);
  return dst_mac && src_mac ? { dst_mac, src_mac } : null;
}

const FRAME_FIELDS = ["dst_mac", "src_mac", "src_ip", "dst_ip", "payload"] as const;

function withChangedFields(frame: SimFrameView, prev: SimFrameView | null, screen: ClaimedScreen): SimFrameView {
  const changed = new Set(frame.changed);
  if (prev) {
    for (const field of FRAME_FIELDS) {
      if (prev[field] !== frame[field]) {
        changed.add(field);
      }
    }
  } else if (frame.status === "delivered" && screen.device.kind === "pc") {
    const arpMac = screen.arpTable.find((row) => row.device_id === screen.device.id && row.ip === frame.src_ip)?.mac;
    if (arpMac && arpMac !== frame.src_mac) {
      changed.add("src_mac");
    }
  }
  const ingress = prev
    ? {
        dst_mac: prev.ingress?.dst_mac ?? prev.dst_mac,
        src_mac: prev.ingress?.src_mac ?? prev.src_mac,
      }
    : frame.ingress;
  return { ...frame, changed: [...changed], ingress };
}

function parseTapAttach(raw: unknown): TapAttachView[] {
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

function mergeTapAttach(current: TapAttachView[], raw: unknown): TapAttachView[] {
  let next = current;
  for (const row of parseTapAttach(raw)) {
    next = next.filter((item) => item.tap_id !== row.tap_id).concat(row);
  }
  return next;
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
export const MSG_CHAT_UNREACHABLE = "消息发送失败，对方 IP 不可达";
export const MSG_PORT_BUSY = "端口已被占用";
