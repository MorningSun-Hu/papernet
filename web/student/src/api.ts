import {
  CLIENT_KIND_HOSTED,
  joinBody,
  screenFromHttp,
  STORAGE_CONNECTION,
  type Screen,
} from "@shared/claim";
import { withoutTapPorts } from "@shared/workbench";

export async function joinClassroom(connectionId?: string | null): Promise<Screen> {
  const res = await fetch("/api/v1/classrooms/join", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Client-Kind": CLIENT_KIND_HOSTED,
    },
    body: JSON.stringify(joinBody(connectionId)),
  });
  const body = await res.json().catch(() => ({}));
  return screenFromHttp(res.status, body);
}

export function loadConnectionId(): string | null {
  return sessionStorage.getItem(STORAGE_CONNECTION);
}

export function persistScreen(screen: Screen): void {
  if (screen.kind === "waiting_open" || screen.kind === "claimed") {
    sessionStorage.setItem(STORAGE_CONNECTION, screen.connectionId);
    return;
  }
  sessionStorage.removeItem(STORAGE_CONNECTION);
}

export async function listPeers(connectionId: string): Promise<string[]> {
  const res = await fetch("/api/v1/ports/peers", {
    headers: {
      "X-Client-Kind": CLIENT_KIND_HOSTED,
      "X-Connection-Id": connectionId,
    },
  });
  const body = await res.json().catch(() => ({}));
  const ports = body?.data?.ports;
  const ids = Array.isArray(ports) ? ports.filter((p: unknown) => typeof p === "string") : [];
  return withoutTapPorts(ids);
}

export async function putPort(
  connectionId: string,
  deviceId: string,
  portId: string,
  patch: { ip?: string; gateway?: string; peer_port_id?: string },
): Promise<unknown> {
  const res = await fetch(
    `/api/v1/devices/${encodeURIComponent(deviceId)}/ports/${encodeURIComponent(portId)}`,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "X-Client-Kind": CLIENT_KIND_HOSTED,
        "X-Connection-Id": connectionId,
      },
      body: JSON.stringify(patch),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error?.message || "保存端口失败");
  }
  return body.data ?? body;
}

export async function sendChat(
  connectionId: string,
  toIp: string,
  text: string,
): Promise<unknown> {
  return postJson("/api/v1/chat", connectionId, { to_ip: toIp, text });
}

export async function sendPing(connectionId: string, toIp: string): Promise<{ detail: string }> {
  const data = (await postJson("/api/v1/ping", connectionId, { to_ip: toIp })) as {
    detail?: string;
  };
  return { detail: data.detail || `来自 ${toIp} 的虚拟响应` };
}

export async function simSend(
  connectionId: string,
  toIp: string,
  text: string,
): Promise<unknown> {
  return postJson("/api/v1/sim/send", connectionId, { to_ip: toIp, text });
}

export async function forwardFrame(
  connectionId: string,
  frameId: string,
  outPortId: string,
): Promise<unknown> {
  return postJson(`/api/v1/sim/frames/${encodeURIComponent(frameId)}/forward`, connectionId, {
    out_port_id: outPortId,
  });
}

export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function postJson(
  path: string,
  connectionId: string,
  payload: Record<string, string>,
): Promise<unknown> {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Client-Kind": CLIENT_KIND_HOSTED,
      "X-Connection-Id": connectionId,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(body?.error?.code || "ERROR", body?.error?.message || "请求失败");
  }
  return body.data ?? body;
}
