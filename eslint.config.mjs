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
    "src/components/ui/**",
    "next-env.d.ts",
  ]),
])
