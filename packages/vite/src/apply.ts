import type { Error } from "./error";
import type { Result } from "./result";
import { rewrite, type Edit } from "./rewrite";

export interface Io {
  resolve(base: string, file: string): string;
  real(path: string): Result<string>;
  read(file: string): Result<string>;
  write(file: string, source: string): Result<undefined>;
}

export type HeaderMap = Record<string, string | string[] | undefined>;

export interface Reply {
  status: number;
  body: string;
}

const codes: Record<Error["kind"], number> = {
  "vite.bad-request": 400,
  "vite.cross-site": 403,
  "vite.outside-project": 403,
  "vite.missing-file": 404,
  "vite.too-large": 413,
  "vite.not-json": 415,
  "vite.unwritable": 500,
  "vite.bad-tag": 409,
  "vite.bad-location": 409,
  "vite.no-element": 409,
  "vite.no-content": 409,
  "vite.unclosed": 409,
  "vite.commented": 409,
  "vite.templated": 409,
  "vite.stale": 409,
  "vite.block-content": 409,
};

export function refusal(error: Error): Reply {
  return { status: codes[error.kind], body: JSON.stringify({ kind: error.kind }) };
}

export function apply(claim: unknown, headers: HeaderMap, root: string, io: Io): Reply {
  const header = (name: string): string => {
    const value = headers[name];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
  const shaped = (): (Edit & { file: string }) | undefined => {
    if (typeof claim !== "object" || claim === null) return undefined;
    if (!("file" in claim) || !("line" in claim) || !("column" in claim) || !("tag" in claim) || !("html" in claim))
      return undefined;
    if (!("original" in claim)) return undefined;
    const { file, line, column, tag, html, original } = claim;
    if (typeof file !== "string" || typeof line !== "number" || typeof column !== "number") return undefined;
    if (typeof tag !== "string" || (typeof html !== "string" && html !== null)) return undefined;
    if (typeof original !== "string") return undefined;
    return { file, line, column, tag, html, original };
  };
  if (!header("content-type").toLowerCase().startsWith("application/json")) return refusal({ kind: "vite.not-json" });
  const site = header("sec-fetch-site");
  const origin = header("origin");
  const host = header("host");
  if (site !== "" && site !== "same-origin") return refusal({ kind: "vite.cross-site" });
  if (origin !== "" && origin !== `http://${host}` && origin !== `https://${host}`)
    return refusal({ kind: "vite.cross-site" });
  const edit = shaped();
  if (edit === undefined) return refusal({ kind: "vite.bad-request" });
  const outside = refusal({ kind: "vite.outside-project", file: edit.file });
  const lexical = io.resolve(root, edit.file);
  if (!lexical.startsWith(root) || !lexical.endsWith(".svelte")) return outside;
  const real = io.real(lexical);
  if (!real.ok) return refusal(real.error);
  const full = real.value;
  if (!full.startsWith(root) || !full.endsWith(".svelte") || /(^|[\\/])node_modules[\\/]/.test(full.slice(root.length)))
    return outside;
  const source = io.read(full);
  if (!source.ok) return refusal(source.error);
  const written = rewrite(source.value, edit);
  if (!written.ok) return refusal(written.error);
  const stored = io.write(full, written.value);
  if (!stored.ok) return refusal(stored.error);
  return { status: 200, body: JSON.stringify({ saved: edit.file }) };
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;
  const { posix } = await import("node:path");
  const held = new Map([["/app/src/page.svelte", "<p>old</p>\n"]]);
  const links = new Map([["/app/src/link.svelte", "/elsewhere/page.svelte"]]);
  const io: Io = {
    resolve: (base, file) => posix.resolve(base, file),
    real: (path) => {
      const target = links.get(path) ?? (held.has(path) ? path : undefined);
      return target === undefined
        ? { ok: false, error: { kind: "vite.missing-file", cause: "absent" } }
        : { ok: true, value: target };
    },
    read: (file) => {
      const source = held.get(file);
      return source === undefined
        ? { ok: false, error: { kind: "vite.missing-file", cause: "absent" } }
        : { ok: true, value: source };
    },
    write: (file, source) => {
      held.set(file, source);
      return { ok: true, value: undefined };
    },
  };
  const trusted: HeaderMap = {
    "content-type": "application/json",
    "sec-fetch-site": "same-origin",
    origin: "http://localhost:5173",
    host: "localhost:5173",
  };
  const claim = { file: "/app/src/page.svelte", line: 1, column: 0, tag: "p", html: "new", original: "old" };

  it("rewrites the file and answers 200 with the saved path", () => {
    expect(apply(claim, trusted, "/app/", io)).toEqual({ status: 200, body: '{"saved":"/app/src/page.svelte"}' });
    expect(held.get("/app/src/page.svelte")).toBe("<p>new</p>\n");
    held.set("/app/src/page.svelte", "<p>old</p>\n");
  });

  it("refuses requests that are not JSON or that come from another site", () => {
    const plain = apply(claim, { ...trusted, "content-type": "text/plain" }, "/app/", io);
    expect(plain).toEqual({ status: 415, body: '{"kind":"vite.not-json"}' });
    expect(apply(claim, { ...trusted, "sec-fetch-site": "cross-site" }, "/app/", io).status).toBe(403);
    expect(apply(claim, { ...trusted, origin: "https://evil.example" }, "/app/", io).status).toBe(403);
    expect(apply(claim, { ...trusted, origin: "null" }, "/app/", io).status).toBe(403);
    expect(held.get("/app/src/page.svelte")).toBe("<p>old</p>\n");
  });

  it("accepts a request without browser headers, as a local tool sends it", () => {
    expect(apply(claim, { "content-type": "application/json; charset=utf-8" }, "/app/", io).status).toBe(200);
    held.set("/app/src/page.svelte", "<p>old</p>\n");
  });

  it("answers 400 for a claim that is not an edit", () => {
    expect(apply(undefined, trusted, "/app/", io).status).toBe(400);
    expect(apply({ file: 1 }, trusted, "/app/", io).status).toBe(400);
    expect(apply({ ...claim, line: "5" }, trusted, "/app/", io).status).toBe(400);
  });

  it("confines writes to .svelte files inside the project root", () => {
    expect(apply({ ...claim, file: "/etc/passwd" }, trusted, "/app/", io).status).toBe(403);
    expect(apply({ ...claim, file: "/app/src/page.ts" }, trusted, "/app/", io).status).toBe(403);
    expect(apply({ ...claim, file: "../outside.svelte" }, trusted, "/app/", io).status).toBe(403);
  });

  it("follows symlinks before the root check and refuses anything under node_modules", () => {
    held.set("/elsewhere/page.svelte", "<p>old</p>\n");
    held.set("/app/node_modules/kit/page.svelte", "<p>old</p>\n");
    expect(apply({ ...claim, file: "/app/src/link.svelte" }, trusted, "/app/", io).status).toBe(403);
    expect(apply({ ...claim, file: "/app/node_modules/kit/page.svelte" }, trusted, "/app/", io).status).toBe(403);
    expect(held.get("/elsewhere/page.svelte")).toBe("<p>old</p>\n");
    expect(held.get("/app/node_modules/kit/page.svelte")).toBe("<p>old</p>\n");
  });

  it("deletes the element when html is null", () => {
    expect(apply({ ...claim, html: null }, trusted, "/app/", io).status).toBe(200);
    expect(held.get("/app/src/page.svelte")).toBe("");
    held.set("/app/src/page.svelte", "<p>old</p>\n");
  });

  it("maps missing files to 404 and rewrite refusals to 409", () => {
    expect(apply({ ...claim, file: "/app/src/gone.svelte" }, trusted, "/app/", io).status).toBe(404);
    expect(apply({ ...claim, tag: "h1" }, trusted, "/app/", io).status).toBe(409);
    expect(apply({ ...claim, tag: "h1" }, trusted, "/app/", io).body).toBe('{"kind":"vite.no-element"}');
  });

  it("maps a failed write to 500", () => {
    const sealed: Io = { ...io, write: () => ({ ok: false, error: { kind: "vite.unwritable", cause: "disk" } }) };
    expect(apply(claim, trusted, "/app/", sealed).status).toBe(500);
  });

  it("answers 400 without the original text and 409 when the source no longer holds it", () => {
    const { file, line, column, tag, html } = claim;
    expect(apply({ file, line, column, tag, html }, trusted, "/app/", io).status).toBe(400);
    expect(apply({ ...claim, original: "other words" }, trusted, "/app/", io)).toEqual({
      status: 409,
      body: '{"kind":"vite.stale"}',
    });
    expect(held.get("/app/src/page.svelte")).toBe("<p>old</p>\n");
  });
}
