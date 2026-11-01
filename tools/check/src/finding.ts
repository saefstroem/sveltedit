import type { SourceFile } from "typescript";

export interface Finding {
  path: string;
  line: number;
  message: string;
}

export function flat(path: string, line: number, message: string): Finding {
  return { path, line, message };
}

export function found(sf: SourceFile, at: number, message: string): Finding {
  return flat(sf.fileName, sf.getLineAndCharacterOfPosition(at).line + 1, message);
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;
  const { createSourceFile, ScriptTarget } = await import("typescript");

  it("reports one-based lines", () => {
    const sf = createSourceFile("a.ts", "const a = 1;\nconst b = 2;\n", ScriptTarget.Latest, true);
    expect(found(sf, sf.text.indexOf("b"), "x")).toEqual({ path: "a.ts", line: 2, message: "x" });
    expect(flat("d", 1, "y")).toEqual({ path: "d", line: 1, message: "y" });
  });
}
