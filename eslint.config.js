import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "src-tauri/**",
      "public/**",
      "src/shared/i18n/translations.ts", // large generated file
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // ── TypeScript ──────────────────────────────────────────
      "@typescript-eslint/no-explicit-any": "off",           // too many Tauri/IPC boundaries
      "@typescript-eslint/no-unused-vars": ["error", {
        "vars": "all",
        "args": "after-used",
        "ignoreRestSiblings": true,
        "argsIgnorePattern": "^_",
        "varsIgnorePattern": "^_"
      }],
      "@typescript-eslint/no-non-null-assertion": "warn",    // flag ! assertions
      "@typescript-eslint/no-floating-promises": "error",    // catch un-awaited promises
      "@typescript-eslint/await-thenable": "error",          // no await on non-promise
      "@typescript-eslint/no-misused-promises": "error",     // e.g. passing async fn to onClick

      // ── Vanilla JS quality ──────────────────────────────────
      "no-unused-vars": "off",                               // handled by TS rule above
      "no-console": ["warn", { allow: ["warn", "error"] }],  // flag stray console.log
      "no-debugger": "error",
      "no-alert": "error",
      "no-var": "error",
      "prefer-const": "error",
      "eqeqeq": ["error", "always", { null: "ignore" }],    // == null ok, rest ===
      "no-implicit-coercion": ["error", { boolean: false }],
      "no-throw-literal": "error",                           // throw new Error(), not throw "str"

      // ── Async / Promise ─────────────────────────────────────
      "no-async-promise-executor": "error",
      "no-promise-executor-return": "error",
      "require-atomic-updates": "error",

      // ── Code style ──────────────────────────────────────────
      "prefer-template": "error",                            // `${x}` not x + y
      "object-shorthand": ["error", "always"],
      "no-useless-rename": "error",
      "no-duplicate-imports": "error",
    }
  },
  {
    // Type-aware rules need languageOptions pointing to tsconfig
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      }
    }
  }
);
