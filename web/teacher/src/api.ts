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

export async function createClassroom(title: string, form: InventoryForm): Promise<string> {
  const { status, json } = await post("/api/v1/classrooms", {
    title,
    inventory: buildInventory(form),
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
