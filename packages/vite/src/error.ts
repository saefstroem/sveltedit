export type Error =
  | { kind: "vite.bad-request" }
  | { kind: "vite.bad-tag" }
  | { kind: "vite.bad-location" }
  | { kind: "vite.no-element"; tag: string }
  | { kind: "vite.no-content" }
  | { kind: "vite.unclosed" }
  | { kind: "vite.templated" }
  | { kind: "vite.block-content" }
  | { kind: "vite.outside-project"; file: string }
  | { kind: "vite.missing-file"; cause: unknown }
  | { kind: "vite.unwritable"; cause: unknown };
