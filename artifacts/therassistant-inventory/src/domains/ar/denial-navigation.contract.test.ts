import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "DenialsPage.tsx"), "utf8");

for (const fragment of ['queuePosition', 'onPrevious', 'onNext']) {
  if (!source.includes(fragment)) throw new Error(`DenialsPage missing navigation fragment: ${fragment}`);
}

console.log("denials drawer navigation contract passed");
