-- Private maintenance scheduler for credentialing automation.
-- The runtime secret is provisioned operationally in Supabase Vault and as a
-- SHA-256 hash in private.integration_secret_hashes. No credential is committed.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS private.integration_secret_hashes (
  name text PRIMARY KEY,
  secret_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON private.integration_secret_hashes FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.credentialing_internal_secret_valid(p_secret text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = private, public, extensions, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM private.integration_secret_hashes s
    WHERE s.name = 'therassistant_credentialing_scheduler'
      AND s.secret_hash = encode(extensions.digest(COALESCE(p_secret, ''), 'sha256'), 'hex')
  );
$$;

REVOKE ALL ON FUNCTION public.credentialing_internal_secret_valid(text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credentialing_internal_secret_valid(text)
TO service_role;

CREATE OR REPLACE FUNCTION private.invoke_credentialing_maintenance(p_function_slug text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, vault, net, pg_temp
AS $$
DECLARE
  v_secret text;
  v_request_id bigint;
  v_url text;
BEGIN
  SELECT decrypted_secret
    INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'therassistant_credentialing_scheduler'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE LOG 'Credentialing scheduler secret is not provisioned; skipping %', p_function_slug;
    RETURN NULL;
  END IF;

  IF p_function_slug NOT IN (
    'credentialing-verification-worker',
    'credentialing-catalog-sync',
    'credentialing-directory-monitor'
  ) THEN
    RAISE EXCEPTION 'Unsupported credentialing maintenance function: %', p_function_slug;
  END IF;

  v_url := 'https://lpjwfdvaxobewxcklenl.supabase.co/functions/v1/' || p_function_slug;

  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-therassistant-scheduler-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION private.invoke_credentialing_maintenance(text)
FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  FOR v_jobid IN
    SELECT jobid
    FROM cron.job
    WHERE jobname IN (
      'credentialing-verification-worker',
      'credentialing-catalog-sync-nightly',
      'credentialing-directory-monitor-daily'
    )
  LOOP
    PERFORM cron.unschedule(v_jobid);
  END LOOP;
END
$$;

SELECT cron.schedule(
  'credentialing-verification-worker',
  '* * * * *',
  $$SELECT private.invoke_credentialing_maintenance('credentialing-verification-worker');$$
);

SELECT cron.schedule(
  'credentialing-catalog-sync-nightly',
  '15 2 * * *',
  $$SELECT private.invoke_credentialing_maintenance('credentialing-catalog-sync');$$
);

SELECT cron.schedule(
  'credentialing-directory-monitor-daily',
  '30 2 * * *',
  $$SELECT private.invoke_credentialing_maintenance('credentialing-directory-monitor');$$
);

COMMENT ON FUNCTION public.credentialing_internal_secret_valid(text) IS
  'Service-role-only validation for private scheduled credentialing Edge Functions.';
COMMENT ON FUNCTION private.invoke_credentialing_maintenance(text) IS
  'Invokes fixed credentialing maintenance functions using a Vault-managed scheduler secret.';
