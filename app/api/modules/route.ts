import { getAgent } from "@/lib/engine/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const agent = getAgent();
  await agent.ensureRunning();
  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    paused?: boolean;
  };
  if (!body.id || typeof body.paused !== "boolean") {
    return Response.json({ error: "id and paused required" }, { status: 400 });
  }
  return Response.json(await agent.setModulePaused(body.id, body.paused));
}
