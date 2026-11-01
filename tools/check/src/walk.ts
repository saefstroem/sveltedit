import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Result } from "./result";

export interface Listing {
  files: string[];
  dirs: string[];
}

export interface Tree {
  sources: string[];
  strays: string[];
  modules: Map<string, Listing>;
}

const skipped = new Set(["node_modules", "dist"]);
const strayed = [".js", ".mjs", ".cjs", ".jsx"];

export function walk(root: string, scanned: readonly string[]): Result<Tree> {
  const tree: Tree = { sources: [], strays: [], modules: new Map() };
  const descend = (dir: string, inSrc: boolean): Result<undefined> => {
    let names: { name: string; directory: boolean }[] = [];
    try {
      names = readdirSync(dir, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        directory: entry.isDirectory(),
      }));
    } catch (cause) {
      return { ok: false, error: { kind: "check.unreadable", path: dir, cause } };
    }
    const here: Listing = { files: [], dirs: [] };
    for (const entry of names) {
      if (entry.name.startsWith(".") || skipped.has(entry.name)) continue;
      const path = join(dir, entry.name);
      const below = inSrc || entry.name === "src";
      if (entry.directory) {
        here.dirs.push(entry.name);
        const fell = descend(path, below);
        if (!fell.ok) return fell;
        continue;
      }
      here.files.push(entry.name);
      if (!inSrc) continue;
      if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) tree.sources.push(path);
      else if (strayed.some((ending) => entry.name.endsWith(ending))) tree.strays.push(path);
    }
    if (inSrc) tree.modules.set(dir, here);
    return { ok: true, value: undefined };
  };
  for (const name of scanned) {
    const fell = descend(join(root, name), false);
    if (!fell.ok && !String(fell.error.cause).includes("ENOENT")) return fell;
  }
  return { ok: true, value: tree };
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join: joined } = await import("node:path");

  it("collects sources and strays under src and skips the rest", async () => {
    const root = await mkdtemp(joined(tmpdir(), "sveltedit-walk-"));
    await mkdir(joined(root, "packages/a/src/deep"), { recursive: true });
    await mkdir(joined(root, "packages/a/node_modules/x"), { recursive: true });
    await writeFile(joined(root, "packages/a/src/index.ts"), "");
    await writeFile(joined(root, "packages/a/src/deep/core.ts"), "");
    await writeFile(joined(root, "packages/a/src/old.js"), "");
    await writeFile(joined(root, "packages/a/outside.ts"), "");
    await writeFile(joined(root, "packages/a/node_modules/x/lib.ts"), "");
    const tree = walk(root, ["packages", "tools"]);
    expect(tree.ok).toBe(true);
    if (tree.ok) {
      expect(tree.value.sources.map((path) => path.slice(root.length)).sort()).toEqual([
        "/packages/a/src/deep/core.ts",
        "/packages/a/src/index.ts",
      ]);
      expect(tree.value.strays.map((path) => path.slice(root.length))).toEqual(["/packages/a/src/old.js"]);
      expect([...tree.value.modules.keys()].map((path) => path.slice(root.length)).sort()).toEqual([
        "/packages/a/src",
        "/packages/a/src/deep",
      ]);
    }
    await rm(root, { recursive: true, force: true });
  });

  it("treats a missing scanned folder as empty", () => {
    const tree = walk("/nowhere/at/all", ["packages"]);
    expect(tree.ok).toBe(true);
    if (tree.ok) expect(tree.value.sources).toEqual([]);
  });
}
