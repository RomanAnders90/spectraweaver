// Copyright 2026 The SpectraWeaver Authors
// SPDX-License-Identifier: Apache-2.0
// Part of SpectraWeaver: https://github.com/YangXu1990uiuc/spectraweaver

import { expect, test } from "bun:test";
import {
  AGENTS,
  carriedFlags,
  detectAgent,
  findNewHint,
  programIndex,
  resumeCommand,
  terminalText,
} from "../src/server/agents.ts";

const claude = AGENTS.find((agent) => agent.name === "claude")!;
const codex = AGENTS.find((agent) => agent.name === "codex")!;

test("agents are recognised however they were installed, and nothing else is", () => {
  expect(detectAgent(["claude", "--model", "opus"])?.name).toBe("claude");
  expect(detectAgent(["/home/me/.local/bin/claude"])?.name).toBe("claude");
  expect(detectAgent(["node", "/usr/lib/node_modules/@anthropic-ai/claude-code/cli.js"])?.name).toBe("claude");
  expect(detectAgent(["codex", "--yolo"])?.name).toBe("codex");
  expect(detectAgent(["node", "/usr/lib/node_modules/@openai/codex/bin/codex.js", "resume", "x"])?.name).toBe("codex");
  expect(programIndex(["node", "/x/cli.js", "-c"])).toBe(1);

  expect(detectAgent(["vim", "claude"])).toBeNull(); // an argument, not the program
  expect(detectAgent(["bash"])).toBeNull();
  expect(detectAgent([])).toBeNull();
});

test("resuming keeps the flags that matter and drops prompts and old resume options", () => {
  expect(
    carriedFlags(claude, ["--dangerously-skip-permissions", "--model", "opus", "fix the login bug"]),
  ).toEqual(["--dangerously-skip-permissions", "--model", "opus"]);
  expect(carriedFlags(claude, ["--resume", "old-id", "--permission-mode=plan", "--add-dir", "a", "b", "--verbose"])).toEqual([
    "--permission-mode=plan",
    "--add-dir",
    "a",
    "b",
  ]);
  expect(carriedFlags(codex, ["resume", "old-id", "--yolo", "-m", "gpt-5", "-c", "model_reasoning_effort=high"])).toEqual([
    "--yolo",
    "-m",
    "gpt-5",
    "-c",
    "model_reasoning_effort=high",
  ]);
});

test("the resume command is the agent's hint plus the kept flags, quoted for the shell", () => {
  expect(resumeCommand("claude --resume abc", ["--model", "opus"])).toBe("claude --resume abc --model opus");
  expect(resumeCommand("codex resume abc", ["--add-dir", "/my dir"])).toBe("codex resume abc --add-dir '/my dir'");
});

test("only a resume hint printed after the agent was asked to exit counts", () => {
  const id = "3f2a9c1e-0b7d-4e1a-9c2f-5d6e7f8a9b0c";
  const before = terminalText(
    "me@box:~/repo$ claude --resume 11111111-old --model opus\r\n" + // how this session was resumed
      "\x1b[2mResume this session with:\r\nclaude --resume 00000000-older\x1b[0m\r\n", // an earlier exit
  );
  expect(findNewHint(claude, before, before)).toBeNull();
  const after = `${before}\n\x1b[2mResume this session with:\nclaude --resume ${id}\x1b[0m\nme@box:~/repo$ `;
  expect(findNewHint(claude, before, terminalText(after))).toBe(`claude --resume ${id}`);

  // Named sessions and worktrees.
  expect(findNewHint(claude, "", 'Resume this session with:\nclaude --resume "auth refactor"\n')).toBe(
    'claude --resume "auth refactor"',
  );
  expect(findNewHint(claude, "", "claude --worktree feat --resume abc\n")).toBe("claude --worktree feat --resume abc");

  // Codex, with the command on its own line or after the sentence.
  expect(findNewHint(codex, "", `To continue this session, run:\ncodex resume ${id}\n`)).toBe(`codex resume ${id}`);
  expect(findNewHint(codex, "", `To continue this session, run: codex resume ${id}\n`)).toBe(`codex resume ${id}`);
});

test("terminal output becomes plain text", () => {
  expect(terminalText("\x1b]0;title\x07\x1b[1;32mgreen\x1b[0m line  \r\n\x1b(Bnext")).toBe("green line\nnext");
});
