import { runEngine, RunResult } from "./engine/run";

export async function runAutoSignals(env: Env, opts: { force?: boolean; symbol?: string } = {}): Promise<RunResult[]> {
  return runEngine(env, opts);
}
