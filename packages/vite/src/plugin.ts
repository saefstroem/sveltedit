import { readFileSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { apply, type Io } from "./apply";
import { endpoint } from "./endpoint";
import type { Error } from "./error";
import type { Result } from "./result";

interface Request {
  method?: string | undefined;
  url?: string | undefined;
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

function attempted<T>(act: () => T, failed: (cause: unknown) => Error): Result<T> {
  try {
    return { ok: true, value: act() };
  } catch (cause) {
    return { ok: false, error: failed(cause) };
  }
}

const disk: Io = {
  resolve: (base, file) => resolve(base, file),
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
      const root = resolve(server.config.root) + sep;
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
        let raw = "";
        request.on("data", (chunk) => {
          raw += String(chunk);
        });
        request.on("end", () => {
          const json: { parse(text: string): unknown } = JSON;
          let claim: unknown = undefined;
          try {
            claim = json.parse(raw);
          } catch (cause) {
            claim = { cause };
          }
          const reply = apply(claim, root, io);
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
  const io: Io = {
    resolve: (base, file) => (file.startsWith("/") ? file : base + file),
    read: () => ({ ok: true, value: "<p>old</p>\n" }),
    write: () => ({ ok: true, value: undefined }),
  };
  const served = (): { handle?: Handle } => {
    const holder: { handle?: Handle } = {};
    sveltedit(io).configureServer({
      config: { root: "/app" },
      middlewares: {
        use: (given) => {
          holder.handle = given;
        },
      },
    });
    return holder;
  };
  const sent = (holder: { handle?: Handle }, method: string, url: string, body: string) => {
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
    holder.handle?.({ method, url, on: (event, given) => void listeners.set(event, given) }, response, () => {
      result.nexted = true;
    });
    listeners.get("data")?.(body.slice(0, 4));
    listeners.get("data")?.(body.slice(4));
    listeners.get("end")?.();
    return result;
  };

  it("answers the endpoint and hands everything else to the next middleware", () => {
    const holder = served();
    const hit = sent(
      holder,
      "POST",
      "/__sveltedit",
      '{"file":"/app/x.svelte","line":1,"column":0,"tag":"p","html":"new","original":"old"}',
    );
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
}
