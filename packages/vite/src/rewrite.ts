import type { Result } from "./result";

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
  if (edit.html !== null) return { ok: true, value: source.slice(0, open) + edit.html + source.slice(close) };
  let from = start;
  let to = close + edit.tag.length + 3;
  const lineStart = source.lastIndexOf("\n", from - 1) + 1;
  if (source.slice(lineStart, from).trim() === "" && source[to] === "\n") {
    from = lineStart;
    to += 1;
  }
  return { ok: true, value: source.slice(0, from) + source.slice(to) };
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;
  const page = ["<script>", "  let a = 1;", "</script>", "", '<p class="x">', "  Old words", "</p>", ""].join("\n");
  const at = (line: number, column: number, tag = "p"): Edit => ({ line, column, tag, html: "New <b>words</b>" });
  const missing = (tag: string) => ({ ok: false, error: { kind: "vite.no-element", tag } });
  const templated = { ok: false, error: { kind: "vite.templated" } };

  it("replaces the content of the element at the recorded location with the new HTML", () => {
    expect(rewrite(page, at(5, 0))).toEqual({ ok: true, value: page.replace("\n  Old words\n", "New <b>words</b>") });
  });

  it("deletes the whole element, and its line when it stands alone on one", () => {
    const gone = { ...at(5, 0), html: null };
    expect(rewrite(page, gone)).toEqual({ ok: true, value: page.replace('<p class="x">\n  Old words\n</p>\n', "") });
    const inline = { ...at(1, 2, "span"), html: null };
    expect(rewrite("a <span>b</span> c\n", inline)).toEqual({ ok: true, value: "a  c\n" });
    expect(rewrite("<p>hi {name}</p>\n", { ...at(1, 0), html: null })).toEqual(templated);
  });

  it("accepts a column that is one past the angle bracket", () => {
    expect(rewrite(page, at(5, 1)).ok).toBe(true);
    expect(rewrite(page, at(5, 2))).toEqual(missing("p"));
  });

  it("refuses a location that holds another element, no element or no closing tag", () => {
    expect(rewrite("<br>\n<b>x</b>\n", at(1, 0, "b"))).toEqual(missing("b"));
    expect(rewrite(page, at(99, 0))).toEqual(missing("p"));
    expect(rewrite("<p>open forever", at(1, 0))).toEqual(missing("p"));
  });

  it("refuses content that holds template code, which the page shows only as its result", () => {
    expect(rewrite("<p>hi {name}</p>\n", at(1, 0))).toEqual(templated);
    expect(rewrite("<p>hi <Icon /></p>\n", at(1, 0))).toEqual(templated);
    expect(rewrite("<p>hi <svelte:element this={tag} /></p>\n", at(1, 0))).toEqual(templated);
    expect(rewrite("<p onclick={() => go()}>hi</p>\n", at(1, 0))).toEqual(templated);
  });
}
