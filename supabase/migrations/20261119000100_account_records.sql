-- All application records belong to the authenticated account. Deleted rows remain
-- as tombstones so an old browser import cannot resurrect them.
create table public.sesasi_records (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  collection text not null check (collection in ('entries', 'categories', 'preferences', 'archive')),
  key text not null check (length(key) between 1 and 200),
  value jsonb,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, collection, key)
);
alter table public.sesasi_records enable row level security;
revoke all on public.sesasi_records from public, anon, authenticated;
grant select, insert, update on public.sesasi_records to authenticated;
create policy account_records on public.sesasi_records for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create function public.sesasi_records_list(p_collection text) returns jsonb
language sql security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'value', value, 'revision', revision) order by key), '[]'::jsonb)
  from public.sesasi_records where user_id = auth.uid() and collection = p_collection;
$$;

-- Compare-and-swap prevents a stale tab from overwriting another device's edits.
create function public.sesasi_record_save(p_collection text, p_key text, p_value jsonb, p_revision bigint) returns bigint
language plpgsql security invoker set search_path = '' as $$
declare next_revision bigint;
begin
  if auth.uid() is null then raise exception 'LOGIN_REQUIRED'; end if;
  if p_revision = 0 then
    insert into public.sesasi_records (collection, key, value) values (p_collection, p_key, p_value)
      on conflict do nothing returning revision into next_revision;
  else
    update public.sesasi_records set value = p_value, revision = revision + 1, updated_at = clock_timestamp()
      where user_id = auth.uid() and collection = p_collection and key = p_key and revision = p_revision
      returning revision into next_revision;
  end if;
  if next_revision is null then raise exception 'RECORD_CONFLICT'; end if;
  return next_revision;
end;
$$;

-- Import is idempotent and never replaces server data (including tombstones).
create function public.sesasi_records_import(p_collection text, p_records jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'LOGIN_REQUIRED'; end if;
  insert into public.sesasi_records (collection, key, value)
    select p_collection, item->>'key', item->'value' from jsonb_array_elements(p_records) item
    on conflict do nothing;
end;
$$;
revoke all on function public.sesasi_records_list(text), public.sesasi_record_save(text,text,jsonb,bigint), public.sesasi_records_import(text,jsonb) from public, anon;
grant execute on function public.sesasi_records_list(text), public.sesasi_record_save(text,text,jsonb,bigint), public.sesasi_records_import(text,jsonb) to authenticated;

-- One complete snapshot for the server's existing Discord integration.
create function public.sesasi_discord_records(p_user uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  select jsonb_build_object(
    'entries', coalesce(jsonb_agg(value) filter (where collection = 'entries' and value is not null), '[]'::jsonb),
    'categories', coalesce(jsonb_object_agg(key, value) filter (where collection = 'categories'), '{}'::jsonb)
  ) from public.sesasi_records where user_id = p_user;
$$;
revoke all on function public.sesasi_discord_records(uuid) from public, anon, authenticated;
grant execute on function public.sesasi_discord_records(uuid) to service_role;
