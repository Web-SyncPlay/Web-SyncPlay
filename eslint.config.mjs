import nextVitals from "eslint-config-next/core-web-vitals"
import nextTs from "eslint-config-next/typescript"
import prettier from "eslint-config-prettier/flat"
import { defineConfig, globalIgnores } from "eslint/config"

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    // Pin React version so eslint-plugin-react skips detectReactVersion()
    // (which still uses the removed ESLint context.getFilename API).
    settings: {
      react: {
        version: "19.3",
      },
    },
  },
  globalIgnores([
    "**/build/**",
    "**/dist/**",
    ".next/**",
    "public/vendor/**",
    "src/components/ui/**",
    "next-env.d.ts",
  ]),
  // Client UI / hooks / client packages must not import server internals.
  {
    files: ["src/components/**/*.{ts,tsx}", "src/hooks/**/*.{ts,tsx}", "src/client/**/*.{ts,tsx}"],
    ignores: ["**/*.{test,spec}.{ts,tsx}", "**/*.property.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server", "@/server/*"],
              message: "Client code must not import @/server.",
            },
          ],
        },
      ],
    },
  },
  // Pure shared / contracts: no React, no client/server UI layers.
  {
    files: ["src/shared/**/*.{ts,tsx}", "src/contracts/**/*.{ts,tsx}"],
    ignores: ["**/*.{test,spec}.{ts,tsx}", "**/*.property.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react",
              message: "shared/contracts must stay framework-agnostic.",
            },
            {
              name: "react-dom",
              message: "shared/contracts must stay framework-agnostic.",
            },
          ],
          patterns: [
            {
              group: [
                "@/server",
                "@/server/*",
                "@/client",
                "@/client/*",
                "@/components",
                "@/components/*",
                "@/hooks",
                "@/hooks/*",
              ],
              message:
                "shared/contracts must not import server, client, components, or hooks.",
            },
          ],
        },
      ],
    },
  },
  // Server must not import client / React UI layers.
  {
    files: ["src/server/**/*.{ts,tsx}"],
    ignores: ["**/*.{test,spec}.{ts,tsx}", "**/*.property.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/client",
                "@/client/*",
                "@/components",
                "@/components/*",
                "@/hooks",
                "@/hooks/*",
              ],
              message: "Server code must not import @/client, @/components, or @/hooks.",
            },
          ],
        },
      ],
    },
  },
])
