import {
  CLIENT_KIND_TEACHER,
  STORAGE_CLASSROOM,
  type InventoryForm,
  buildInventory,
} from "@shared/claim";

type ApiBody = {
  ok?: boolean;
  data?: Record<string, unknown>;
  error?: { message?: string };
};

async function post(path: string, body?: unknown): Promise<{ status: number; json: ApiBody }> {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Client-Kind": CLIENT_KIND_TEACHER,
    },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await res.json().catch(() => ({}))) as ApiBody;
  return { status: res.status, json };
}

export function loadClassroomId(): string | null {
  const local = localStorage.getItem(STORAGE_CLASSROOM);
  if (local) {
    sessionStorage.removeItem(STORAGE_CLASSROOM);
    return local;
  }
  const session = sessionStorage.getItem(STORAGE_CLASSROOM);
  if (session) {
    localStorage.setItem(STORAGE_CLASSROOM, session);
    sessionStorage.removeItem(STORAGE_CLASSROOM);
    return session;
  }
  return null;
}

export function clearClassroomId(): void {
  localStorage.removeItem(STORAGE_CLASSROOM);
  sessionStorage.removeItem(STORAGE_CLASSROOM);
}

export async function createClassroom(
  title: string,
  form: InventoryForm,
  inventory = buildInventory(form),
): Promise<string> {
  const { status, json } = await post("/api/v1/classrooms", {
    title,
    inventory,
  });
  const id = typeof json.data?.classroom_id === "string" ? json.data.classroom_id : "";
  if (status >= 400 || !id) {
    throw new Error(json.error?.message || "创建课堂失败");
  }
  localStorage.setItem(STORAGE_CLASSROOM, id);
  sessionStorage.removeItem(STORAGE_CLASSROOM);
  return id;
}

export async function openClaim(classroomId: string): Promise<string> {
  const { status, json } = await post(`/api/v1/classrooms/${classroomId}/open-claim`);
  if (status >= 400) {
    throw new Error(json.error?.message || "开放领取失败");
  }
  const state = typeof json.data?.claim_state === "string" ? json.data.claim_state : "open";
  return state;
}

export async function pauseClaim(classroomId: string): Promise<string> {
  const { status, json } = await post(`/api/v1/classrooms/${classroomId}/pause-claim`);
  if (status >= 400) {
    throw new Error(json.error?.message || "暂停领取失败");
  }
  const state = typeof json.data?.claim_state === "string" ? json.data.claim_state : "paused";
  return state;
}

export async function fetchSnapshot(classroomId: string): Promise<unknown> {
  const res = await fetch(`/api/v1/classrooms/${encodeURIComponent(classroomId)}/snapshot`, {
    headers: { "X-Client-Kind": CLIENT_KIND_TEACHER },
  });
  const json = (await res.json().catch(() => ({}))) as ApiBody;
  if (res.status === 404) {
    const err = new Error(json.error?.message || "课堂不存在");
    err.name = "ClassroomGone";
    throw err;
  }
  if (res.status >= 400) {
    throw new Error(json.error?.message || "读取快照失败");
  }
  return json.data ?? json;
}

export async function fetchCurrentClassroomId(): Promise<string | null> {
  const res = await fetch("/api/v1/classrooms/current", {
    headers: { "X-Client-Kind": CLIENT_KIND_TEACHER },
  });
  if (res.status === 404) {
    return null;
  }
  const json = (await res.json().catch(() => ({}))) as ApiBody;
  if (res.status >= 400) {
    throw new Error(json.error?.message || "读取当前课堂失败");
  }
  const id = typeof json.data?.classroom_id === "string" ? json.data.classroom_id : "";
  if (!id) {
    return null;
  }
  localStorage.setItem(STORAGE_CLASSROOM, id);
  sessionStorage.removeItem(STORAGE_CLASSROOM);
  return id;
}

export async function unbindDevice(classroomId: string, deviceId: string): Promise<void> {
  const { status, json } = await post(
    `/api/v1/classrooms/${classroomId}/devices/${encodeURIComponent(deviceId)}/unbind`,
  );
  if (status >= 400) {
    throw new Error(json.error?.message || "解除绑定失败");
  }
}

export async function setMode(classroomId: string, mode: "normal" | "simulation"): Promise<string> {
  const { status, json } = await post(`/api/v1/classrooms/${classroomId}/mode`, { mode });
  if (status >= 400) {
    throw new Error(json.error?.message || "切换模式失败");
  }
  return typeof json.data?.mode === "string" ? json.data.mode : mode;
}

export async function attachTap(
  classroomId: string,
  tapId: string,
  portA: string,
  portB: string,
): Promise<unknown> {
  const { status, json } = await post(`/api/v1/classrooms/${classroomId}/taps/${encodeURIComponent(tapId)}/attach`, {
    link: { port_a: portA, port_b: portB },
  });
  if (status >= 400) {
    throw new Error(json.error?.message || "挂接失败");
  }
  return json.data ?? json;
}

export async function endClassroom(classroomId: string): Promise<void> {
  const { status, json } = await post(`/api/v1/classrooms/${classroomId}/end`);
  if (status >= 400) {
    throw new Error(json.error?.message || "结束课堂失败");
  }
  clearClassroomId();
}
