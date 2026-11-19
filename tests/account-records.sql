-- Run inside a transaction with the migration applied. No fixture is retained.
insert into auth.users (id) values ('11111111-0000-0000-0000-000000000001'), ('11111111-0000-0000-0000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-000000000001', true);
select public.sesasi_record_save('entries','test','{"kind":"todo","title":"original"}',0);
select public.sesasi_records_import('entries','[{"key":"test","value":{"title":"must not replace"}}]');
do $$ begin
  if (public.sesasi_records_list('entries')->0->'value'->>'title') <> 'original' then raise exception 'Import overwrote server record'; end if;
end $$;
select public.sesasi_record_save('entries','test','{"title":"second device"}',1);
do $$ begin
  begin
    perform public.sesasi_record_save('entries','test','{"title":"stale"}',1);
    raise exception 'Conflict was not rejected';
  exception when raise_exception then
    if sqlerrm <> 'RECORD_CONFLICT' then raise; end if;
  end;
end $$;
select public.sesasi_record_save('entries','test',null,2);
select public.sesasi_records_import('entries','[{"key":"test","value":{"title":"resurrect"}}]');
do $$ begin
  if (public.sesasi_records_list('entries')->0->'value') <> 'null'::jsonb then raise exception 'Tombstone resurrected'; end if;
end $$;
select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-000000000002', true);
do $$ begin
  if public.sesasi_records_list('entries') <> '[]'::jsonb then raise exception 'Cross-account data leak'; end if;
  begin
    update public.sesasi_records set value = '{}' where user_id = '11111111-0000-0000-0000-000000000001';
    if found then raise exception 'Cross-account update'; end if;
  end;
end $$;
select public.sesasi_record_save('entries','test','{"title":"other account"}',0);
select public.sesasi_records_import('entries', (select jsonb_agg(jsonb_build_object('key','bulk-' || n,'value',n)) from generate_series(1,1100) n));
do $$ begin
  if jsonb_array_length(public.sesasi_records_list('entries')) <> 1101 then raise exception 'List truncated'; end if;
end $$;
set local role anon;
do $$ begin
  begin
    perform public.sesasi_records_list('entries');
    raise exception 'Anonymous read allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.sesasi_record_save('entries','test','{}',0);
    raise exception 'Anonymous write allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role service_role;
do $$ begin
  if jsonb_array_length(public.sesasi_discord_records('11111111-0000-0000-0000-000000000002')->'entries') <> 1101 then raise exception 'Server integration snapshot unavailable'; end if;
end $$;
reset role;
select 'account isolation, CAS, migration idempotence, tombstones, pagination, anonymous denial passed' as result;
