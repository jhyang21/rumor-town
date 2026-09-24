import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Math functions whose results can differ across engines. Integer-safe ones (floor, ceil, round,
// abs, min, max, trunc, sign, sqrt) stay allowed.
const nondeterministicMath = [
  "random", "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "exp", "expm1", "log", "log1p",
  "log2", "log10", "pow", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh", "cbrt", "hypot",
].map((property) => ({ object: "Math", property, message: `Math.${property} is not deterministic across engines; src/sim must stay replay-exact.` }));

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The simulation engine must be pure and replay-exact.
    files: ["src/sim/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        ...["Date", "performance", "fetch", "window", "document", "navigator", "setTimeout", "setInterval",
          "requestAnimationFrame", "crypto", "localStorage", "sessionStorage"].map((name) => ({
          name,
          message: `${name} is not allowed in src/sim (pure, deterministic engine). Wall-clock and network live in src/runtime.`,
        })),
      ],
      "no-restricted-properties": ["error", ...nondeterministicMath],
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["react", "react-dom", "next", "next/*", "ai", "@vercel/*", "zustand"], message: "src/sim imports nothing from the UI, framework, or AI SDK." }] },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".data/**",
  ]),
]);

export default eslintConfig;
