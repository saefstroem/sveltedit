import { basename } from "node:path";
import { isExpressionStatement, isImportDeclaration, isStringLiteral, type SourceFile } from "typescript";
import { flat, type Finding } from "./finding";
import { testStart } from "./test-block";

const bare = new Set(["index.ts", "error.ts", "result.ts"]);
const separate = [".test.ts", ".spec.ts", ".test.tsx", ".spec.tsx"];

export function inlineTests(sf: SourceFile): Finding[] {
  const mainish = (): boolean => {
    if (sf.statements.length !== 2) return false;
    const [first, second] = sf.statements;
    if (first === undefined || second === undefined) return false;
    if (!isImportDeclaration(first) || !isStringLiteral(first.moduleSpecifier)) return false;
    return first.moduleSpecifier.text === "./run" && isExpressionStatement(second);
  };
  const name = basename(sf.fileName);
  if (separate.some((ending) => name.endsWith(ending)) || /(^|\/)(__tests__|test)\//.test(sf.fileName))
    return [flat(sf.fileName, 1, "separate test file (Rule 7)")];
  if (bare.has(name) || name.endsWith(".d.ts")) return [];
  if (name === "main.ts" && mainish()) return [];
  if (testStart(sf) !== undefined) return [];
  return [flat(sf.fileName, 1, "logic file without a trailing if (import.meta.vitest) block (Rule 7)")];
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;
  const { createSourceFile, ScriptTarget } = await import("typescript");
  const over = (path: string, text: string) => inlineTests(createSourceFile(path, text, ScriptTarget.Latest, true));

  it("demands a trailing test block on logic files", () => {
    expect(over("a/src/core.ts", "export const a = 1;\n")).toHaveLength(1);
    expect(over("a/src/core.ts", "export const a = 1;\nif (import.meta.vitest) {\n}\n")).toEqual([]);
  });

  it("exempts interface, declarative, declaration and entry files", () => {
    expect(over("a/src/index.ts", 'export { a } from "./core";\n')).toEqual([]);
    expect(over("a/src/error.ts", 'export type Error = { kind: "a.b" };\n')).toEqual([]);
    expect(over("a/src/result.ts", "export type Result<T> = { ok: true; value: T };\n")).toEqual([]);
    expect(over("a/src/ambient.d.ts", 'declare module "*.svelte";\n')).toEqual([]);
    expect(over("a/src/main.ts", 'import { run } from "./run";\n\nprocess.exitCode = await run();\n')).toEqual([]);
    expect(over("a/src/main.ts", "export const a = 1;\n")).toHaveLength(1);
  });

  it("flags separate test files by name and by folder", () => {
    expect(over("a/src/core.test.ts", "")).toHaveLength(1);
    expect(over("a/src/__tests__/core.ts", "")).toHaveLength(1);
    expect(over("a/src/test/core.ts", "")).toHaveLength(1);
    expect(over("a/src/latest/core.ts", "if (import.meta.vitest) {\n}\n")).toEqual([]);
  });
}
