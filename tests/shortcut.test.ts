/** Desktop icon generation: quoting rules, file contents, and the Linux launcher end to end. */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  createShortcut,
  desktopEntry,
  desktopExecArg,
  infoPlist,
  macAppExecutable,
  posixLauncher,
  shellQuote,
  windowsShortcutScript,
} from "../scripts/shortcut.mjs";

describe("quoting", () => {
  it("shell-quotes single quotes and leaves everything else literal", () => {
    assert.equal(shellQuote("/Users/me/My Jobs"), "'/Users/me/My Jobs'");
    assert.equal(shellQuote("it's $HOME"), "'it'\\''s $HOME'");
    // The shell must read it back unchanged.
    const echoed = spawnSync("sh", ["-c", `printf %s ${shellQuote("it's $HOME `x`")}`], { encoding: "utf8" });
    assert.equal(echoed.stdout, "it's $HOME `x`");
  });

  it("escapes .desktop Exec arguments per the spec", () => {
    assert.equal(desktopExecArg("/home/me/launch.sh"), '"/home/me/launch.sh"');
    assert.equal(desktopExecArg("/home/my dir/launch.sh"), '"/home/my dir/launch.sh"');
    assert.equal(desktopExecArg('/a"b$c%d'), '"/a\\\\"b\\\\$c%%d"');
  });
});

describe("generated files", () => {
  it("launcher script cds into the project and puts Node on PATH", () => {
    const script = posixLauncher({ projectDir: "/home/me/apply pilot", nodeBin: "/opt/node/bin" });
    assert.match(script, /^#!\/bin\/sh\n/);
    assert.match(script, /PATH='\/opt\/node\/bin':"\$PATH"/);
    assert.match(script, /cd '\/home\/me\/apply pilot' \|\| exit 1/);
    assert.match(script, /node scripts\/launch\.mjs/);
    assert.equal(spawnSync("sh", ["-n"], { input: script }).status, 0, "valid shell syntax");
  });

  it("desktop entry runs in a terminal with the app icon", () => {
    const entry = desktopEntry({ exec: "/home/me/.local/share/applypilot/launch.sh", icon: "/p/assets/applypilot.png" });
    assert.match(entry, /^\[Desktop Entry\]\nType=Application\n/);
    assert.match(entry, /\nExec="\/home\/me\/\.local\/share\/applypilot\/launch\.sh"\n/);
    assert.match(entry, /\nIcon=\/p\/assets\/applypilot\.png\n/);
    assert.match(entry, /\nTerminal=true\n/);
  });

  it("mac bundle points its executable and icon at the right names", () => {
    const plist = infoPlist();
    assert.match(plist, /<key>CFBundleExecutable<\/key><string>ApplyPilot<\/string>/);
    assert.match(plist, /<key>CFBundleIconFile<\/key><string>applypilot<\/string>/);
    assert.match(macAppExecutable(), /open -a Terminal "\$\(dirname "\$0"\)\/\.\.\/Resources\/launch\.command"/);
    assert.equal(spawnSync("sh", ["-n"], { input: macAppExecutable() }).status, 0);
  });

  it("windows script takes every path from the environment", () => {
    const script = windowsShortcutScript();
    assert.match(script, /WScript\.Shell/);
    assert.match(script, /\$env:APPLYPILOT_TARGET/);
    assert.match(script, /GetFolderPath\(\$folder\)/);
    assert.doesNotMatch(script, /[A-Z]:\\/, "no hard-coded paths");
  });
});

describe("createShortcut on Linux", { skip: process.platform !== "linux" }, () => {
  it("writes an executable launcher, a desktop icon and a menu entry", () => {
    const home = mkdtempSync(path.join(tmpdir(), "applypilot-home-"));
    mkdirSync(path.join(home, "Desktop"));
    const previous = { HOME: process.env.HOME, XDG_DATA_HOME: process.env.XDG_DATA_HOME };
    process.env.HOME = home;
    delete process.env.XDG_DATA_HOME;
    try {
      const created = createShortcut(process.cwd());
      assert.deepEqual(created, [
        path.join(home, "Desktop", "applypilot.desktop"),
        path.join(home, ".local", "share", "applications", "applypilot.desktop"),
      ]);

      const launcher = path.join(home, ".local", "share", "applypilot", "launch.sh");
      assert.ok(statSync(launcher).mode & 0o100, "launcher is executable");
      assert.ok(statSync(created[0]).mode & 0o100, "desktop icon is executable");
      assert.match(readFileSync(launcher, "utf8"), new RegExp(`cd '${process.cwd()}'`));
      assert.match(readFileSync(created[0], "utf8"), new RegExp(`Icon=${process.cwd()}/assets/applypilot.png`));
    } finally {
      process.env.HOME = previous.HOME;
      if (previous.XDG_DATA_HOME) process.env.XDG_DATA_HOME = previous.XDG_DATA_HOME;
    }
  });
});
