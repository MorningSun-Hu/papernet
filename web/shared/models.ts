import type { DeviceKind } from "./claim";
import pcFront from "@models/pc-front.png?url";
import pcBack from "@models/pc-back.png?url";
import tapBox from "@models/tap.png?url";
import switchBox from "@models/switch.png?url";
import routerBox from "@models/router.png?url";
import topoPc from "@models/topo-pc.svg?url";
import topoSwitch from "@models/topo-switch-icon.svg?url";
import topoTap from "@models/topo-tap.svg?url";
import topoRouter from "@models/topo-router.svg?url";

export const PC_FRONT = pcFront;
export const PC_BACK = pcBack;

export const CHASSIS: Record<Exclude<DeviceKind, "pc">, string> = {
  switch: switchBox,
  router: routerBox,
  tap: tapBox,
};

export const TOPO_MODEL: Record<DeviceKind, string> = {
  pc: topoPc,
  switch: topoSwitch,
  router: topoRouter,
  tap: topoTap,
};
