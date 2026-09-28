import { createClient } from "@supabase/supabase-js";

type QueueMessage = {
  job_id: string;
  tenant_id: string | null;
  job_type: string;
  payload: Record<string, unknown>;
};

type QueueRecord = {
  msg_id: number;
  read_ct: number;
  enqueued_at: string;
  vt: string;
  message: unknown;
};

class PermanentJobError extends Error {}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function namedKey(currentName: string, legacyName: string) {
  const current = Deno.env.get(currentName)?.trim();
  if (current) {
    try {
      const parsed = JSON.parse(current) as Record<string, unknown>;
      const preferred = parsed.default;
      if (typeof preferred === "string" && preferred.trim()) return preferred.trim();

      const fallback = Object.values(parsed).find(
        (value): value is string => typeof value === "string" && Boolean(value.trim()),
      );
      if (fallback) return fallback.trim();
    } catch {
      throw new Error(`Invalid ${currentName} configuration`);
    }
  }

  const legacy = Deno.env.get(legacyName)?.trim();
  if (legacy) return legacy;

  throw new Error(`Missing Supabase API key configuration: ${currentName}`);
}

const SUPABASE_URL = requiredEnv("SUPABASE_URL");
const SECRET_KEY = namedKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

function json(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseQueueMessage(value: unknown): QueueMessage {
  const raw = asObject(value);
  if (!raw) throw new PermanentJobError("Queue message is not an object.");

  const jobId = typeof raw.job_id === "string" ? raw.job_id.trim() : "";
  const jobType = typeof raw.job_type === "string" ? raw.job_type.trim() : "";
  const tenantId = raw.tenant_id === null || raw.tenant_id === undefined
    ? null
    : typeof raw.tenant_id === "string"
      ? raw.tenant_id.trim()
      : "";
  const payload = asObject(raw.payload) ?? {};

  if (!jobId) throw new PermanentJobError("Queue message is missing job_id.");
  if (!jobType) throw new PermanentJobError("Queue message is missing job_type.");
  if (tenantId === "") throw new PermanentJobError("Queue message has an invalid tenant_id.");

  return {
    job_id: jobId,
    tenant_id: tenantId,
    job_type: jobType,
    payload,
  };
}

function safeError(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 2000);
  return "Background job failed.";
}

async function requireWorkerToken(req: Request) {
  const token = req.headers.get("x-background-worker-token")?.trim();
  if (!token) return false;

  const { data, error } = await admin.rpc("verify_background_worker_token", {
    p_token: token,
  });

  return !error && data === true;
}

async function runJob(job: QueueMessage) {
  switch (job.job_type) {
    case "system.health_check":
      return;
    default:
      throw new PermanentJobError(`Unsupported background job type: ${job.job_type}`);
  }
}

async function processRecord(record: QueueRecord) {
  let job: QueueMessage;

  try {
    job = parseQueueMessage(record.message);
  } catch (error) {
    const { error: archiveError } = await admin.rpc("archive_background_message", {
      p_msg_id: record.msg_id,
    });

    if (archiveError) throw archiveError;

    return { outcome: "discarded" as const };
  }

  const { data: marked, error: markError } = await admin.rpc(
    "mark_background_job_processing",
    {
      p_job_id: job.job_id,
      p_msg_id: record.msg_id,
      p_read_ct: record.read_ct,
    },
  );

  if (markError) throw markError;

  if (marked !== true) {
    throw new PermanentJobError("Background job audit row is unavailable.");
  }

  try {
    await runJob(job);

    const { error: completeError } = await admin.rpc("complete_background_job", {
      p_job_id: job.job_id,
      p_msg_id: record.msg_id,
      p_read_ct: record.read_ct,
    });

    if (completeError) throw completeError;

    return { outcome: "succeeded" as const };
  } catch (error) {
    const permanent = error instanceof PermanentJobError;
    const { data: failureStatus, error: failureError } = await admin.rpc(
      "fail_background_job",
      {
        p_job_id: job.job_id,
        p_msg_id: record.msg_id,
        p_read_ct: record.read_ct,
        p_error: safeError(error),
        p_permanent: permanent,
      },
    );

    if (failureError) throw failureError;

    return {
      outcome: failureStatus === "failed" ? "failed" as const : "retrying" as const,
    };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  if (!(await requireWorkerToken(req))) {
    return json({ error: "Unauthorized." }, 401);
  }

  const { data, error } = await admin.rpc("dequeue_background_jobs", {
    p_qty: 5,
    p_visibility_timeout: 90,
  });

  if (error) {
    return json({ error: "Unable to dequeue background jobs." }, 503);
  }

  const records = Array.isArray(data) ? data as QueueRecord[] : [];
  const counts = {
    dequeued: records.length,
    succeeded: 0,
    retrying: 0,
    failed: 0,
    discarded: 0,
  };

  for (const record of records) {
    try {
      const result = await processRecord(record);
      counts[result.outcome] += 1;
    } catch {
      counts.retrying += 1;
    }
  }

  return json(counts);
});
