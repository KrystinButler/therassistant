import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "../src");

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry)) files.push(path);
  }
  return files;
}

test("staff source does not import the retired demo Supabase adapters", () => {
  const offenders = sourceFiles(srcRoot)
    .filter((path) => /supabase-demo-(client|storage)/.test(readFileSync(path, "utf8")))
    .map((path) => relative(srcRoot, path))
    .sort();

  assert.deepEqual(
    offenders,
    [],
    `Retired demo Supabase adapters remain imported by: ${offenders.join(", ")}`,
  );
});
