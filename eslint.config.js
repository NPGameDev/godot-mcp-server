import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "scripts/"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "object-shorthand": ["error", "always"],
      // typescript-eslint's no-shadow supersedes the base rule (the base mis-fires on
      // TS enums / overloads / type-value merges), so disable the base and use the TS one.
      "no-shadow": "off",
      "@typescript-eslint/no-shadow": "error",
    },
  },
);
