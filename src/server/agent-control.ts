// Copyright 2026 The SpectraWeaver Authors
// SPDX-License-Identifier: Apache-2.0
// Part of SpectraWeaver: https://github.com/YangXu1990uiuc/spectraweaver

// Stopping the coding agents in terminals, to update them, and starting them again where
// they left off. The agents themselves print how to resume when they exit; see agents.ts.

import { carriedFlags, detectAgent, findNewHint, programIndex, resumeCommand } from "./agents.ts";
import type { ForegroundProcess } from "./foreground.ts";

export interface AgentControlDeps {
  input(session: string, data: string): void;
  /** The terminal's text (scrollback and screen), escape sequences removed. */
  screenText(session: string): Promise<string>;
  foreground(shellPid: number): ForegroundProcess | null;
  sleep?(ms: number): Promise<void>;
}

export type StopResult =
  | { kind: "stopped"; agent: string; command: string }
  | { kind: "none" } // no agent runs in this terminal
  | { kind: "failed"; agent: string; reason: string };

const CTRL_C = "\x03";
const EXIT_ROUNDS = 3;
const EXIT_WAIT_MS = 4000;
const HINT_WAIT_MS = 3000;

/**
 * Makes the agent in a terminal exit and works out how to resume it. Agents exit on Ctrl+C
 * pressed twice; a first press may only interrupt the current task or cancel a question,
 * so it tries a few rounds. Ctrl+C is safer than typing /exit, whose Enter could answer a
 * permission question.
 */
export async function stopAgent(deps: AgentControlDeps, session: string, shellPid: number): Promise<StopResult> {
  const sleep = deps.sleep ?? Bun.sleep;
  const running = deps.foreground(shellPid);
  if (!running || running.isShell) return { kind: "none" };
  const agent = detectAgent(running.argv);
  if (!agent) return { kind: "none" };
  const flags = carriedFlags(agent, running.argv.slice(programIndex(running.argv) + 1));
  const before = await deps.screenText(session);

  const atPrompt = () => deps.foreground(shellPid)?.isShell === true;
  let exited = false;
  for (let round = 0; round < EXIT_ROUNDS && !exited; round++) {
    deps.input(session, CTRL_C);
    await sleep(300);
    deps.input(session, CTRL_C);
    exited = await waitFor(atPrompt, EXIT_WAIT_MS, sleep);
  }
  if (!exited) return { kind: "failed", agent: agent.name, reason: "it did not exit" };

  // The daemon may still be taking in the agent's last output.
  for (let waited = 0; waited <= HINT_WAIT_MS; waited += 200) {
    const hint = findNewHint(agent, before, await deps.screenText(session));
    if (hint) return { kind: "stopped", agent: agent.name, command: resumeCommand(hint, flags) };
    await sleep(200);
  }
  return { kind: "failed", agent: agent.name, reason: "it exited without saying how to resume it" };
}

/**
 * Types the resume command at the terminal's prompt. "running" means the same agent already
 * runs there again (resumed by hand), "busy" that something else does.
 */
export function resumeAgent(
  deps: AgentControlDeps,
  session: string,
  shellPid: number,
  stopped: { agent: string; command: string },
): "resumed" | "running" | "busy" {
  const running = deps.foreground(shellPid);
  if (running?.isShell !== true) {
    return running && detectAgent(running.argv)?.name === stopped.agent ? "running" : "busy";
  }
  // Ctrl+U first clears anything half-typed at the prompt.
  deps.input(session, `\x15${stopped.command}\r`);
  return "resumed";
}

async function waitFor(check: () => boolean, timeoutMs: number, sleep: (ms: number) => Promise<void>): Promise<boolean> {
  for (let waited = 0; waited < timeoutMs; waited += 100) {
    if (check()) return true;
    await sleep(100);
  }
  return check();
}
