// special endpoint that the vite server listens on for sveltedit claims
export const endpoint = "/__sveltedit";

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;

  it("matches the path the Vite plugin answers on", () => {
    expect(endpoint).toBe("/__sveltedit");
  });
}
