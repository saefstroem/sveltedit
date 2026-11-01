export interface Error {
  kind: "check.unreadable";
  path: string;
  cause: unknown;
}
