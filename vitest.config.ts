import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "lib/yoto/__tests__/**/*.ts",
      "lib/**/*.test.ts",
      "app/**/*.test.ts",
    ],
    globals: true,
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
