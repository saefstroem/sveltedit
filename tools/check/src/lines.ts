import type { SourceFile } from "typescript";
import { flat, type Finding } from "./finding";
import { testStart } from "./test-block";

const most = 300;

export function lines(sf: SourceFile): Finding[] {
  const limit = testStart(sf);
  const body = limit === undefined ? sf.text : sf.text.slice(0, limit);
  const full = body.split("\n").filter((line) => line.trim() !== "").length;
  if (full <= most) return [];
  return [
    flat(
      sf.fileName,
      1,
      `${String(full)} non-blank lines outside the test block, the most is ${String(most)} (Rule 6)`,
    ),
  ];
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;
  const { createSourceFile, ScriptTarget } = await import("typescript");
  const over = (text: string) => lines(createSourceFile("a.ts", text, ScriptTarget.Latest, true));

  it("counts only non-blank lines outside the test block", () => {
    const body = [...Array(300).keys()].map((at) => `const a${String(at)} = ${String(at)};`).join("\n\n");
    expect(over(body)).toEqual([]);
    expect(over(`${body}\nconst more = 1;`)).toHaveLength(1);
    const padded = `${body}\nif (import.meta.vitest) {\n${"  const t = 1;\n".repeat(50)}}\n`;
    expect(over(padded)).toEqual([]);
  });
}
