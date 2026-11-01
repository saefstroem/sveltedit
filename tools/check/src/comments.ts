import { getLeadingCommentRanges, getTrailingCommentRanges, type Node, type SourceFile } from "typescript";
import { found, type Finding } from "./finding";

export function comments(sf: SourceFile): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<number>();
  const take = (at: number): void => {
    const ranges = [...(getLeadingCommentRanges(sf.text, at) ?? []), ...(getTrailingCommentRanges(sf.text, at) ?? [])];
    for (const range of ranges) {
      if (seen.has(range.pos)) continue;
      seen.add(range.pos);
      out.push(found(sf, range.pos, "comment (Rule 9)"));
    }
  };
  const visit = (node: Node): void => {
    take(node.getFullStart());
    for (const child of node.getChildren(sf)) visit(child);
  };
  visit(sf);
  take(sf.endOfFileToken.getFullStart());
  take(sf.text.length);
  return out;
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;
  const { createSourceFile, ScriptTarget } = await import("typescript");
  const over = (text: string) => comments(createSourceFile("a.ts", text, ScriptTarget.Latest, true));

  it("finds line, block and doc comments wherever they hide", () => {
    const text = 'const a = 1; // tail\nconst b = call(/* inside */ 2);\n/** doc */\nconst c = "x";\n// end\n';
    expect(over(text).map((hit) => hit.line)).toEqual([1, 2, 3, 5]);
  });

  it("never mistakes strings, regexes, globs or shebangs for comments", () => {
    const clean = [
      "#!/usr/bin/env node",
      'const url = "https://a.b//c";',
      "const slashes = /a\\/\\/b/u;",
      "const half = 4 / 2 / 2;",
      "const tpl = `//${half}/* x */`;",
    ].join("\n");
    expect(over(clean)).toEqual([]);
  });

  it("flags comments inside a test block too", () => {
    expect(over("if (import.meta.vitest) {\n  // here\n}\n")).toHaveLength(1);
  });
}
