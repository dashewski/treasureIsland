// tsc copies only .ts files, so the Lua scripts are copied from src to dist here
const fs = require("node:fs");
const path = require("node:path");

function copyLua(from, to) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyLua(source, target);
    } else if (entry.name.endsWith(".lua")) {
      fs.mkdirSync(to, { recursive: true });
      fs.copyFileSync(source, target);
    }
  }
}

copyLua("src", "dist");
