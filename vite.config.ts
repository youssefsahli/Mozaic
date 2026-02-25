import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  publicDir: "public",
  plugins: [],
  build: {
    outDir: "dist",
  },
  test: {
    environment: "jsdom",
  },
});
