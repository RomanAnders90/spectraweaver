// Copyright 2026 The SpectraWeaver Authors
// SPDX-License-Identifier: Apache-2.0
// Part of SpectraWeaver: https://github.com/YangXu1990uiuc/spectraweaver

// What SpectraWeaver knows about each coding agent CLI, kept in one place: how to recognise
// it, how its exit message says to resume, and which of its flags to keep when resuming.

import { basename } from "node:path";

/** How many values a flag takes: none, one, or all that follow until the next flag. */
type Arity = 0 | 1 | "many";

export interface Agent {
  name: "claude" | "codex";
  /** Whether this is the agent's program (argv[0], or the script a runtime runs). */
  matches(program: string): boolean;
  /** The resume command the agent prints when it exits, one per line. */
  hint: RegExp;
  /**
   * Flags carried over to the resumed session. Anything else is dropped: resume options,
   * an initial prompt (which would be sent again), and flags whose values we can't parse.
   */
  carry: Record<string, Arity>;
}

export const AGENTS: Agent[] = [
  {
    name: "claude",
    matches: (program) => basename(program) === "claude" || program.includes("@anthropic-ai/claude-code/"),
    // "Resume this session with:\nclaude [--worktree NAME ]--resume ID", or a quoted session name.
    hint: /^claude (?:--worktree \S+ )?--resume \S.*$/gm,
    carry: {
      "--dangerously-skip-permissions": 0,
      "--allow-dangerously-skip-permissions": 0,
      "--permission-mode": 1,
      "--model": 1,
      "--fallback-model": 1,
      "--agent": 1,
      "--settings": 1,
      "--add-dir": "many",
      "--mcp-config": "many",
      "--strict-mcp-config": 0,
      "--append-system-prompt": 1,
      "--system-prompt": 1,
    },
  },
  {
    name: "codex",
    matches: (program) => ["codex", "codex.js"].includes(basename(program)) || program.includes("@openai/codex/"),
    // "To continue this session, run:" and "codex resume ID", on the same line or the next.
    hint: /(?<=^|\s)codex resume \S+/gm,
    carry: {
      "--dangerously-bypass-approvals-and-sandbox": 0,
      "--yolo": 0,
      "--full-auto": 0,
      "--search": 0,
      "--oss": 0,
      "-a": 1,
      "--ask-for-approval": 1,
      "-s": 1,
      "--sandbox": 1,
      "-m": 1,
      "--model": 1,
      "-p": 1,
      "--profile": 1,
      "-c": 1,
      "--config": 1,
      "-C": 1,
      "--cd": 1,
      "--add-dir": 1,
    },
  },
];

const RUNTIMES = new Set(["node", "nodejs", "bun", "deno"]);

/** Where the program is in a command line: after the runtime, for scripts like npm installs. */
export function programIndex(argv: string[]): number {
  return argv.length > 1 && RUNTIMES.has(basename(argv[0] ?? "")) ? 1 : 0;
}

export function detectAgent(argv: string[]): Agent | null {
  const program = argv[programIndex(argv)];
  return program === undefined ? null : (AGENTS.find((agent) => agent.matches(program)) ?? null);
}

/** The flags (with their values) worth keeping, from the arguments after the program. */
export function carriedFlags(agent: Agent, args: string[]): string[] {
  const kept: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const arity = agent.carry[eq > 0 ? arg.slice(0, eq) : arg];
    if (arity === undefined) continue;
    kept.push(arg);
    if (eq > 0) continue; // --flag=value
    if (arity === 1 && i + 1 < args.length) kept.push(args[++i]!);
    if (arity === "many") while (i + 1 < args.length && !args[i + 1]!.startsWith("-")) kept.push(args[++i]!);
  }
  return kept;
}

export function shellQuote(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}

/** The command that resumes: the agent's own hint (already quoted for a shell), plus the kept flags. */
export function resumeCommand(hint: string, flags: string[]): string {
  return [hint, ...flags.map(shellQuote)].join(" ");
}

/**
 * The resume command the agent printed between two readings of the screen. Only a new one
 * counts: the screen may still show older ones, from an earlier exit or the command that
 * resumed this very session. Returns the last new one, or null.
 */
export function findNewHint(agent: Agent, before: string, after: string): string | null {
  const hints = (text: string) => [...text.matchAll(agent.hint)].map((match) => match[0].trim());
  const now = hints(after);
  return now.length > hints(before).length ? now.at(-1)! : null;
}

/** Plain text from terminal output: escape sequences removed, lines trimmed. */
export function terminalText(data: string): string {
  return data
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "") // OSC
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "") // CSI
    .replace(/\x1b[()][0-9A-Za-z]/g, "") // character sets
    .replace(/\x1b[@-_]/g, "") // other escapes
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
}
