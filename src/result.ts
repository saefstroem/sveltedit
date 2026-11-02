import type { Error } from "./error.js";

export type Result<T> = { ok: true; value: T } | { ok: false; error: Error };
