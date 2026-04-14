#!/usr/bin/env node
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";

const SHEBANG = "#!/usr/bin/env node\n";
const target = resolve(process.cwd(), "dist/index.js");

const current = readFileSync(target, "utf8");
if (!current.startsWith("#!")) {
  writeFileSync(target, SHEBANG + current, "utf8");
}

if (process.platform !== "win32") {
  chmodSync(target, 0o755);
}
