import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { endpoint } from "../endpoint.js";
import { apply, refusal, type HeaderMap, type Io } from "./apply.js";
import type { Error } from "./error.js";
import type { Result } from "./result.js";

interface Request {
  method?: string | undefined;
  url?: string | undefined;
  headers?: HeaderMap | undefined;
  on?(event: "data" | "end", handle: (chunk?: unknown) => void): unknown;
}

interface Response {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body: string): unknown;
}

interface Server {
  config: { root: string };
  middlewares: { use(handle: (request: unknown, response: unknown, next: () => void) => void): unknown };
}

const limit = 1_048_576;

function attempted<T>(act: () => T, failed: (cause: unknown) => Error): Result<T> {
  try {
    return { ok: true, value: act() };
  } catch (cause) {
    return { ok: false, error: failed(cause) };
  }
}

const disk: Io = {
  resolve: (base, file) => resolve(base, file),
  real: (path) =>
    attempted(
      () => realpathSync(path),
      (cause) => ({ kind: "vite.missing-file", cause }),
    ),
  read: (file) =>
    attempted(
      () => readFileSync(file, "utf8"),
      (cause) => ({ kind: "vite.missing-file", cause }),
    ),
  write: (file, source) =>
    attempted(
      () => {
        writeFileSync(file, source);
        return undefined;
      },
      (cause) => ({ kind: "vite.unwritable", cause }),
    ),
};

export function sveltedit(io: Io = disk): {
  name: string;
  apply: "serve";
  configureServer(server: Server): void;
} {
  return {
    name: "sveltedit",
    apply: "serve" as const,
    configureServer(server: Server): void {
      const lexical = resolve(server.config.root);
      const canonical = io.real(lexical);
      const root = (canonical.ok ? canonical.value : lexical) + sep;
      const shapedRequest = (value: unknown): value is Request => typeof value === "object" && value !== null;
      const shapedResponse = (value: unknown): value is Response =>
        typeof value === "object" &&
        value !== null &&
        "statusCode" in value &&
        typeof value.statusCode === "number" &&
        "setHeader" in value &&
        typeof value.setHeader === "function" &&
        "end" in value &&
        typeof value.end === "function";
      server.middlewares.use((request, response, next) => {
        if (!shapedRequest(request) || !shapedResponse(response)) {
          next();
          return;
        }
        if (request.method !== "POST" || request.url !== endpoint || request.on === undefined) {
          next();
          return;
        }
        const chunks: Uint8Array[] = [];
        let size = 0;
        request.on("data", (chunk) => {
          const bytes = chunk instanceof Uint8Array ? chunk : Buffer.from(String(chunk));
          size += bytes.length;
          if (size <= limit) chunks.push(bytes);
        });
        request.on("end", () => {
          const json: { parse(text: string): unknown } = JSON;
          let claim: unknown = undefined;
          try {
            claim = json.parse(Buffer.concat(chunks).toString("utf8"));
          } catch (cause) {
            claim = { cause };
          }
          const reply =
            size > limit ? refusal({ kind: "vite.too-large" }) : apply(claim, request.headers ?? {}, root, io);
          response.statusCode = reply.status;
          response.setHeader("content-type", "application/json");
          response.end(reply.body);
        });
      });
    },
  };
}
