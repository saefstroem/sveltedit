import type { Result } from "./result";

export interface Edit {
  line: number;
  column: number;
  tag: string;
  html: string | null;
  original: string;
}

const phrasing = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "span",
  "a",
  "b",
  "i",
  "u",
  "em",
  "strong",
  "code",
  "small",
  "label",
  "dt",
]);
const block = /<(div|p|section|article|aside|ul|ol|li|h[1-6]|table|blockquote|pre|form|header|footer|nav|figure)\b/i;

export function rewrite(source: string, edit: Edit): Result<string> {
  const boundary = (at: number): boolean => [">", "/", " ", "\t", "\n", "\r"].includes(source[at] ?? "");
  const tagEnd = (from: number): { after: number; closed: boolean } | undefined => {
    let quote = "";
    for (let at = from; at < source.length; at += 1) {
      const char = source[at] ?? "";
      if (quote !== "") {
        if (char === quote) quote = "";
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === ">") {
        return { after: at + 1, closed: source[at - 1] === "/" };
      }
    }
    return undefined;
  };
  const offset = (): number | undefined => {
    let at = 0;
    for (let left = edit.line - 1; left > 0; left -= 1) {
      const next = source.indexOf("\n", at);
      if (next === -1) return undefined;
      at = next + 1;
    }
    const spot = at + edit.column;
    return spot <= source.length ? spot : undefined;
  };
  const contentEnd = (from: number): number | undefined => {
    let depth = 1;
    let at = from;
    while (at < source.length) {
      if (source.startsWith(`</${edit.tag}`, at) && boundary(at + 2 + edit.tag.length)) {
        depth -= 1;
        if (depth === 0) return at;
        at += 2 + edit.tag.length;
        continue;
      }
      if (source.startsWith(`<${edit.tag}`, at) && boundary(at + 1 + edit.tag.length)) {
        const inner = tagEnd(at);
        if (inner === undefined) return undefined;
        if (!inner.closed) depth += 1;
        at = inner.after;
        continue;
      }
      at += 1;
    }
    return undefined;
  };
  if (!/^[a-z][a-z0-9]*$/.test(edit.tag)) return { ok: false, error: { kind: "vite.bad-tag" } };
  const guess = offset();
  if (guess === undefined) return { ok: false, error: { kind: "vite.bad-location" } };
  const open = `<${edit.tag}`;
  const start = [guess, guess - 1].find(
    (spot) => spot >= 0 && source.startsWith(open, spot) && boundary(spot + open.length),
  );
  if (start === undefined) return { ok: false, error: { kind: "vite.no-element", tag: edit.tag } };
  const opened = tagEnd(start);
  if (opened === undefined || opened.closed) return { ok: false, error: { kind: "vite.no-content" } };
  const close = contentEnd(opened.after);
  if (close === undefined) return { ok: false, error: { kind: "vite.unclosed" } };
  const content = source.slice(opened.after, close);
  if (content.includes("{") || content.includes("}") || /<[A-Z]/.test(content) || content.includes("<svelte:"))
    return { ok: false, error: { kind: "vite.templated" } };
  const squash = (text: string): string => text.replaceAll(/[ \t\n\r\f]+/g, " ").replaceAll(/^ | $/g, "");
  const shown = squash(content.replaceAll(/<[^>]*>/g, ""))
    .split(/(&#?[a-z0-9]+;)/i)
    .map((part, index) => (index % 2 === 1 ? "[\\s\\S]{1,2}" : part.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("");
  if (!new RegExp(`^${shown}$`).test(squash(edit.original))) return { ok: false, error: { kind: "vite.stale" } };
  if (edit.html === null) {
    const closer = tagEnd(close);
    if (closer === undefined) return { ok: false, error: { kind: "vite.unclosed" } };
    let from = start;
    let to = closer.after;
    const lineStart = source.lastIndexOf("\n", start - 1) + 1;
    if (source.slice(lineStart, start).trim() === "" && source[to] === "\n") {
      from = lineStart;
      to += 1;
    }
    return { ok: true, value: source.slice(0, from) + source.slice(to) };
  }
  let html = edit.html;
  if (phrasing.has(edit.tag)) {
    html = html
      .replaceAll(/<div[^>]*><br\s*\/?><\/div>/gi, "<br>")
      .replaceAll(/<\/div>/gi, "")
      .replaceAll(/<div[^>]*>/gi, "<br>")
      .replace(/^<br>/, "");
    if (block.test(html)) return { ok: false, error: { kind: "vite.block-content" } };
  }
  const fenced = html.replaceAll("{", "&#123;").replaceAll("}", "&#125;");
  return { ok: true, value: source.slice(0, opened.after) + fenced + source.slice(close) };
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;
  const page = ["<script>", "  let a = 1;", "</script>", "", '<p class="x">', "  Old words", "</p>", ""].join("\n");
  const at = (tag: string, line: number, column: number, html = "New <b>words</b>"): Edit => ({
    line,
    column,
    tag,
    html,
    original: "Old words",
  });

  it("replaces the content span of the element at the recorded location", () => {
    const out = rewrite(page, at("p", 5, 0));
    expect(out).toEqual({ ok: true, value: page.replace("\n  Old words\n", "New <b>words</b>") });
  });

  it("accepts a column that is one past the angle bracket", () => {
    expect(rewrite(page, at("p", 5, 1)).ok).toBe(true);
    expect(rewrite(page, at("p", 5, 2)).ok).toBe(false);
  });

  it("handles nesting of the same tag, quoted brackets and self-closing tags", () => {
    const nested = '<span data-x="a>b">one <span>two</span> <span/> three</span>\n';
    const out = rewrite(nested, { line: 1, column: 0, tag: "span", html: "flat", original: "one two three" });
    expect(out).toEqual({ ok: true, value: '<span data-x="a>b">flat</span>\n' });
  });

  it("deletes the whole element, its indentation and its line when html is null, but never template code", () => {
    const gone = rewrite(page, { line: 5, column: 0, tag: "p", html: null, original: "Old words" });
    expect(gone).toEqual({ ok: true, value: page.replace('<p class="x">\n  Old words\n</p>\n', "") });
    const inline = rewrite("a <span>b</span> c\n", { line: 1, column: 2, tag: "span", html: null, original: "b" });
    expect(inline).toEqual({ ok: true, value: "a  c\n" });
    const templated = rewrite("<p>hi {name}</p>\n", { line: 1, column: 0, tag: "p", html: null, original: "hi Ada" });
    expect(templated).toEqual({ ok: false, error: { kind: "vite.templated" } });
  });

  it("flattens contenteditable line divs into breaks inside phrasing elements", () => {
    const typed = "First line<div><br></div><div>Third <b>bold</b> line</div>";
    const out = rewrite("<p>old</p>\n", { line: 1, column: 0, tag: "p", html: typed, original: "old" });
    expect(out).toEqual({ ok: true, value: "<p>First line<br><br>Third <b>bold</b> line</p>\n" });
    const led = rewrite("<p>old</p>\n", {
      line: 1,
      column: 0,
      tag: "p",
      html: "<div>Only line</div>",
      original: "old",
    });
    expect(led).toEqual({ ok: true, value: "<p>Only line</p>\n" });
  });

  it("refuses block elements pasted into a phrasing element and allows them in flow elements", () => {
    const pasted = rewrite("<p>old</p>\n", {
      line: 1,
      column: 0,
      tag: "p",
      html: "a<ul><li>b</li></ul>",
      original: "old",
    });
    expect(pasted).toEqual({ ok: false, error: { kind: "vite.block-content" } });
    const listed = rewrite("<li>old</li>\n", {
      line: 1,
      column: 0,
      tag: "li",
      html: "a<div>b</div>",
      original: "old",
    });
    expect(listed).toEqual({ ok: true, value: "<li>a<div>b</div></li>\n" });
  });

  it("escapes braces in the new content so Svelte never sees an expression", () => {
    const out = rewrite("<p>a</p>\n", { line: 1, column: 0, tag: "p", html: "take {this}", original: "a" });
    expect(out).toEqual({ ok: true, value: "<p>take &#123;this&#125;</p>\n" });
  });

  it("refuses templated content, components and svelte elements", () => {
    expect(rewrite("<p>hi {name}</p>\n", at("p", 1, 0))).toEqual({ ok: false, error: { kind: "vite.templated" } });
    expect(rewrite("<p>hi <Icon /></p>\n", at("p", 1, 0))).toEqual({ ok: false, error: { kind: "vite.templated" } });
    expect(rewrite("<p>hi <svelte:element this={x} /></p>\n", at("p", 1, 0)).ok).toBe(false);
  });

  it("refuses bad tags, bad locations, missing elements and unclosed elements", () => {
    expect(rewrite(page, at("p[", 5, 0))).toEqual({ ok: false, error: { kind: "vite.bad-tag" } });
    expect(rewrite(page, at("p", 99, 0))).toEqual({ ok: false, error: { kind: "vite.bad-location" } });
    expect(rewrite(page, at("h1", 5, 0))).toEqual({ ok: false, error: { kind: "vite.no-element", tag: "h1" } });
    expect(rewrite("<img src='x'/>\n", { line: 1, column: 0, tag: "img", html: "x", original: "" })).toEqual({
      ok: false,
      error: { kind: "vite.no-content" },
    });
    expect(rewrite("<p>open forever", at("p", 1, 0))).toEqual({ ok: false, error: { kind: "vite.unclosed" } });
    const path = rewrite("<path d='M0 0'/><p>x</p>", { line: 1, column: 0, tag: "p", html: "y", original: "x" });
    expect(path.ok).toBe(false);
  });

  it("refuses a location whose element no longer holds the text the user started from", () => {
    const pair = "<p>First</p>\n<p>Second</p>\n";
    const stale = { ok: false, error: { kind: "vite.stale" } };
    expect(rewrite(pair, { line: 2, column: 0, tag: "p", html: "new", original: "First" })).toEqual(stale);
    expect(rewrite(pair, { line: 2, column: 0, tag: "p", html: null, original: "First" })).toEqual(stale);
    expect(rewrite(pair, { line: 2, column: 0, tag: "p", html: "new", original: "Second" }).ok).toBe(true);
  });

  it("matches the page text across entities, tags, line breaks and indentation", () => {
    const source = "<p>\n\t\tIt&rsquo;s a&nbsp;test\n\t\t<b>now</b> &#123;ok&#125;<br>\n\t</p>\n";
    const shown = "It’s a test now {ok}";
    const kept = rewrite(source, { line: 1, column: 0, tag: "p", html: "fresh", original: shown });
    expect(kept).toEqual({ ok: true, value: "<p>fresh</p>\n" });
    const wrong = rewrite(source, { line: 1, column: 0, tag: "p", html: "fresh", original: "It is a test now" });
    expect(wrong.ok).toBe(false);
  });

  it("keeps a leading or trailing non-breaking space, which the page keeps too", () => {
    const edged = "<p>\n\t&nbsp;Starts and ends here.&nbsp;\n</p>\n";
    const kept = rewrite(edged, { line: 1, column: 0, tag: "p", html: "x", original: " Starts and ends here. " });
    expect(kept.ok).toBe(true);
  });
}
