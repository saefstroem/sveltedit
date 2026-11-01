import { parse, type AST } from "svelte/compiler";
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
const block =
  /<(div|p|section|article|aside|ul|ol|li|h[1-6]|table|blockquote|pre|form|header|footer|nav|figure)(?=[\s/>])/i;

export function rewrite(file: string, edit: Edit): Result<string> {
  const source = file.replace(/^\uFEFF/, "");
  const bom = file.slice(0, file.length - source.length);
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
  const fragment = (value: unknown): value is AST.Fragment =>
    typeof value === "object" && value !== null && "type" in value && value.type === "Fragment";
  function found(nodes: AST.Fragment["nodes"], at: number): AST.RegularElement | undefined {
    for (const node of nodes) {
      if (node.type === "RegularElement" && node.name === edit.tag && (node.start === at || node.start === at - 1))
        return node;
      for (const child of Object.values(node).filter(fragment)) {
        const hit = found(child.nodes, at);
        if (hit !== undefined) return hit;
      }
    }
    return undefined;
  }
  function shown(nodes: AST.Fragment["nodes"]): Result<string> {
    let text = "";
    for (const node of nodes) {
      if (node.type === "Comment") return { ok: false, error: { kind: "vite.commented" } };
      if (node.type === "Text") {
        text += node.data;
        continue;
      }
      const plain =
        node.type === "RegularElement" &&
        node.attributes.every(
          (attribute) =>
            attribute.type === "Attribute" &&
            (attribute.value === true ||
              (Array.isArray(attribute.value) && attribute.value.every((part) => part.type === "Text"))),
        );
      if (!plain) return { ok: false, error: { kind: "vite.templated" } };
      const inner = shown(node.fragment.nodes);
      if (!inner.ok) return inner;
      text += inner.value;
    }
    return { ok: true, value: text };
  }
  const at = offset();
  if (at === undefined) return { ok: false, error: { kind: "vite.bad-location" } };
  let root: AST.Root;
  try {
    const markup = source.replaceAll(
      /<!--[\s\S]*?-->|(<(script|style)\b(?:[^>"']|"[^"]*"|'[^']*')*>)([\s\S]*?)(<\/\2\s*>)/gi,
      (whole: string, open: string | undefined, _tag: string, body: string, close: string) =>
        open === undefined ? whole : open + body.replaceAll(/[^\n]/g, " ") + close,
    );
    root = parse(markup, { modern: true });
  } catch (cause) {
    return { ok: false, error: { kind: "vite.unparsable", cause } };
  }
  const element = found(root.fragment.nodes, at);
  if (element === undefined) return { ok: false, error: { kind: "vite.no-element", tag: edit.tag } };
  const first = element.fragment.nodes[0];
  const last = element.fragment.nodes.at(-1);
  if (first === undefined || last === undefined) return { ok: false, error: { kind: "vite.no-content" } };
  const content = shown(element.fragment.nodes);
  if (!content.ok) return content;
  const squash = (text: string): string => text.replaceAll(/[ \t\n\r\f]+/g, " ").replaceAll(/^ | $/g, "");
  if (squash(content.value) !== squash(edit.original)) return { ok: false, error: { kind: "vite.stale" } };
  if (edit.html === null) {
    let from = element.start;
    let to = element.end;
    const lineStart = source.lastIndexOf("\n", from - 1) + 1;
    if (source.slice(lineStart, from).trim() === "" && source[to] === "\n") {
      from = lineStart;
      to += 1;
    }
    return { ok: true, value: bom + source.slice(0, from) + source.slice(to) };
  }
  let html = edit.html;
  if (phrasing.has(edit.tag)) {
    html = html
      .replaceAll(/<div(?=[\s/>])[^>]*><br\s*\/?><\/div>/gi, "<br>")
      .replaceAll(/<\/div>/gi, "")
      .replaceAll(/<div(?=[\s/>])[^>]*>/gi, "<br>")
      .replace(/^<br>/, "");
    if (block.test(html)) return { ok: false, error: { kind: "vite.block-content" } };
  }
  const scoped = source.slice(first.start, last.end);
  const fenced = html
    .replaceAll(/ class="([^"]*)"/g, (_class: string, names: string) => {
      const kept = names.split(" ").filter((name) => scoped.includes(name) || !/^(s|svelte)-\w+$/.test(name));
      return kept.length === 0 ? "" : ` class="${kept.join(" ")}"`;
    })
    .replaceAll("{", "&#123;")
    .replaceAll("}", "&#125;");
  return { ok: true, value: bom + source.slice(0, first.start) + fenced + source.slice(last.end) };
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;
  const page = ["<script>", "  let a = 1;", "</script>", "", '<p class="x">', "  Old words", "</p>", ""].join("\n");
  const stale = { ok: false, error: { kind: "vite.stale" } };
  const templated = { ok: false, error: { kind: "vite.templated" } };
  const at = (tag: string, line: number, column: number, html = "New <b>words</b>"): Edit => ({
    line,
    column,
    tag,
    html,
    original: "Old words",
  });
  const first = (source: string, original: string, html: string | null = "new"): Result<string> =>
    rewrite(source, { line: 1, column: 0, tag: "p", html, original });

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

  it("finds elements inside blocks and components", () => {
    const nested = "{#if shown}\n  <Card>\n    <p>old</p>\n  </Card>\n{/if}\n";
    const out = rewrite(nested, { line: 3, column: 4, tag: "p", html: "new", original: "old" });
    expect(out).toEqual({ ok: true, value: nested.replace("old", "new") });
  });

  it("deletes the whole element, its indentation and its line when html is null, but never template code", () => {
    const gone = rewrite(page, { line: 5, column: 0, tag: "p", html: null, original: "Old words" });
    expect(gone).toEqual({ ok: true, value: page.replace('<p class="x">\n  Old words\n</p>\n', "") });
    const inline = rewrite("a <span>b</span> c\n", { line: 1, column: 2, tag: "span", html: null, original: "b" });
    expect(inline).toEqual({ ok: true, value: "a  c\n" });
    expect(first("<p>hi {name}</p>\n", "hi Ada", null)).toEqual(templated);
  });

  it("flattens contenteditable line divs into breaks inside phrasing elements", () => {
    const typed = "First line<div><br></div><div>Third <b>bold</b> line</div>";
    expect(first("<p>old</p>\n", "old", typed)).toEqual({
      ok: true,
      value: "<p>First line<br><br>Third <b>bold</b> line</p>\n",
    });
    expect(first("<p>old</p>\n", "old", "<div>Only line</div>")).toEqual({ ok: true, value: "<p>Only line</p>\n" });
  });

  it("refuses block elements pasted into a phrasing element and allows them in flow elements", () => {
    const pasted = first("<p>old</p>\n", "old", "a<ul><li>b</li></ul>");
    expect(pasted).toEqual({ ok: false, error: { kind: "vite.block-content" } });
    const listed = rewrite("<li>old</li>\n", { line: 1, column: 0, tag: "li", html: "a<div>b</div>", original: "old" });
    expect(listed).toEqual({ ok: true, value: "<li>a<div>b</div></li>\n" });
  });

  it("drops the scoping classes Svelte adds in dev, but keeps class names the source holds", () => {
    const html = 'new <b class="note s-keep s-JRowtg58WOIO">x</b> <i class="svelte-1abc">y</i>';
    expect(first('<p>old <b class="note s-keep">x</b></p>\n', "old x", html)).toEqual({
      ok: true,
      value: '<p>new <b class="note s-keep">x</b> <i>y</i></p>\n',
    });
  });

  it("escapes braces in the new content so Svelte never sees an expression", () => {
    expect(first("<p>a</p>\n", "a", "take {this}")).toEqual({ ok: true, value: "<p>take &#123;this&#125;</p>\n" });
  });

  it("refuses templated content, components, svelte elements and directives", () => {
    expect(rewrite("<p>hi {name}</p>\n", at("p", 1, 0))).toEqual(templated);
    expect(rewrite("<p>hi <Icon /></p>\n", at("p", 1, 0))).toEqual(templated);
    expect(rewrite("<p>hi <svelte:element this={x} /></p>\n", at("p", 1, 0))).toEqual(templated);
    expect(first("<p>Hello <input bind:value /></p>\n", "Hello", "Hello <input>")).toEqual(templated);
    expect(first("<p>a <b class:on use:act>b</b></p>\n", "a b", null)).toEqual(templated);
  });

  it("refuses bad locations, missing elements, empty elements and source that does not parse", () => {
    expect(rewrite(page, at("p", 99, 0))).toEqual({ ok: false, error: { kind: "vite.bad-location" } });
    expect(rewrite(page, at("h1", 5, 0))).toEqual({ ok: false, error: { kind: "vite.no-element", tag: "h1" } });
    expect(rewrite("<img src='x'/>\n", { line: 1, column: 0, tag: "img", html: "x", original: "" })).toEqual({
      ok: false,
      error: { kind: "vite.no-content" },
    });
    const open = rewrite("<p>open forever", at("p", 1, 0));
    expect(!open.ok && open.error.kind).toBe("vite.unparsable");
    expect(first("<path d='M0 0'/><p>x</p>", "x").ok).toBe(false);
  });

  it("refuses a location whose element no longer holds the text the user started from", () => {
    const pair = "<p>First</p>\n<p>Second</p>\n";
    expect(rewrite(pair, { line: 2, column: 0, tag: "p", html: "new", original: "First" })).toEqual(stale);
    expect(rewrite(pair, { line: 2, column: 0, tag: "p", html: null, original: "First" })).toEqual(stale);
    expect(rewrite(pair, { line: 2, column: 0, tag: "p", html: "new", original: "Second" }).ok).toBe(true);
  });

  it("matches the page text across entities, tags, quoted brackets, line breaks and indentation", () => {
    const source = "<p>\n\t\tIt&rsquo;s a&nbsp;test\n\t\t<b>now</b> &#123;ok&#125;<br>\n\t</p>\n";
    expect(first(source, "It’s a\u00a0test now {ok}", "fresh")).toEqual({ ok: true, value: "<p>fresh</p>\n" });
    expect(first(source, "It is a test now", "fresh")).toEqual(stale);
    expect(first('<p>Hi <span title="a>b">there</span></p>\n', "Hi there").ok).toBe(true);
  });

  it("compares the text Svelte decodes, so no entity stands for another character", () => {
    expect(first("<p>&amp;</p>\n", "&").ok).toBe(true);
    expect(first("<p>&amp;</p>\n", "X")).toEqual(stale);
    expect(first("<p>&#65;&#x42;&#X43;</p>\n", "ABC").ok).toBe(true);
    expect(first("<p>&#65;&#x42;&#X43;</p>\n", "ABD")).toEqual(stale);
    expect(first("<p>&alpha; &bogus;</p>\n", "α &bogus;").ok).toBe(true);
    expect(first("<p>&alpha; &bogus;</p>\n", "β &bogus;")).toEqual(stale);
  });

  it("refuses content that holds a comment, so a closing tag inside it is never taken", () => {
    expect(first("<p>old <!-- </p> --></p>\n", "old")).toEqual({ ok: false, error: { kind: "vite.commented" } });
  });

  it("leaves the opening tag alone, arrow functions and all", () => {
    const clicked = "<p onclick={() => go(`>`, 1 > 0)}>old</p>\n";
    expect(first(clicked, "old")).toEqual({ ok: true, value: "<p onclick={() => go(`>`, 1 > 0)}>new</p>\n" });
  });

  it("parses past styles that only a preprocessor understands", () => {
    const styled = '<p>old</p>\n<style lang="scss">\n$gap: 4px;\n.a { .b { margin: $gap; } }\n</style>\n';
    expect(first(styled, "old")).toEqual({ ok: true, value: styled.replace("old", "new") });
  });

  it("finds style blocks past style text in scripts, comments and generics", () => {
    const tricky = [
      '<script lang="ts" generics="T extends Record<string, unknown>">',
      '  const example = "<style>";',
      "</script>",
      "<!-- <style> -->",
      "<p>old</p>",
      '<style lang="scss">',
      "$gap: 4px;",
      "</style>",
      "",
    ].join("\n");
    const out = rewrite(tricky, { line: 5, column: 0, tag: "p", html: "new", original: "old" });
    expect(out).toEqual({ ok: true, value: tricky.replace("<p>old", "<p>new") });
  });

  it("flattens only real div wrappers, so custom elements whose names start with div survive", () => {
    const icon = "old <div-icon>icon</div-icon>";
    expect(first("<p>old</p>\n", "old", icon)).toEqual({ ok: true, value: `<p>${icon}</p>\n` });
  });

  it("keeps a byte order mark and the offsets after it", () => {
    expect(first("\uFEFF<p>old</p>\n", "old")).toEqual({ ok: true, value: "\uFEFF<p>new</p>\n" });
  });

  it("keeps a leading or trailing non-breaking space, which the page keeps too", () => {
    expect(first("<p>\n\t&nbsp;Starts and ends here.&nbsp;\n</p>\n", "\u00a0Starts and ends here.\u00a0").ok).toBe(
      true,
    );
  });
}
