import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "src-tauri/**",
      "public/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { 
        "vars": "all", 
        "args": "after-used", 
        "ignoreRestSiblings": true,
        "argsIgnorePattern": "^_",
        "varsIgnorePattern": "^_"
      }],
      "no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off"
    }
  }
);
