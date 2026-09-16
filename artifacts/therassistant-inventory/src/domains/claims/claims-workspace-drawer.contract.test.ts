import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "ClaimsPage.tsx"), "utf8");

function expectSource(fragment: string) {
  if (!source.includes(fragment)) {
    throw new Error(`ClaimsPage is missing drawer integration fragment: ${fragment}`);
  }
}

expectSource('import { ClaimWorkDrawer');
expectSource('const [activeClaimId, setActiveClaimId]');
expectSource('<ClaimWorkDrawer');
expectSource('mode="claims"');
expectSource('queuePosition={activeItem ? `${activeIndex + 1} of ${visible.length}`');
expectSource('onPrevious={() => openAt(activeIndex - 1)}');
expectSource('onNext={() => openAt(activeIndex + 1)}');

console.log("claims workqueue drawer integration contract passed");
