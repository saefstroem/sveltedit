import { readFileSync } from "node:fs";
import { createSourceFile, ScriptTarget, type SourceFile } from "typescript";
import { bans } from "./bans";
import { closures } from "./closures";
import { comments } from "./comments";
import { flat, type Finding } from "./finding";
import { folders } from "./folders";
import { imports } from "./imports";
import { inlineTests } from "./inline-tests";
import { lines } from "./lines";
import { walk } from "./walk";

const SCANNED = ["packages", "tools"] as const;

export async function run(root = process.cwd()): Promise<number> {
  const tree = walk(root, SCANNED);
  if (!tree.ok) {
    console.error(`${tree.error.path}: unreadable (${String(tree.error.cause)})`);
    return 1;
  }
  const findings: Finding[] = [];
  for (const stray of tree.value.strays) findings.push(flat(stray, 1, "only TypeScript under src (A.0)"));
  findings.push(...folders(tree.value.modules));
  for (const path of tree.value.sources) {
    let text = "";
    try {
      text = readFileSync(path, "utf8");
    } catch (cause) {
      findings.push(flat(path, 1, `unreadable (${String(cause)})`));
      continue;
    }
    const sf: SourceFile = createSourceFile(path, text, ScriptTarget.Latest, true);
    findings.push(...comments(sf), ...inlineTests(sf), ...imports(sf), ...bans(sf), ...closures(sf), ...lines(sf));
  }
  for (const finding of findings) console.error(`${finding.path}:${String(finding.line)} ${finding.message}`);
  return await Promise.resolve(findings.length === 0 ? 0 : 1);
}

if (import.meta.vitest) {
  const { it, expect, vi } = import.meta.vitest;
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const compliant = [
    'import { core } from "./core";',
    "",
    "export const doubled = (n: number): number => core(n) * 2;",
    "",
    "if (import.meta.vitest) {",
    "  const { it: test, expect: sure } = import.meta.vitest;",
    '  test("doubles", () => {',
    "    sure(doubled(2)).toBe(8);",
    "  });",
    "}",
    "",
  ].join("\n");

  it("finds a planted violation under each scanned folder and passes a compliant module", async () => {
    const root = await mkdtemp(join(tmpdir(), "sveltedit-check-"));
    await mkdir(join(root, "packages/bad/src"), { recursive: true });
    await mkdir(join(root, "tools/bad/src"), { recursive: true });
    await writeFile(join(root, "packages/bad/src/index.ts"), "export const a = 1; // planted\n");
    await writeFile(join(root, "packages/bad/src/old.js"), "");
    await writeFile(join(root, "tools/bad/src/loose.ts"), "export const b: unknown = c as string;\n");
    const spoken = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await run(root)).toBe(1);
    const said = spoken.mock.calls.map((call) => String(call[0]));
    spoken.mockRestore();
    expect(said.some((line) => line.includes("comment (Rule 9)"))).toBe(true);
    expect(said.some((line) => line.includes("only TypeScript under src (A.0)"))).toBe(true);
    expect(said.some((line) => line.includes("type assertion (Rule 8)"))).toBe(true);
    expect(said.some((line) => line.includes("without a trailing"))).toBe(true);
    expect(said.some((line) => line.includes("without error.ts"))).toBe(true);
    await rm(root, { recursive: true, force: true });
  });

  it("passes this repository itself", async () => {
    const { fileURLToPath } = await import("node:url");
    const { join: joined, dirname } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const spoken = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const code = await run(joined(here, "../../.."));
    const said = spoken.mock.calls.map((call) => String(call[0]));
    spoken.mockRestore();
    expect(said).toEqual([]);
    expect(code).toBe(0);
  });

  it("returns zero for a compliant tree", async () => {
    const root = await mkdtemp(join(tmpdir(), "sveltedit-green-"));
    await mkdir(join(root, "packages/good/src"), { recursive: true });
    await writeFile(join(root, "packages/good/src/index.ts"), 'export { doubled } from "./steps";\n');
    await writeFile(join(root, "packages/good/src/error.ts"), 'export type Error = { kind: "good.never" };\n');
    await writeFile(
      join(root, "packages/good/src/result.ts"),
      'import type { Error } from "./error";\n\nexport type Result<T> = { ok: true; value: T } | { ok: false; error: Error };\n',
    );
    await writeFile(
      join(root, "packages/good/src/core.ts"),
      compliant.replace('import { core } from "./core";\n\n', "").replace("core(n) * 2", "n * 4"),
    );
    await writeFile(
      join(root, "packages/good/src/steps.ts"),
      compliant.replace("./core", "./core2").replace("core(n)", "n * 2"),
    );
    const spoken = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const code = await run(root);
    const said = spoken.mock.calls.map((call) => String(call[0]));
    spoken.mockRestore();
    expect(said).toEqual([]);
    expect(code).toBe(0);
  });
}
