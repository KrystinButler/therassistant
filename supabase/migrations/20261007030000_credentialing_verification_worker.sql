-- Server-only queue access for the credentialing verification Edge Function.
-- These RPCs are intentionally not available to anon/authenticated users.

CREATE OR REPLACE FUNCTION public.credentialing_worker_read_message()
RETURNS TABLE (
  msg_id bigint,
  read_ct bigint,
  enqueued_at timestamptz,
  vt timestamptz,
  message jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pgmq, public, pg_temp
AS $$
  SELECT q.msg_id, q.read_ct, q.enqueued_at, q.vt, q.message
  FROM pgmq.read('credentialing_participation_verification', 120, 1) q;
$$;

CREATE OR REPLACE FUNCTION public.credentialing_worker_archive_message(p_msg_id bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pgmq, public, pg_temp
AS $$
  SELECT pgmq.archive('credentialing_participation_verification', p_msg_id);
$$;

CREATE OR REPLACE FUNCTION public.credentialing_worker_retry_message(
  p_msg_id bigint,
  p_delay_seconds integer DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pgmq, public, pg_temp
AS $$
DECLARE
  v_message jsonb;
BEGIN
  SELECT q.message INTO v_message
  FROM pgmq.q_credentialing_participation_verification q
  WHERE q.msg_id = p_msg_id;

  IF v_message IS NULL THEN
    RETURN false;
  END IF;

  PERFORM pgmq.archive('credentialing_participation_verification', p_msg_id);
  PERFORM pgmq.send(
    'credentialing_participation_verification',
    v_message,
    GREATEST(0, LEAST(COALESCE(p_delay_seconds, 60), 3600))
  );
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.credentialing_worker_read_message() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.credentialing_worker_archive_message(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.credentialing_worker_retry_message(bigint, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.credentialing_worker_read_message() TO service_role;
GRANT EXECUTE ON FUNCTION public.credentialing_worker_archive_message(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.credentialing_worker_retry_message(bigint, integer) TO service_role;

COMMENT ON FUNCTION public.credentialing_worker_read_message() IS
  'Service-role-only queue read for automated credentialing verification.';
COMMENT ON FUNCTION public.credentialing_worker_archive_message(bigint) IS
  'Service-role-only terminal archive for automated credentialing verification.';
COMMENT ON FUNCTION public.credentialing_worker_retry_message(bigint, integer) IS
  'Service-role-only bounded retry helper for automated credentialing verification.';
