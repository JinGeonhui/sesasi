begin;
do $$
declare
  u uuid := gen_random_uuid(); a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  value jsonb;
begin
  if has_function_privilege('anon', 'public.sesasi_discord_read(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.sesasi_discord_acquire(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.sesasi_discord_save(uuid,uuid,jsonb)', 'execute')
     or has_function_privilege('anon', 'public.sesasi_discord_release(uuid,uuid)', 'execute') then
    raise exception 'Browser role can access private synchronization state';
  end if;
  if not (select relrowsecurity from pg_class where oid='private.sesasi_discord'::regclass) then raise exception 'RLS missing'; end if;
  insert into auth.users (id) values (u);
  value := public.sesasi_discord_acquire(u, a);
  if value is null then raise exception 'Cannot acquire initial lease'; end if;
  if public.sesasi_discord_acquire(u, b) is not null then raise exception 'Concurrent lease was allowed'; end if;
  if public.sesasi_discord_save(u, b, '{"test": "bad"}') then raise exception 'Wrong fencing token was accepted'; end if;
  if not public.sesasi_discord_save(u, a, '{"test": "saved"}') then raise exception 'Valid lease cannot save'; end if;
  if public.sesasi_discord_read(u)->>'test' <> 'saved' then raise exception 'State was not persisted'; end if;
  perform public.sesasi_discord_release(u, b);
  if public.sesasi_discord_acquire(u, b) is not null then raise exception 'Wrong token released lease'; end if;
  perform public.sesasi_discord_release(u, a);
  if public.sesasi_discord_acquire(u, b) is null then raise exception 'Released lease cannot be acquired'; end if;
  if public.sesasi_discord_save(u, a, '{}') then raise exception 'Old worker may overwrite new state'; end if;
end $$;
rollback;
