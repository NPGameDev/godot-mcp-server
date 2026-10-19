// scripts/docs-api-check.mjs
// Fail when the committed API reference (docs/api/) differs from what typedoc
// generates from the current source. Regenerates into a temp folder with the
// same typedoc.json as `npm run docs:api`, then compares page by page, byte for
// byte: the release workflow's `git diff --exit-code -- docs/` is just as strict,
// so a looser compare here would pass a tree the release then rejects.
//
// Run via `npm run docs:api:check` (plain node, never npx). Exit codes:
//   0  PASS, docs/api is up to date
//   1  DRIFT, one line per changed, added or missing page
//   2  typedoc failed to convert, validate or render, or the check itself threw
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Application } from "typedoc";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const committedDir = join(repoRoot, "docs", "api");

/** Every file under `dir`, as `/`-separated paths relative to it; empty when `dir` is absent. */
async function listFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { recursive: true, withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
    .sort();
}

/** Renders the API reference into `outDir`; returns false when typedoc reports an error. */
async function generate(outDir) {
  // An explicit `out` wins over typedoc.json's, so every other option stays the same as `docs:api`.
  const app = await Application.bootstrapWithPlugins({ out: outDir });
  const project = await app.convert();
  if (!project || app.logger.hasErrors()) return false;
  app.validate(project);
  if (app.logger.hasErrors()) return false;
  // generateOutputs, not generateDocs: generateDocs always writes the HTML output, while
  // typedoc-plugin-markdown makes Markdown the default output that docs:api writes.
  await app.generateOutputs(project);
  return !app.logger.hasErrors();
}

/** The pages that differ between the committed and the fresh tree, each with its kind of drift. */
async function findDrift(freshDir) {
  const committed = new Set(await listFiles(committedDir));
  const fresh = new Set(await listFiles(freshDir));
  const drift = [];
  for (const page of [...new Set([...committed, ...fresh])].sort()) {
    if (!fresh.has(page)) {
      drift.push(`${page} (no longer generated)`);
    } else if (!committed.has(page)) {
      drift.push(`${page} (missing from docs/api)`);
    } else {
      const [before, after] = await Promise.all([readFile(join(committedDir, page)), readFile(join(freshDir, page))]);
      if (!before.equals(after)) drift.push(`${page} (changed)`);
    }
  }
  return drift;
}

// typedoc resolves typedoc.json, tsconfig.json and the entry points from the working
// directory, so the check runs from the repo root however it is started.
process.chdir(repoRoot);
const freshDir = await mkdtemp(join(tmpdir(), "docs-api-check-"));
try {
  if (!(await generate(freshDir))) {
    process.stderr.write("ERROR: typedoc failed; see its messages above\n");
    process.exitCode = 2;
  } else {
    const drift = await findDrift(freshDir);
    if (drift.length === 0) {
      process.stdout.write("PASS: docs/api is up to date with the source\n");
    } else {
      for (const line of drift) process.stderr.write(`DRIFT: docs/api/${line}\n`);
      process.stderr.write("docs/api is stale: run `npm run docs:api` and commit the result\n");
      process.exitCode = 1;
    }
  }
} catch (err) {
  // An unexpected throw is a failed check, not drift: exit 2 so it never reads as exit 1.
  process.stderr.write(`ERROR: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exitCode = 2;
} finally {
  await rm(freshDir, { recursive: true, force: true });
}
