// The admin page (admin/), built on its own into admin/dist for the rh-admin
// Worker: `npm run build:admin`.
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.resolve(__dirname, "admin"),
  base: "/",
  plugins: [
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler"]],
      },
    }),
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
