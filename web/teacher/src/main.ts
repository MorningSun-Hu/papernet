import "./style.css";
import routerUrl from "@icons/logical/router.svg?url";
import switchUrl from "@icons/logical/switch.svg?url";
import pcUrl from "@icons/logical/pc.svg?url";
import tapUrl from "@icons/logical/tap.svg?url";
import { createClassroom, loadClassroomId, openClaim } from "./api";

const app = mount();

function mount(): HTMLDivElement {
  const el = document.querySelector<HTMLDivElement>("#app");
  if (!el) {
    throw new Error("missing #app");
  }
  return el;
}

type FormState = {
  title: string;
  pcCount: number;
  switchCount: number;
  switchPorts: number;
  routerCount: number;
  routerPorts: number;
  tapCount: number;
};

const form: FormState = {
  title: "八年级1班",
  pcCount: 2,
  switchCount: 2,
  switchPorts: 4,
  routerCount: 1,
  routerPorts: 2,
  tapCount: 0,
};

let classroomId = loadClassroomId();
let claimState = classroomId ? "draft" : "";
let notice = "";

function render(): void {
  app.innerHTML = `
    <main>
      <header class="mast">
        <p class="eyebrow">纸上谈网 · 教师席</p>
        <h1>本课设备定员</h1>
        <div class="icons" aria-hidden="true">
          <img src="${pcUrl}" alt="" />
          <img src="${switchUrl}" alt="" />
          <img src="${routerUrl}" alt="" />
          <img src="${tapUrl}" alt="" />
        </div>
      </header>
      <form id="roster">
        <label>课堂名称
          <input name="title" value="${escapeAttr(form.title)}" />
        </label>
        <div class="grid">
          ${stepper("pcCount", "PC 台数", form.pcCount, 0, 48)}
          ${stepper("switchCount", "交换机台数", form.switchCount, 0, 24)}
          ${stepper("switchPorts", "交换机口数", form.switchPorts, 1, 24)}
          ${stepper("routerCount", "路由器台数", form.routerCount, 0, 12)}
          ${stepper("routerPorts", "路由器口数", form.routerPorts, 1, 8)}
          ${stepper("tapCount", "特殊双口交换机", form.tapCount, 0, 8)}
        </div>
        <div class="actions">
          <button type="submit" id="create">创建课堂</button>
          <button type="button" id="open" ${classroomId ? "" : "disabled"}>开放领取</button>
        </div>
      </form>
      <p class="status" data-claim="${escapeAttr(claimState)}">${statusLine()}</p>
    </main>
  `;
  bind();
}

function stepper(name: keyof FormState, label: string, value: number, min: number, max: number): string {
  return `
    <label>${label}
      <input name="${name}" type="number" min="${min}" max="${max}" value="${value}" />
    </label>
  `;
}

function statusLine(): string {
  if (notice) {
    return notice;
  }
  if (!classroomId) {
    return "填写数量后创建课堂。学生此时看到等待文案。";
  }
  if (claimState === "open" || claimState === "full") {
    return `课堂 ${classroomId} 已开放领取（${claimState}）。`;
  }
  return `课堂 ${classroomId} 已创建，尚未开放领取。`;
}

function bind(): void {
  const roster = document.querySelector<HTMLFormElement>("#roster");
  roster?.addEventListener("input", () => {
    const data = new FormData(roster);
    form.title = String(data.get("title") || form.title);
    form.pcCount = num(data, "pcCount", form.pcCount);
    form.switchCount = num(data, "switchCount", form.switchCount);
    form.switchPorts = num(data, "switchPorts", form.switchPorts);
    form.routerCount = num(data, "routerCount", form.routerCount);
    form.routerPorts = num(data, "routerPorts", form.routerPorts);
    form.tapCount = num(data, "tapCount", form.tapCount);
  });
  roster?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    notice = "";
    try {
      classroomId = await createClassroom(form.title, form);
      claimState = "draft";
    } catch (err) {
      notice = err instanceof Error ? err.message : "创建课堂失败";
    }
    render();
  });
  document.querySelector<HTMLButtonElement>("#open")?.addEventListener("click", async () => {
    if (!classroomId) {
      return;
    }
    notice = "";
    try {
      claimState = await openClaim(classroomId);
    } catch (err) {
      notice = err instanceof Error ? err.message : "开放领取失败";
    }
    render();
  });
}

function num(data: FormData, name: string, fallback: number): number {
  const raw = Number(data.get(name));
  return Number.isFinite(raw) ? raw : fallback;
}

function escapeAttr(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

render();
