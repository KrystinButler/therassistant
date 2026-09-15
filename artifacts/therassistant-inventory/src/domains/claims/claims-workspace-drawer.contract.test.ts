import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "ClaimsWorkspacePage.tsx"), "utf8");

function expectSource(fragment: string) {
  if (!source.includes(fragment)) {
    throw new Error(`ClaimsWorkspacePage is missing drawer integration fragment: ${fragment}`);
  }
}

expectSource('import { ClaimWorkDrawer');
expectSource('const [activeClaimId, setActiveClaimId]');
expectSource('onOpenClaim={openClaim}');
expectSource('<ClaimWorkDrawer');
expectSource('queuePosition={`${activeClaimIndex + 1} of ${filtered.length}`}');
expectSource('onPrevious={() => moveActiveClaim(-1)}');
expectSource('onNext={() => moveActiveClaim(1)}');

console.log("claims workspace drawer integration contract passed");
