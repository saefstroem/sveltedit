import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  dts: true,
  define: { "import.meta.vitest": "undefined" },
});
