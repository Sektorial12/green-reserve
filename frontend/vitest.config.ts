import path from "node:path";

import { defineConfig, defineProject } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      defineProject({
        resolve: {
          alias: {
            "@": path.resolve(__dirname, "./src"),
          },
        },
        test: {
          environment: "node",
          include: [
            "src/**/*.test.ts",
            "src/**/*.test.tsx",
            "src/**/*.int.test.ts",
          ],
          exclude: ["src/**/*.dom.test.ts"],
          clearMocks: true,
          mockReset: true,
          restoreMocks: true,
        },
      }),
      defineProject({
        resolve: {
          alias: {
            "@": path.resolve(__dirname, "./src"),
          },
        },
        test: {
          environment: "jsdom",
          include: ["src/**/*.dom.test.ts"],
          clearMocks: true,
          mockReset: true,
          restoreMocks: true,
        },
      }),
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
