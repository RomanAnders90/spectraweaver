// Copyright 2026 The SpectraWeaver Authors
// SPDX-License-Identifier: Apache-2.0
// Part of SpectraWeaver: https://github.com/YangXu1990uiuc/spectraweaver

// Stands in for Claude Code or Codex (whichever name it runs under): a full-screen program
// that exits on Ctrl+C pressed twice and then prints how to resume, as the real ones do.
// It appends its arguments to $FAKE_AGENT_LOG.

import { appendFileSync } from "node:fs";
import { basename } from "node:path";

// Raw mode first, as a real agent is by the time anyone presses Ctrl+C: in cooked mode the
// terminal would turn Ctrl+C into SIGINT. The log line then tells tests it is ready.
process.stdin.setRawMode(true);
process.stdin.resume();

const name = basename(process.argv[1] ?? "");
const args = process.argv.slice(2);
if (process.env.FAKE_AGENT_LOG) appendFileSync(process.env.FAKE_AGENT_LOG, `${JSON.stringify({ name, args })}\n`);

const resumeAt = args.indexOf(name === "claude" ? "--resume" : "resume");
const id = resumeAt >= 0 ? args[resumeAt + 1] : crypto.randomUUID();
process.stdout.write(`\x1b[?1049h\x1b[H${name} (fake) working on ${id}\r\n`);

let lastCtrlC = 0;
process.stdin.on("data", (data: Buffer) => {
  if (!data.includes(3)) return;
  const now = Date.now();
  if (now - lastCtrlC > 1500) {
    lastCtrlC = now;
    process.stdout.write("Press Ctrl-C again to exit\r\n");
    return;
  }
  process.stdin.setRawMode(false);
  process.stdout.write("\x1b[?1049l");
  process.stdout.write(
    name === "claude"
      ? `\r\n\x1b[2mResume this session with:\r\nclaude --resume ${id}\x1b[0m\r\n`
      : `\r\nTo continue this session, run:\r\ncodex resume ${id}\r\n`,
  );
  process.exit(0);
});
