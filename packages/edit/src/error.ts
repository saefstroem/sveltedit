export type Error =
  { kind: "edit.rejected"; failure: string; status: number } | { kind: "edit.unreachable"; cause: unknown };
