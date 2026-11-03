import type { Result } from "./result.js";

export interface Edit {
  line: number;
  column: number;
  tag: string;
  html: string | null;
  more: string[];
}

export function rewrite(source: string, edit: Edit): Result<string> {
  const missing: Result<string> = { ok: false, error: { kind: "vite.no-element", tag: edit.tag } };
  const at = source
    .split("\n")
    .slice(0, edit.line - 1)
    .reduce((sum, line) => sum + line.length + 1, edit.column);
  const start = [at, at - 1].find(
    (spot) => source.startsWith(`<${edit.tag}`, spot) && /[\s/>]/.test(source.charAt(spot + edit.tag.length + 1)),
  );
  if (start === undefined) return missing;
  const open = source.indexOf(">", start) + 1;
  const close = source.indexOf(`</${edit.tag}>`, open);
  if (open === 0 || close === -1) return missing;
  if (/[{}]|<[A-Z]|<svelte:/.test(source.slice(open, close))) return { ok: false, error: { kind: "vite.templated" } };
  const fenced = (part: string) => part.replaceAll("{", "&#123;").replaceAll("}", "&#125;");
  let from = start;
  let to = close + edit.tag.length + 3;
  const lineStart = source.lastIndexOf("\n", from - 1) + 1;
  const alone = source.slice(lineStart, from).trim() === "";
  if (edit.html !== null && edit.more.length === 0)
    return { ok: true, value: source.slice(0, open) + fenced(edit.html) + source.slice(close) };
  if (edit.html !== null) {
    const indent = alone ? source.slice(lineStart, from) : "";
    const opening = source.slice(start, open);
    const blocks = [edit.html, ...edit.more].map(
      (part, index) => (index === 0 ? opening : opening.replace(/\s+id="[^"]*"/, "")) + fenced(part) + `</${edit.tag}>`,
    );
    return { ok: true, value: source.slice(0, from) + blocks.join("\n" + indent) + source.slice(to) };
  }
  if (alone && source[to] === "\n") {
    from = lineStart;
    to += 1;
  }
  return { ok: true, value: source.slice(0, from) + source.slice(to) };
}
