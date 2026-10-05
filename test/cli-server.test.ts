// Copyright 2026 The SpectraWeaver Authors
// SPDX-License-Identifier: Apache-2.0
// Part of SpectraWeaver: https://github.com/YangXu1990uiuc/spectraweaver

import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tempPaths, until } from "./helpers.ts";

test("the page's script and stylesheet load whatever directory the server starts in", async () => {
  const { paths, cleanup } = tempPaths();
  // The temporary directory is not an ancestor of the checkout: Bun's HTML import used to write
  // asset URLs relative to the working directory, which broke the page.
  const server = Bun.spawn(["bun", join(import.meta.dir, "..", "src", "cli.ts"), "server", "--port", "0"], {
    cwd: tmpdir(),
    env: { ...process.env, SPECTRAWEAVER_CONFIG_DIR: paths.configDir, SPECTRAWEAVER_STATE_DIR: paths.stateBase },
    stdout: "ignore",
    stderr: "ignore",
  });
  try {
    await until(() => existsSync(paths.serverStateFile), "the server to start", 15000);
    const { port } = JSON.parse(readFileSync(paths.serverStateFile, "utf8")) as { port: number };
    const page = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    const assets = [...page.matchAll(/(?:src|href)="([^"]*chunk[^"]*)"/g)].map((match) => match[1]!);
    expect(assets.length).toBeGreaterThanOrEqual(2);
    for (const asset of assets) {
      expect({ asset, status: (await fetch(new URL(asset, `http://127.0.0.1:${port}/`))).status }).toEqual({
        asset,
        status: 200,
      });
    }
  } finally {
    server.kill();
    await server.exited;
    cleanup();
  }
});
