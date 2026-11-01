import { isIfStatement, isMetaProperty, isPropertyAccessExpression, type SourceFile } from "typescript";

export function testStart(sf: SourceFile): number | undefined {
  const last = sf.statements[sf.statements.length - 1];
  if (last === undefined || !isIfStatement(last) || last.elseStatement !== undefined) return undefined;
  const gate = last.expression;
  if (!isPropertyAccessExpression(gate) || gate.name.text !== "vitest") return undefined;
  if (!isMetaProperty(gate.expression)) return undefined;
  return last.getStart(sf);
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;
  const { createSourceFile, ScriptTarget } = await import("typescript");
  const parsed = (text: string) => createSourceFile("a.ts", text, ScriptTarget.Latest, true);

  it("finds the trailing test block", () => {
    const text = "const a = 1;\nif (import.meta.vitest) {\n}\n";
    expect(testStart(parsed(text))).toBe(text.indexOf("if ("));
  });

  it("answers undefined when the file has none", () => {
    expect(testStart(parsed("const a = 1;\n"))).toBe(undefined);
    expect(testStart(parsed("if (import.meta.hot) {\n}\n"))).toBe(undefined);
    expect(testStart(parsed(""))).toBe(undefined);
  });

  it("refuses a test block with an else branch, which runs outside Vitest", () => {
    expect(testStart(parsed("if (import.meta.vitest) {\n} else {\n  throw 1;\n}\n"))).toBe(undefined);
  });
}
