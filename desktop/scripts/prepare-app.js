/* Copies the Next.js standalone build into desktop/app so electron-builder can bundle it. Run `npm run build` in the web app first. */
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..", "..");
const standalone = path.join(root, ".next", "standalone");
const dest = path.resolve(__dirname, "..", "app");
if (!fs.existsSync(path.join(standalone, "server.js"))) {
  console.error("Standalone build not found. Run `npm run build` in the web app first (next.config.ts has output: 'standalone').");
  process.exit(1);
}
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(standalone, dest, { recursive: true });
fs.cpSync(path.join(root, ".next", "static"), path.join(dest, ".next", "static"), { recursive: true });
if (fs.existsSync(path.join(root, "public"))) fs.cpSync(path.join(root, "public"), path.join(dest, "public"), { recursive: true });
console.log("Prepared", dest);
