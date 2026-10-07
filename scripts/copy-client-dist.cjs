const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = path.join(root, "client", "dist");
const dest = path.join(root, "server", "dist");

if (!fs.existsSync(src)) {
  console.error("client/dist is missing. Run: npm --prefix client run build");
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log("Copied client/dist -> server/dist");
