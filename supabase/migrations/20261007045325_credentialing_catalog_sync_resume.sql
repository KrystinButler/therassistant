-- Bound payer catalog synchronization to short, resumable Edge Function runs.
-- Cigna's public Plan-Net catalog is national and cannot be safely traversed in
-- one pg_net invocation. Persist the next page cursor and progress so scheduled
-- invocations can continue without duplicating plan/network rows.

ALTER TABLE public.payer_catalog_syncs
  ADD COLUMN IF NOT EXISTS next_cursor_url text,
  ADD COLUMN IF NOT EXISTS pages_processed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_progress_at timestamptz;

DO $$
BEGIN
  ALTER TABLE public.payer_catalog_syncs
    ADD CONSTRAINT payer_catalog_syncs_pages_processed_check
    CHECK (pages_processed >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE INDEX IF NOT EXISTS payer_catalog_syncs_active_progress_idx
  ON public.payer_catalog_syncs(payer_id, status, started_at DESC);

COMMENT ON COLUMN public.payer_catalog_syncs.next_cursor_url IS
  'Opaque source continuation URL for bounded catalog synchronization. Never exposed as credentialing participation evidence.';
COMMENT ON COLUMN public.payer_catalog_syncs.pages_processed IS
  'Number of source pages durably processed for this catalog synchronization run.';
COMMENT ON COLUMN public.payer_catalog_syncs.last_progress_at IS
  'Last durable page checkpoint. Used to avoid concurrent continuation and recover interrupted invocations.';

-- Continue an unfinished catalog every 15 minutes. The Edge Function applies a
-- successful-refresh freshness guard, so completed daily catalogs cause these
-- invocations to return without starting another sync.
DO $$
DECLARE
  v_jobid bigint;
BEGIN
  FOR v_jobid IN
    SELECT jobid
    FROM cron.job
    WHERE jobname IN (
      'credentialing-catalog-sync-nightly',
      'credentialing-catalog-sync-continuation'
    )
  LOOP
    PERFORM cron.unschedule(v_jobid);
  END LOOP;
END
$$;

SELECT cron.schedule(
  'credentialing-catalog-sync-continuation',
  '*/15 * * * *',
  $$SELECT private.invoke_credentialing_maintenance('credentialing-catalog-sync');$$
);
