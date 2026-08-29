import { Agent, createInitialState } from "./agent";

const g = globalThis as unknown as { __survivalAgent?: Agent };

export function getAgent(): Agent {
  if (!g.__survivalAgent) {
    g.__survivalAgent = new Agent(createInitialState());
  }
  return g.__survivalAgent;
}
