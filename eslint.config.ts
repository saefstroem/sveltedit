import { flatConfigs } from "eslint-plugin-import-x";
import { configs } from "typescript-eslint";

export default [
  { ignores: ["**/dist/**", "**/node_modules/**", "**/.svelte-kit/**", "**/*.svelte"] },
  ...configs.strictTypeChecked,
  ...configs.stylisticTypeChecked,
  flatConfigs.recommended,
  flatConfigs.typescript,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    settings: { "import-x/resolver": { typescript: true } },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/non-nullable-type-assertion-style": "off",
      "import-x/first": "error",
      "import-x/newline-after-import": "error",
      "import-x/no-cycle": "error",
      "import-x/no-default-export": "error",
      "import-x/no-extraneous-dependencies": "error",
      "import-x/no-internal-modules": "error",
      "import-x/no-namespace": "error",
      "import-x/no-unassigned-import": "error",
      "import-x/order": "error",
      "no-restricted-syntax": ["error", { selector: "ExportAllDeclaration", message: "No glob re-export." }],
    },
  },
  {
    files: ["**/*.config.ts", "**/*.d.ts"],
    rules: { "import-x/no-default-export": "off" },
  },
];
