-- The server-only Discord snapshot RPC is security invoker: grant its service
-- role read access explicitly. Browser roles remain restricted by RLS.
grant select on public.sesasi_records to service_role;
