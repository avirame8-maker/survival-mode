import { getAgent } from "@/lib/engine/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const agent = getAgent();
  await agent.ensureRunning();
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  switch (body.action) {
    case "pause":
      return Response.json(await agent.pauseAgent());
    case "resume":
      return Response.json(await agent.resumeAgent());
    case "liquidate":
      return Response.json(await agent.liquidate());
    case "respawn":
      return Response.json(await agent.respawn());
    case "tick":
      await agent.maybeTick(true);
      return Response.json(agent.snapshot());
    case "debug-kill":
      return Response.json(await agent.debugKill());
    default:
      return Response.json({ error: "unknown action" }, { status: 400 });
  }
}
