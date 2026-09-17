revoke delete, truncate on all tables in schema public from anon;
alter default privileges in schema public revoke delete, truncate on tables from anon;
