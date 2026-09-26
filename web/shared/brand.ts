export function cubeMark(): string {
  return `<span class="iso-cube" aria-hidden="true"><i class="c-top"></i><i class="c-left"></i><i class="c-right"></i></span>`;
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
  const items: [string, string][] =
    kind === "pc"
      ? [
          ["lab", "实验环境"],
          ["topo", "网络拓扑"],
          ["box", "工具箱"],
          ["help", "帮助文档"],
        ]
      : kind === "tap"
        ? [
            ["lab", "实验台"],
            ["topo", "拓扑视图"],
            ["pkt", "数据报文"],
            ["gear", "设备管理"],
            ["report", "实验报告"],
          ]
        : kind === "router"
          ? [
              ["lab", "实验台"],
              ["topo", "拓扑"],
              ["gear", "设备"],
              ["pkt", "数据包"],
              ["box", "工具"],
              ["set", "设置"],
            ]
          : [
              ["topo", "拓扑视图"],
              ["switch", "交换机"],
              ["gear", "设备管理"],
              ["task", "实验任务"],
              ["box", "工具箱"],
              ["learn", "学习资源"],
            ];
  const current =
    kind === "pc" ? "lab" : kind === "tap" || kind === "router" ? "lab" : "switch";
  return `<nav class="hud-nav">${items
    .map(([id, label]) => {
      const on = id === current ? " aria-current=\"page\"" : "";
      return `<span class="hud-link"${on}>${label}</span>`;
    })
    .join("")}</nav>`;
}

export function teacherNav(): string {
  return `<nav class="hud-nav"><span class="hud-link" aria-current="page">拓扑视图</span><span class="hud-link">设备管理</span><span class="hud-link">实验任务</span><span class="hud-link">工具箱</span><span class="hud-link">学习资源</span></nav>`;
}
