import { endpoint } from "./endpoint.js";
import type { Error as Fault } from "./error.js";
import type { Result } from "./result.js";

export interface Claim {
  file: string;
  line: number;
  column: number;
  tag: string;
  html: string | null;
  more?: string[];
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
