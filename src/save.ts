import { endpoint } from "./endpoint.js";
import type { Error as Fault } from "./error.js";
import type { Result } from "./result.js";

export interface Claim {
  file: string;
  line: number;
  column: number;
  tag: string;
  html: string | null;
}

export type Post = (path: string, body: string) => Promise<{ status: number; body: string }>;

const spoken: Record<string, string> = {
  "vite.templated": "This text holds template code. Edit it in the source.",
  "vite.too-large": "The edit is larger than 1 MB and was refused.",
  "vite.no-element": "The page is stale here. Reload and try again.",
  "vite.outside-project": "This element does not come from a project .svelte file.",
};

export async function save(claim: Claim, post: Post): Promise<Result<undefined>> {
  const failure = (body: string): string => {
    const json: { parse(text: string): unknown } = JSON;
    try {
      const reply = json.parse(body);
      if (typeof reply === "object" && reply !== null && "kind" in reply && typeof reply.kind === "string")
        return reply.kind;
      return "unknown";
    } catch {
      return "unknown";
    }
  };
  try {
    // send it to the vite server endpoint
    const reply = await post(endpoint, JSON.stringify(claim));
    if (reply.status === 200) return { ok: true, value: undefined };
    return { ok: false, error: { kind: "edit.rejected", failure: failure(reply.body), status: reply.status } };
  } catch (cause) {
    return { ok: false, error: { kind: "edit.unreachable", cause } };
  }
}

export function said(error: Fault): string {
  switch (error.kind) {
    case "edit.rejected":
      if (error.failure === "unknown")
        return `No sveltedit reply (HTTP ${String(error.status)}). Add sveltedit() from sveltedit/vite to vite.config.ts and restart the dev server.`;
      return spoken[error.failure] ?? `Rejected: ${error.failure}`;
    case "edit.unreachable":
      return "Could not reach the dev server.";
  }
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;
  const claim: Claim = { file: "page.svelte", line: 5, column: 0, tag: "p", html: "new" };
  const answer =
    (status: number, body: string): Post =>
    () =>
      Promise.resolve({ status, body });

  it("posts the claim to the endpoint and succeeds on 200", async () => {
    let seen = "";
    const post: Post = (path, body) => {
      seen = `${path} ${body}`;
      return Promise.resolve({ status: 200, body: '{"saved":"page.svelte"}' });
    };
    expect(await save(claim, post)).toEqual({ ok: true, value: undefined });
    expect(seen).toBe(`/__sveltedit ${JSON.stringify(claim)}`);
  });

  it("keeps the server's refusal kind and speaks it", async () => {
    const out = await save(claim, answer(409, '{"kind":"vite.templated"}'));
    expect(out).toEqual({ ok: false, error: { kind: "edit.rejected", failure: "vite.templated", status: 409 } });
    if (!out.ok) expect(said(out.error)).toBe("This text holds template code. Edit it in the source.");
  });

  it("tells the user to install the plugin when the reply is not sveltedit's", async () => {
    const odd = await save(claim, answer(404, "<!doctype html><h1>Not found</h1>"));
    expect(odd).toEqual({ ok: false, error: { kind: "edit.rejected", failure: "unknown", status: 404 } });
    if (!odd.ok)
      expect(said(odd.error)).toBe(
        "No sveltedit reply (HTTP 404). Add sveltedit() from sveltedit/vite to vite.config.ts and restart the dev server.",
      );
  });

  it("sends a deletion as a null html claim", async () => {
    let sent = "";
    const post: Post = (path, body) => {
      sent = path + " " + body;
      return Promise.resolve({ status: 200, body: '{"saved":"page.svelte"}' });
    };
    expect(await save({ ...claim, html: null }, post)).toEqual({ ok: true, value: undefined });
    expect(sent).toBe(`/__sveltedit ${JSON.stringify({ ...claim, html: null })}`);
  });

  it("survives a dead server", async () => {
    const dead = await save(claim, () => Promise.reject(new globalThis.Error("offline")));
    expect(dead.ok).toBe(false);
    if (!dead.ok) expect(said(dead.error)).toBe("Could not reach the dev server.");
  });
}
