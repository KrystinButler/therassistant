-- Keep local, preview, and production storage configuration aligned.
-- The policies on storage.objects cannot work until the corresponding buckets exist.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('therassistant-documents', 'therassistant-documents', false, 52428800,
   array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/csv',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[]),
  ('claim-edis', 'claim-edis', false, 10485760,
   array['text/plain', 'application/octet-stream']::text[])
on conflict (id) do update
  set public = false;
