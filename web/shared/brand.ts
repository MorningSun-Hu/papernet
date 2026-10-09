export function cubeMark(): string {
  return `<span class="iso-cube" aria-hidden="true"><i class="c-top"></i><i class="c-left"></i><i class="c-right"></i></span>`;
}

export const APP_VERSION = "0.2.2";

export function hudVersion(): string {
  return `<p class="hud-ver">v${APP_VERSION}</p>`;
}

export function brandLockup(): string {
  return `<div class="brand-lockup">${cubeMark()}<div class="brand-copy"><strong>纸上谈网</strong><span>NETWORK LAB</span></div></div>`;
}

export function hudClock(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function studentNav(kind: string): string {
  void kind;
  const items: [string, string][] = [
    ["lab", "实验环境"],
    ["topo", "网络拓扑"],
    ["box", "工具箱"],
    ["help", "帮助文档"],
  ];
  return `<nav class="hud-nav">${items
    .map(([id, label]) => {
      const on = id === "lab" ? " aria-current=\"page\"" : "";
      return `<span class="hud-link"${on}>${label}</span>`;
    })
    .join("")}</nav>`;
}

export function teacherNav(): string {
  return `<nav class="hud-nav"><span class="hud-link" aria-current="page">拓扑视图</span><span class="hud-link">设备管理</span><span class="hud-link">实验任务</span><span class="hud-link">工具箱</span><span class="hud-link">学习资源</span></nav>`;
}
