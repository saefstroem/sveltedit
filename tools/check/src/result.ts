import type { Error } from "./error";

export type Result<T> = { ok: true; value: T } | { ok: false; error: Error };
