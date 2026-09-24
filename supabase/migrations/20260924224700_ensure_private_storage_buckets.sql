-- Keep local, preview, and production storage configuration aligned.
-- The policies on storage.objects cannot work until the corresponding buckets exist.
insert into storage.buckets (id, name, public, file_size_limit)
values
  ('therassistant-documents', 'therassistant-documents', false, 52428800),
  ('claim-edis', 'claim-edis', false, 10485760)
on conflict (id) do update
  set public = false;
