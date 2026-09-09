// Flat config. Scoped to the mcp/ TypeScript workspace; everything else is ignored.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "mcp/dist/**",
      "scraper/**",
      "courses/**",
      "daily/**",
      "dashboard/**/dist/**",
    ],
  },
  {
    files: ["mcp/**/*.{ts,js,mjs,cjs}", "dashboard/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, prettier],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        EventSource: "readonly",
        fetch: "readonly",
        FormData: "readonly",
        Response: "readonly",
        document: "readonly",
        HTMLSelectElement: "readonly",
        HTMLInputElement: "readonly",
        HTMLPreElement: "readonly",
        MessageEvent: "readonly",
        FileList: "readonly",
        File: "readonly",
        window: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        HTMLElement: "readonly",
        HTMLTextAreaElement: "readonly",
        KeyboardEvent: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["mcp/test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["dashboard/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
