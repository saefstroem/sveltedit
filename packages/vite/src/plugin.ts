import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { apply, refusal, type HeaderMap, type Io } from "./apply";
import { endpoint } from "./endpoint";
import type { Error } from "./error";
import type { Result } from "./result";

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

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;
  type Handle = (request: Request, response: Response, next: () => void) => void;
  const trusted: HeaderMap = { "content-type": "application/json", "sec-fetch-site": "same-origin" };
  const written: string[] = [];
  const io: Io = {
    resolve: (base, file) => (file.startsWith("/") ? file : base + file),
    real: (path) => ({ ok: true, value: path }),
    read: () => ({ ok: true, value: "<p>old</p>\n" }),
    write: (_file, source) => {
      written.push(source);
      return { ok: true, value: undefined };
    },
  };
  const served = (): { handle?: Handle } => {
    const holder: { handle?: Handle } = {};
    sveltedit(io).configureServer({
      config: { root: "/app" },
      middlewares: {
        use: (use) => {
          holder.handle = use;
        },
      },
    });
    return holder;
  };
  const sent = (holder: { handle?: Handle }, method: string, url: string, body: string, cut = 4, headers = trusted) => {
    const result = { status: 0, body: "", nexted: false };
    const listeners = new Map<string, (chunk?: unknown) => void>();
    const response: Response = {
      statusCode: 0,
      setHeader: () => undefined,
      end: (answer: string) => {
        result.body = answer;
        result.status = response.statusCode;
      },
    };
    const request: Request = { method, url, headers, on: (event, given) => void listeners.set(event, given) };
    holder.handle?.(request, response, () => {
      result.nexted = true;
    });
    const bytes = Buffer.from(body);
    listeners.get("data")?.(bytes.subarray(0, cut));
    listeners.get("data")?.(bytes.subarray(cut));
    listeners.get("end")?.();
    return result;
  };
  const claim = (html = "new") => JSON.stringify({ file: "/app/x.svelte", line: 1, column: 0, tag: "p", html });

  it("answers the endpoint and hands everything else to the next middleware", () => {
    const holder = served();
    const hit = sent(holder, "POST", "/__sveltedit", claim());
    expect(hit.nexted).toBe(false);
    expect(hit.status).toBe(200);
    expect(hit.body).toBe('{"saved":"/app/x.svelte"}');
    expect(sent(holder, "GET", "/__sveltedit", "").nexted).toBe(true);
    expect(sent(holder, "POST", "/other", "").nexted).toBe(true);
  });

  it("answers 400 for a body that is not JSON", () => {
    const hit = sent(served(), "POST", "/__sveltedit", "not json");
    expect(hit.status).toBe(400);
    expect(hit.body).toBe('{"kind":"vite.bad-request"}');
  });

  it("decodes a character whose bytes arrive in two chunks", () => {
    const body = claim("olé");
    const inside = Buffer.from(body).indexOf(Buffer.from("é")) + 1;
    expect(sent(served(), "POST", "/__sveltedit", body, inside).status).toBe(200);
    expect(written.at(-1)).toBe("<p>olé</p>\n");
  });

  it("answers 413 for a body over the size limit", () => {
    const hit = sent(served(), "POST", "/__sveltedit", claim("x".repeat(limit)));
    expect(hit).toEqual({ status: 413, body: '{"kind":"vite.too-large"}', nexted: false });
  });

  it("passes the request headers on, so another site is refused", () => {
    const hit = sent(served(), "POST", "/__sveltedit", claim(), 4, { ...trusted, "sec-fetch-site": "cross-site" });
    expect(hit.status).toBe(403);
  });
}
