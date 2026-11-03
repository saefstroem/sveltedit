import type { Result } from "./result.js";

export interface Edit {
  line: number;
  column: number;
  tag: string;
  html: string | null;
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
  if (edit.html !== null) {
    const fenced = edit.html.replaceAll("{", "&#123;").replaceAll("}", "&#125;");
    return { ok: true, value: source.slice(0, open) + fenced + source.slice(close) };
  }
  let from = start;
  let to = close + edit.tag.length + 3;
  const lineStart = source.lastIndexOf("\n", from - 1) + 1;
  if (source.slice(lineStart, from).trim() === "" && source[to] === "\n") {
    from = lineStart;
    to += 1;
  }
  return { ok: true, value: source.slice(0, from) + source.slice(to) };
}
