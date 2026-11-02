import type { Error } from "./error.js";
import type { Result } from "./result.js";
import { rewrite, type Edit } from "./rewrite.js";

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
  "vite.no-element": 409,
  "vite.templated": 409,
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
    const { file, line, column, tag, html } = claim;
    if (typeof file !== "string" || typeof line !== "number" || typeof column !== "number") return undefined;
    if (!Number.isInteger(line) || line < 1 || !Number.isInteger(column) || column < 0) return undefined;
    if (typeof tag !== "string" || (typeof html !== "string" && html !== null)) return undefined;
    return { file, line, column, tag, html };
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
