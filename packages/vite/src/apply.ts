import type { Error } from "./error";
import type { Result } from "./result";
import { rewrite, type Edit } from "./rewrite";

export interface Io {
  resolve(base: string, file: string): string;
  read(file: string): Result<string>;
  write(file: string, source: string): Result<undefined>;
}

export interface Reply {
  status: number;
  body: string;
}

const codes: Record<Error["kind"], number> = {
  "vite.bad-request": 400,
  "vite.outside-project": 403,
  "vite.missing-file": 404,
  "vite.unwritable": 500,
  "vite.bad-tag": 409,
  "vite.bad-location": 409,
  "vite.no-element": 409,
  "vite.no-content": 409,
  "vite.unclosed": 409,
  "vite.templated": 409,
  "vite.stale": 409,
  "vite.block-content": 409,
};

export function apply(claim: unknown, root: string, io: Io): Reply {
  const reject = (error: Error): Reply => ({ status: codes[error.kind], body: JSON.stringify({ kind: error.kind }) });
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
  const edit = shaped();
  if (edit === undefined) return reject({ kind: "vite.bad-request" });
  const full = io.resolve(root, edit.file);
  if (!full.startsWith(root) || !full.endsWith(".svelte"))
    return reject({ kind: "vite.outside-project", file: edit.file });
  const source = io.read(full);
  if (!source.ok) return reject(source.error);
  const written = rewrite(source.value, edit);
  if (!written.ok) return reject(written.error);
  const stored = io.write(full, written.value);
  if (!stored.ok) return reject(stored.error);
  return { status: 200, body: JSON.stringify({ saved: edit.file }) };
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;
  const { posix } = await import("node:path");
  const held = new Map([["/app/src/page.svelte", "<p>old</p>\n"]]);
  const io: Io = {
    resolve: (base, file) => posix.resolve(base, file),
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
  const claim = { file: "/app/src/page.svelte", line: 1, column: 0, tag: "p", html: "new", original: "old" };

  it("rewrites the file and answers 200 with the saved path", () => {
    expect(apply(claim, "/app/", io)).toEqual({ status: 200, body: '{"saved":"/app/src/page.svelte"}' });
    expect(held.get("/app/src/page.svelte")).toBe("<p>new</p>\n");
  });

  it("answers 400 for a claim that is not an edit", () => {
    expect(apply(undefined, "/app/", io).status).toBe(400);
    expect(apply({ file: 1 }, "/app/", io).status).toBe(400);
    expect(apply({ ...claim, line: "5" }, "/app/", io).status).toBe(400);
  });

  it("confines writes to .svelte files inside the project root", () => {
    expect(apply({ ...claim, file: "/etc/passwd" }, "/app/", io).status).toBe(403);
    expect(apply({ ...claim, file: "/app/src/page.ts" }, "/app/", io).status).toBe(403);
    expect(apply({ ...claim, file: "../outside.svelte" }, "/app/", io).status).toBe(403);
  });

  it("deletes the element when html is null", () => {
    held.set("/app/src/page.svelte", "<p>old</p>\n");
    expect(apply({ ...claim, html: null }, "/app/", io).status).toBe(200);
    expect(held.get("/app/src/page.svelte")).toBe("");
    held.set("/app/src/page.svelte", "<p>old</p>\n");
  });

  it("maps missing files to 404 and rewrite refusals to 409", () => {
    expect(apply({ ...claim, file: "/app/src/gone.svelte" }, "/app/", io).status).toBe(404);
    expect(apply({ ...claim, tag: "h1" }, "/app/", io).status).toBe(409);
    expect(apply({ ...claim, tag: "h1" }, "/app/", io).body).toBe('{"kind":"vite.no-element"}');
  });

  it("maps a failed write to 500", () => {
    const sealed: Io = { ...io, write: () => ({ ok: false, error: { kind: "vite.unwritable", cause: "disk" } }) };
    expect(apply(claim, "/app/", sealed).status).toBe(500);
  });

  it("answers 400 without the original text and 409 when the source no longer holds it", () => {
    const { file, line, column, tag, html } = claim;
    expect(apply({ file, line, column, tag, html }, "/app/", io).status).toBe(400);
    expect(apply({ ...claim, original: "other words" }, "/app/", io)).toEqual({
      status: 409,
      body: '{"kind":"vite.stale"}',
    });
    expect(held.get("/app/src/page.svelte")).toBe("<p>old</p>\n");
  });
}
