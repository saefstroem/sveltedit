export const endpoint = "/__sveltedit";

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;

  it("is one absolute dev-server path", () => {
    expect(endpoint.startsWith("/")).toBe(true);
    expect(endpoint.includes(" ")).toBe(false);
  });
}
