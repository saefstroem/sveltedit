import { basename, join } from "node:path";
import { flat, type Finding } from "./finding";
import type { Listing } from "./walk";

const junk = new Set(["helpers", "utils", "util", "types", "interfaces", "constants", "common", "shared", "misc"]);

export function folders(modules: Map<string, Listing>): Finding[] {
  const out: Finding[] = [];
  for (const [dir, listing] of modules) {
    for (const name of [...listing.files, ...listing.dirs]) {
      const stem = name.endsWith(".ts") ? name.slice(0, -3) : name;
      if (junk.has(stem)) out.push(flat(join(dir, name), 1, "junk-drawer name (Rule 2)"));
    }
    if (!listing.files.some((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"))) continue;
    const owns = (name: string): boolean => listing.files.includes(name);
    const entry = owns("index.ts") || (basename(dir) === "src" && owns("main.ts"));
    if (!entry) out.push(flat(dir, 1, "module folder without index.ts (Rule 1)"));
    if (!owns("error.ts")) out.push(flat(dir, 1, "module folder without error.ts (Rule 8)"));
    if (!owns("result.ts")) out.push(flat(dir, 1, "module folder without result.ts (Rule 8)"));
  }
  return out;
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;
  const listed = (files: string[], dirs: string[] = []) => ({ files, dirs });

  it("requires index, error and result in every module folder", () => {
    const whole = new Map([["p/src", listed(["index.ts", "error.ts", "result.ts", "core.ts"])]]);
    expect(folders(whole)).toEqual([]);
    const bare = new Map([["p/src/wire", listed(["frame.ts"])]]);
    expect(folders(bare).map((hit) => hit.message)).toEqual([
      "module folder without index.ts (Rule 1)",
      "module folder without error.ts (Rule 8)",
      "module folder without result.ts (Rule 8)",
    ]);
  });

  it("lets src carry main.ts instead of index.ts", () => {
    const tool = new Map([["t/src", listed(["main.ts", "error.ts", "result.ts", "run.ts"])]]);
    expect(folders(tool)).toEqual([]);
  });

  it("skips folders with no code and flags junk-drawer names anywhere", () => {
    const empty = new Map([["p/src/fixtures", listed(["a.json"])]]);
    expect(folders(empty)).toEqual([]);
    const junky = new Map([["p/src", listed(["index.ts", "error.ts", "result.ts", "utils.ts"], ["helpers"])]]);
    expect(folders(junky).map((hit) => hit.message)).toEqual([
      "junk-drawer name (Rule 2)",
      "junk-drawer name (Rule 2)",
    ]);
  });
}
