import { defineConfig } from "vitest/config";
import path from "path";

// Testes de integracao contra o Supabase LOCAL (supabase start). Nunca remoto.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.int.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
