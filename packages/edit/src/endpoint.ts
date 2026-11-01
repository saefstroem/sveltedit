export const endpoint = "/__sveltedit";

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;

  it("matches the path sveltedit-vite answers on", () => {
    expect(endpoint).toBe("/__sveltedit");
  });
}
