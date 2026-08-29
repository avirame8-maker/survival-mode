import { getAgent } from "@/lib/engine/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const agent = getAgent();
  await agent.ensureRunning();
  return Response.json(agent.snapshot());
}
