export type Error =
  | { kind: "vite.bad-request" }
  | { kind: "vite.not-json" }
  | { kind: "vite.cross-site" }
  | { kind: "vite.too-large" }
  | { kind: "vite.no-element"; tag: string }
  | { kind: "vite.templated" }
  | { kind: "vite.outside-project"; file: string }
  | { kind: "vite.missing-file"; cause: unknown }
  | { kind: "vite.unwritable"; cause: unknown };
