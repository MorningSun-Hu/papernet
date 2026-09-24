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
  return sessionStorage.getItem(STORAGE_CLASSROOM);
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
  sessionStorage.setItem(STORAGE_CLASSROOM, id);
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

export async function fetchSnapshot(classroomId: string): Promise<unknown> {
  const res = await fetch(`/api/v1/classrooms/${encodeURIComponent(classroomId)}/snapshot`, {
    headers: { "X-Client-Kind": CLIENT_KIND_TEACHER },
  });
  const json = (await res.json().catch(() => ({}))) as ApiBody;
  if (res.status >= 400) {
    throw new Error(json.error?.message || "读取快照失败");
  }
  return json.data ?? json;
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
