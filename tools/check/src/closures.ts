import {
  canHaveModifiers,
  forEachChild,
  getModifiers,
  isArrowFunction,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isPropertyAccessExpression,
  isVariableDeclaration,
  isVariableStatement,
  SyntaxKind,
  type Node,
  type SourceFile,
  type Statement,
} from "typescript";
import { found, type Finding } from "./finding";
import { testStart } from "./test-block";

export function closures(sf: SourceFile): Finding[] {
  const fnName = (statement: Statement): string | undefined => {
    if (isFunctionDeclaration(statement) && statement.name !== undefined) return statement.name.text;
    if (!isVariableStatement(statement)) return undefined;
    const sole = statement.declarationList.declarations[0];
    if (sole === undefined || statement.declarationList.declarations.length !== 1) return undefined;
    if (!isIdentifier(sole.name) || sole.initializer === undefined) return undefined;
    if (!isArrowFunction(sole.initializer) && !isFunctionExpression(sole.initializer)) return undefined;
    return sole.name.text;
  };
  const exported = (statement: Statement): boolean =>
    canHaveModifiers(statement) &&
    (getModifiers(statement) ?? []).some((modifier) => modifier.kind === SyntaxKind.ExportKeyword);
  const limit = testStart(sf) ?? sf.end;
  const tops = sf.statements.filter((statement) => statement.getStart(sf) < limit);
  const candidates = new Map<string, Statement>();
  for (const statement of tops) {
    const name = fnName(statement);
    if (name === undefined || exported(statement)) continue;
    if (sf.fileName.endsWith(".tsx") && (/^[A-Z]/.test(name) || name.startsWith("use"))) continue;
    candidates.set(name, statement);
  }
  if (candidates.size === 0) return [];
  const callers = new Map<string, Set<Statement>>();
  for (const statement of tops) {
    const visit = (node: Node): void => {
      if (
        isIdentifier(node) &&
        candidates.has(node.text) &&
        !(isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
        !(isFunctionDeclaration(node.parent) && node.parent.name === node) &&
        !(isVariableDeclaration(node.parent) && node.parent.name === node)
      ) {
        const set = callers.get(node.text) ?? new Set<Statement>();
        set.add(statement);
        callers.set(node.text, set);
      }
      forEachChild(node, visit);
    };
    visit(statement);
  }
  const out: Finding[] = [];
  for (const [name, statement] of candidates) {
    const refs = new Set(callers.get(name) ?? []);
    refs.delete(statement);
    if (refs.size !== 1) continue;
    const [sole] = refs;
    if (sole !== undefined && fnName(sole) !== undefined)
      out.push(
        found(sf, statement.getStart(sf), `single-use helper "${name}" must be a closure inside its caller (Rule 10)`),
      );
  }
  return out;
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;
  const { createSourceFile, ScriptTarget } = await import("typescript");
  const over = (text: string, path = "a.ts") =>
    closures(createSourceFile(path, text, ScriptTarget.Latest, true)).map((hit) => hit.message);

  it("flags a private function referenced by exactly one function", () => {
    expect(over("function help() {}\nexport function run() {\n  help();\n}\n")).toEqual([
      'single-use helper "help" must be a closure inside its caller (Rule 10)',
    ]);
    expect(over("const help = () => 1;\nexport const run = () => help();\n")).toHaveLength(1);
  });

  it("counts a value reference as a call and spares two-caller helpers", () => {
    expect(over("const parse = () => 1;\nexport const run = (list: number[]) => list.map(parse);\n")).toHaveLength(1);
    expect(
      over("function help() {}\nexport function a() {\n  help();\n}\nexport function b() {\n  help();\n}\n"),
    ).toEqual([]);
  });

  it("spares exported, module-referenced, recursive and component-shaped functions", () => {
    expect(over("export function help() {}\nexport function run() {\n  help();\n}\n")).toEqual([]);
    expect(over("function help() {}\nexport const api = { help };\n")).toEqual([]);
    expect(over("function help(): void {\n  help();\n}\nexport const run = () => help();\n")).toHaveLength(1);
    expect(over("function Help() {\n  return 1;\n}\nexport function Run() {\n  return Help();\n}\n", "a.tsx")).toEqual(
      [],
    );
    expect(over("function useHelp() {}\nexport function Run() {\n  useHelp();\n  return 1;\n}\n", "a.tsx")).toEqual([]);
  });

  it("ignores references inside the test block", () => {
    expect(
      over("function help() {}\nexport function run() {\n  help();\n}\nif (import.meta.vitest) {\n  help();\n}\n"),
    ).toHaveLength(1);
  });
}
