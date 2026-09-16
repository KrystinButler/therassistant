import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "RejectionsPage.tsx"), "utf8");

for (const fragment of ['queuePosition={activeItem ? `${activeIndex + 1} of ${visible.length}`', 'onPrevious={() => openAt(activeIndex - 1)}', 'onNext={() => openAt(activeIndex + 1)}']) {
  if (!source.includes(fragment)) throw new Error(`RejectionsPage missing navigation fragment: ${fragment}`);
}

console.log("rejections drawer navigation contract passed");
