// Copyright 2026 The SpectraWeaver Authors
// SPDX-License-Identifier: Apache-2.0
// Part of SpectraWeaver: https://github.com/YangXu1990uiuc/spectraweaver

import { expect, test } from "bun:test";
import { defaultShellArgv } from "../src/daemon/daemon.ts";

test("bash on Linux is not a login shell, so it reads ~/.bashrc", () => {
  expect(defaultShellArgv("/bin/bash", "linux")).toEqual(["/bin/bash"]);
  expect(defaultShellArgv("/usr/local/bin/bash", "linux")).toEqual(["/usr/local/bin/bash"]);
});

test("other shells, and bash on macOS, start as login shells", () => {
  expect(defaultShellArgv("/bin/bash", "darwin")).toEqual(["/bin/bash", "-l"]);
  expect(defaultShellArgv("/usr/bin/zsh", "linux")).toEqual(["/usr/bin/zsh", "-l"]);
  expect(defaultShellArgv("/usr/bin/fish", "linux")).toEqual(["/usr/bin/fish", "-l"]);
  expect(defaultShellArgv("/bin/sh", "linux")).toEqual(["/bin/sh", "-l"]);
});
