import {
  forEachChild,
  isAsExpression,
  isCallExpression,
  isConstTypeReference,
  isIdentifier,
  isNonNullExpression,
  isPropertyAccessExpression,
  isThrowStatement,
  type Node,
  type SourceFile,
} from "typescript";
import { found, type Finding } from "./finding";
import { testStart } from "./test-block";

export function bans(sf: SourceFile): Finding[] {
  const out: Finding[] = [];
  const limit = testStart(sf) ?? sf.end;
  const exiting = (node: Node): boolean =>
    isCallExpression(node) &&
    isPropertyAccessExpression(node.expression) &&
    isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "process" &&
    node.expression.name.text === "exit";
  const visit = (node: Node): void => {
    if (node.getStart(sf) >= limit) return;
    if (isThrowStatement(node)) out.push(found(sf, node.getStart(sf), "throw (Rule 8)"));
    if (isNonNullExpression(node)) out.push(found(sf, node.getStart(sf), "non-null assertion (Rule 8)"));
    if (isAsExpression(node) && !isConstTypeReference(node.type))
      out.push(found(sf, node.getStart(sf), "type assertion (Rule 8)"));
    if (exiting(node)) out.push(found(sf, node.getStart(sf), "process.exit (Rule 8)"));
    forEachChild(node, visit);
  };
  forEachChild(sf, visit);
  return out;
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;
  const { createSourceFile, ScriptTarget } = await import("typescript");
  const over = (text: string) =>
    bans(createSourceFile("a.ts", text, ScriptTarget.Latest, true)).map((hit) => hit.message);

  it("flags throw, !, as and process.exit in production code", () => {
    expect(over('throw new Error("x");\n')).toEqual(["throw (Rule 8)"]);
    expect(over("const a = b!;\n")).toEqual(["non-null assertion (Rule 8)"]);
    expect(over("const a = b as string;\n")).toEqual(["type assertion (Rule 8)"]);
    expect(over("process.exit(1);\n")).toEqual(["process.exit (Rule 8)"]);
  });

  it("allows as const everywhere and anything inside the test block", () => {
    expect(over('const a = "serve" as const;\n')).toEqual([]);
    expect(
      over('const a = 1;\nif (import.meta.vitest) {\n  const b = c as string;\n  throw new Error("x");\n}\n'),
    ).toEqual([]);
  });
}
