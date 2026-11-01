import {
  forEachChild,
  isCallExpression,
  isExportDeclaration,
  isIdentifier,
  isImportDeclaration,
  isImportTypeNode,
  isNamespaceImport,
  isStringLiteral,
  SyntaxKind,
  type Node,
  type SourceFile,
} from "typescript";
import { found, type Finding } from "./finding";
import { testStart } from "./test-block";

export function imports(sf: SourceFile): Finding[] {
  const faulted = (specifier: string): string | undefined => {
    if (!specifier.startsWith(".")) return undefined;
    const parts = specifier.split("/");
    let lead = 0;
    while (lead < parts.length && (parts[lead] === "." || parts[lead] === "..")) lead += 1;
    const rest = parts.slice(lead);
    if (rest.length === 0 || rest[0] === "index" || rest[0] === "index.ts")
      return "import of an own or ancestor index.ts (Rule 5)";
    if (rest.length > 1) return "import into another module's internals (Rule 5)";
    return undefined;
  };
  const out: Finding[] = [];
  const limit = testStart(sf) ?? sf.end;
  const visit = (node: Node): void => {
    if (node.getStart(sf) >= limit) return;
    if ((isImportDeclaration(node) || isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
      if (isStringLiteral(node.moduleSpecifier)) {
        const fault = faulted(node.moduleSpecifier.text);
        if (fault !== undefined) out.push(found(sf, node.getStart(sf), fault));
      }
      if (isExportDeclaration(node) && node.exportClause === undefined)
        out.push(found(sf, node.getStart(sf), "glob re-export (Rule 5)"));
    }
    if (isImportDeclaration(node) && node.importClause?.namedBindings !== undefined) {
      if (isNamespaceImport(node.importClause.namedBindings))
        out.push(found(sf, node.getStart(sf), "glob import (Rule 5)"));
    }
    if (isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword)
      out.push(found(sf, node.getStart(sf), "dynamic import outside the test block (Rule 5)"));
    if (isCallExpression(node) && isIdentifier(node.expression) && node.expression.text === "require")
      out.push(found(sf, node.getStart(sf), "require outside the test block (Rule 5)"));
    if (isImportTypeNode(node)) out.push(found(sf, node.getStart(sf), "import() type at a use site (Rule 5)"));
    forEachChild(node, visit);
  };
  forEachChild(sf, visit);
  return out;
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;
  const { createSourceFile, ScriptTarget } = await import("typescript");
  const over = (text: string) =>
    imports(createSourceFile("a.ts", text, ScriptTarget.Latest, true)).map((hit) => hit.message);

  it("lets siblings, child modules and ancestor modules through", () => {
    expect(over('import { a } from "./frame";\nimport { b } from "../config";\nimport { c } from "svelte";\n')).toEqual(
      [],
    );
  });

  it("flags deep, index and glob imports", () => {
    expect(over('import { a } from "../config/load";\n')).toEqual(["import into another module's internals (Rule 5)"]);
    expect(over('import { a } from "./index";\nimport { b } from "..";\n')).toEqual([
      "import of an own or ancestor index.ts (Rule 5)",
      "import of an own or ancestor index.ts (Rule 5)",
    ]);
    expect(over('import * as all from "./frame";\n')).toEqual(["glob import (Rule 5)"]);
    expect(over('export * from "./frame";\n')).toEqual(["glob re-export (Rule 5)"]);
  });

  it("flags dynamic loading outside the test block and allows it inside", () => {
    expect(over('const a = import("./frame");\n')).toEqual(["dynamic import outside the test block (Rule 5)"]);
    expect(over('const a = require("./frame");\n')).toEqual(["require outside the test block (Rule 5)"]);
    expect(over('type A = import("./frame").A;\n')).toEqual(["import() type at a use site (Rule 5)"]);
    expect(over('const a = 1;\nif (import.meta.vitest) {\n  const b = import("./frame");\n}\n')).toEqual([]);
  });
}
