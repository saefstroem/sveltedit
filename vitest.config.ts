import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    includeSource: ["packages/*/src/**/*.{ts,tsx}"],
  },
});
