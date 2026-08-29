import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import type { AgentState } from "./types";

const FILE = path.join(
  process.env.VERCEL ? "/tmp" : process.cwd(),
  process.env.VERCEL ? "survival-mode-state.json" : path.join("data", "agent-state.json"),
);

export async function loadState(): Promise<AgentState | null> {
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as AgentState;
    if (!parsed || parsed.version !== 2) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveState(state: AgentState): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(state), "utf8");
  await writeFile(FILE, JSON.stringify(state), "utf8");
}
