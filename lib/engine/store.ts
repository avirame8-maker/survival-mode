import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { get, put } from "@vercel/blob";
import type { AgentState } from "./types";

const FILE = path.join(
  process.env.VERCEL ? "/tmp" : process.cwd(),
  process.env.VERCEL ? "survival-mode-state.json" : path.join("data", "agent-state.json"),
);

const BLOB_PATH = "paper-week-state.json";

function blobEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function parseState(raw: string): AgentState | null {
  try {
    const parsed = JSON.parse(raw) as AgentState;
    if (!parsed || parsed.version !== 3) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function loadBlob(): Promise<AgentState | null> {
  if (!blobEnabled()) return null;
  try {
    const result = await get(BLOB_PATH, { access: "private", useCache: false });
    if (result.statusCode !== 200 || !result.stream) return null;
    const raw = await new Response(result.stream).text();
    return parseState(raw);
  } catch {
    return null;
  }
}

async function saveBlob(state: AgentState): Promise<void> {
  if (!blobEnabled()) return;
  await put(BLOB_PATH, JSON.stringify(state), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 0,
  });
}

async function loadFile(): Promise<AgentState | null> {
  try {
    return parseState(await readFile(FILE, "utf8"));
  } catch {
    return null;
  }
}

async function saveFile(state: AgentState): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  const raw = JSON.stringify(state);
  await writeFile(tmp, raw, "utf8");
  await writeFile(FILE, raw, "utf8");
}

export async function loadState(): Promise<AgentState | null> {
  return (await loadBlob()) ?? (await loadFile());
}

export async function saveState(state: AgentState): Promise<void> {
  await Promise.all([saveFile(state), saveBlob(state)]);
}
