import type { ModuleDef } from "./types";

export const INITIAL_CAPITAL = 50;
export const SUBSCRIPTION_MONTHLY = 200;
export const MAX_LOG = 180;
export const MAX_CURVE = 360;
export const MAX_HISTORY = 64;
export const MAX_PRED = 36;

export const MODULES: ModuleDef[] = [
  {
    id: "bolt",
    idx: "01",
    name: "BOLT",
    color: "#2AD4C0",
    strategy: "BTC DIP",
    flavor: "btc-dip",
  },
  {
    id: "bram",
    idx: "02",
    name: "BRAM",
    color: "#B08D57",
    strategy: "PREDICTION",
    flavor: "prediction",
  },
  {
    id: "ilsa",
    idx: "03",
    name: "ILSA",
    color: "#FF7A18",
    strategy: "ETH MOMENTUM",
    flavor: "eth-momentum",
  },
  {
    id: "kett",
    idx: "04",
    name: "KETT",
    color: "#E23D2C",
    strategy: "MEAN REVERSION",
    flavor: "mean-reversion",
  },
  {
    id: "rigo",
    idx: "05",
    name: "RIGO",
    color: "#E84A9A",
    strategy: "MACRO EVENTS",
    flavor: "macro",
  },
  {
    id: "tess",
    idx: "06",
    name: "TESS",
    color: "#7A4BBF",
    strategy: "ALTS SCALPING",
    flavor: "alts",
  },
];

export function moduleDef(id: string): ModuleDef {
  return MODULES.find((m) => m.id === id) ?? MODULES[0];
}
