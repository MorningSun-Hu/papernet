import {
  CLIENT_KIND_HOSTED,
  joinBody,
  screenFromHttp,
  STORAGE_CONNECTION,
  type Screen,
} from "@shared/claim";

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
  return Array.isArray(ports) ? ports.filter((p: unknown) => typeof p === "string") : [];
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
