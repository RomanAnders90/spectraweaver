// Copyright 2026 The SpectraWeaver Authors
// SPDX-License-Identifier: Apache-2.0
// Part of SpectraWeaver: https://github.com/YangXu1990uiuc/spectraweaver

import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientMessage, ServerMessage, SessionView } from "../src/common/protocol.ts";
import { type DaemonHandle, startDaemon } from "../src/daemon/daemon.ts";
import { foregroundProcess } from "../src/server/foreground.ts";
import { type ServerHandle, startServer } from "../src/server/server.ts";
import { fixture, TEST_SHELL, tempPaths, until } from "./helpers.ts";

let cleanup: () => void;
let bin: string;
let log: string;
let daemon: DaemonHandle;
let server: ServerHandle;
let ws: WebSocket;
const messages: ServerMessage[] = [];
const sessions = new Map<string, SessionView>();

beforeAll(async () => {
  const temp = tempPaths();
  cleanup = temp.cleanup;
  // Fake `claude` and `codex` programs on the sessions' PATH.
  bin = mkdtempSync(join(tmpdir().length > 40 ? "/tmp" : tmpdir(), "sw-bin-"));
  for (const name of ["claude", "codex"]) {
    writeFileSync(join(bin, name), `#!/usr/bin/env bun\nimport ${JSON.stringify(fixture("fake-agent.ts"))};\n`);
    chmodSync(join(bin, name), 0o755);
  }
  log = join(bin, "log.jsonl");
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_AGENT_LOG: log };
  daemon = await startDaemon({ paths: temp.paths, shellArgv: TEST_SHELL, env, log: () => {} });
  server = await startServer({ paths: temp.paths, host: "127.0.0.1", port: 0, log: () => {} });
  const base = `http://127.0.0.1:${server.port}`;
  const login = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ token: server.token }),
  });
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;
  ws = new WebSocket(`${base.replace("http", "ws")}/ws`, { headers: { origin: base, cookie } } as never);
  ws.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    const message = JSON.parse(event.data) as ServerMessage;
    if (message.t === "sessions") for (const session of message.sessions) sessions.set(session.id, session);
    if (message.t === "session") sessions.set(message.session.id, message.session);
    messages.push(message);
  });
  await new Promise((resolve) => ws.addEventListener("open", resolve));
});

afterAll(async () => {
  ws.close();
  await server.stop();
  await daemon.stop();
  cleanup();
  rmSync(bin, { recursive: true, force: true });
});

function send(message: ClientMessage): void {
  ws.send(JSON.stringify(message));
}

async function next<T extends ServerMessage>(predicate: (message: ServerMessage) => boolean, timeoutMs = 8000): Promise<T> {
  let found: ServerMessage | undefined;
  await until(() => (found = messages.find(predicate)) !== undefined, "a server message", timeoutMs);
  messages.splice(messages.indexOf(found!), 1);
  return found as T;
}

async function createSession(cmd?: string): Promise<SessionView> {
  const known = new Set(sessions.keys());
  send({ t: "create", cols: 100, rows: 30, cmd });
  await until(() => [...sessions.keys()].some((id) => !known.has(id)), "a new session");
  return [...sessions.values()].find((session) => !known.has(session.id))!;
}

const running = (session: SessionView) => foregroundProcess(session.pid)?.argv.join(" ") ?? "";
const launches = () =>
  existsSync(log)
    ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { name: string; args: string[] })
    : [];

test("Stop agents makes Claude Code and Codex exit and remembers how to resume them", async () => {
  const claude = await createSession('claude --dangerously-skip-permissions --model opus "fix the login bug"');
  const codex = await createSession("codex --yolo -m gpt-5");
  const shell = await createSession();
  await until(() => launches().length === 2, "both agents", 15000);

  send({ t: "agents-stop" });
  const stopped = await next<Extract<ServerMessage, { t: "agents-done" }>>((m) => m.t === "agents-done", 30000);
  expect(stopped).toMatchObject({ action: "stop", done: 2, failed: [] });

  const uuid = "[0-9a-f-]{36}";
  expect(sessions.get(claude.id)?.stopped?.command).toMatch(
    new RegExp(`^claude --resume ${uuid} --dangerously-skip-permissions --model opus$`),
  );
  expect(sessions.get(codex.id)?.stopped?.command).toMatch(new RegExp(`^codex resume ${uuid} --yolo -m gpt-5$`));
  expect(sessions.get(shell.id)?.stopped).toBeUndefined();
  expect(foregroundProcess(claude.pid)?.isShell).toBe(true);
  expect(foregroundProcess(codex.pid)?.isShell).toBe(true);

  // Resume: each agent starts again in its terminal, on the same session, with its flags,
  // and without the initial prompt.
  const claudeId = sessions.get(claude.id)!.stopped!.command.split(" ")[2]!;
  const codexId = sessions.get(codex.id)!.stopped!.command.split(" ")[2]!;
  send({ t: "agents-resume" });
  const resumed = await next<Extract<ServerMessage, { t: "agents-done" }>>((m) => m.t === "agents-done");
  expect(resumed).toMatchObject({ action: "resume", done: 2, failed: [] });
  await until(() => launches().length === 4, "the agents to start again", 15000);
  const again = launches().slice(2);
  expect(again.find((launch) => launch.name === "claude")?.args).toEqual([
    "--resume",
    claudeId,
    "--dangerously-skip-permissions",
    "--model",
    "opus",
  ]);
  expect(again.find((launch) => launch.name === "codex")?.args).toEqual(["resume", codexId, "--yolo", "-m", "gpt-5"]);
  expect(sessions.get(claude.id)?.stopped).toBeUndefined();
  await until(() => running(claude).includes("claude") && running(codex).includes("codex"), "both agents again", 15000);
});
