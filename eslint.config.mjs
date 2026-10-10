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
    ".worktrees/**",
    "public/vendor/**",
    "src/components/ui/**",
    "next-env.d.ts",
  ]),
  // Client UI / hooks / client packages must not import server internals.
  // Prefer ClientRoomState (sanitized snapshot) over server RoomState.
  {
    files: ["src/components/**/*.{ts,tsx}", "src/hooks/**/*.{ts,tsx}", "src/client/**/*.{ts,tsx}"],
    ignores: ["**/*.{test,spec}.{ts,tsx}", "**/*.property.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/contracts/types",
              importNames: ["RoomState"],
              message:
                "Use ClientRoomState (or a narrower Pick) in client/UI code; RoomState is server-persisted.",
            },
          ],
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
  // `src/shared/dom/**` is the intentional browser boundary (see that folder's README).
  {
    files: ["src/shared/**/*.{ts,tsx}", "src/contracts/**/*.{ts,tsx}"],
    ignores: [
      "src/shared/dom/**",
      "**/*.{test,spec}.{ts,tsx}",
      "**/*.property.test.ts",
    ],
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
                "@/shared/dom",
                "@/shared/dom/*",
              ],
              message:
                "shared/contracts must not import server, client, components, hooks, or shared/dom.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "window",
          message:
            "Pure shared must not use window; put browser helpers in src/shared/dom/ or src/client/.",
        },
        {
          name: "document",
          message:
            "Pure shared must not use document; put browser helpers in src/shared/dom/ or src/client/.",
        },
        {
          name: "localStorage",
          message:
            "Pure shared must not use localStorage; put browser helpers in src/shared/dom/ or src/client/.",
        },
        {
          name: "sessionStorage",
          message:
            "Pure shared must not use sessionStorage; put browser helpers in src/shared/dom/ or src/client/.",
        },
      ],
    },
  },
  // Browser-boundary shared helpers may use DOM globals; still no React/server/UI.
  {
    files: ["src/shared/dom/**/*.{ts,tsx}"],
    ignores: ["**/*.{test,spec}.{ts,tsx}", "**/*.property.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react",
              message: "shared/dom must stay framework-agnostic.",
            },
            {
              name: "react-dom",
              message: "shared/dom must stay framework-agnostic.",
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
                "shared/dom must not import server, client, components, or hooks.",
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
