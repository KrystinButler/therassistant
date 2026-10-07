import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

import type { CredentialingVerificationJob } from "./types";

export const CREDENTIALING_VERIFICATION_QUEUE =
  "credentialing_participation_verification" as const;

export async function enqueueVerification(
  runId: string,
  tenantId: string,
): Promise<string> {
  const message: CredentialingVerificationJob = { runId, tenantId };
  const result = await db.execute(sql`
    SELECT *
    FROM pgmq.send(
      ${CREDENTIALING_VERIFICATION_QUEUE},
      ${JSON.stringify(message)}::jsonb
    )
  `);

  const row = result.rows[0] as Record<string, unknown> | undefined;
  const messageId = row?.send ?? row?.msg_id ?? Object.values(row ?? {})[0];
  if (messageId === null || messageId === undefined) {
    throw new Error("Credentialing verification queue did not return a message id");
  }

  return String(messageId);
}
