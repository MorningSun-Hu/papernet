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
