-- Discord source snapshots are private. The browser continues to access only
-- its account records through existing RLS/CAS functions.
create table private.sesasi_discord_imports (
  user_id uuid not null references auth.users(id) on delete cascade,
  channel_id text not null,
  message_id text not null,
  state jsonb not null,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, channel_id, message_id)
);
alter table private.sesasi_discord_imports enable row level security;
revoke all on private.sesasi_discord_imports from public, anon, authenticated;

create function public.sesasi_discord_import_read(p_user uuid, p_channel text, p_message text) returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'revision', coalesce((select revision from private.sesasi_discord_imports where user_id=p_user and channel_id=p_channel and message_id=p_message), 0),
    'state', (select state from private.sesasi_discord_imports where user_id=p_user and channel_id=p_channel and message_id=p_message),
    'records', coalesce((select jsonb_agg(jsonb_build_object('collection',collection,'key',key,'value',value,'revision',revision)) from public.sesasi_records where user_id=p_user and collection in ('entries','categories')), '[]'::jsonb),
    'boundIds', coalesce((select jsonb_agg(row->>'id') from private.sesasi_discord_imports s cross join lateral jsonb_array_elements(s.state->'rows') row where s.user_id=p_user), '[]'::jsonb)
  );
$$;

create function public.sesasi_discord_import_list(p_user uuid, p_channel text) returns jsonb
language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(message_id), '[]'::jsonb) from private.sesasi_discord_imports
  where user_id=p_user and channel_id=p_channel and not (state->>'deleted')::boolean;
$$;

-- All source lines and category changes commit together. An app edit occurring
-- between read and commit aborts the entire message, including its import state.
create function public.sesasi_discord_import_commit(p_user uuid, p_channel text, p_message text, p_revision bigint, p_state jsonb, p_changes jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare current_revision bigint; item jsonb; changed bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 314));
  select revision into current_revision from private.sesasi_discord_imports
    where user_id=p_user and channel_id=p_channel and message_id=p_message for update;
  if coalesce(current_revision,0) <> p_revision then raise exception 'RECORD_CONFLICT'; end if;
  if jsonb_typeof(p_state->'rows') <> 'array' or jsonb_array_length(p_changes) > 400 then raise exception 'INVALID_IMPORT'; end if;
  if exists (
    select 1 from private.sesasi_discord_imports s
    cross join lateral jsonb_array_elements(s.state->'rows') existing
    cross join lateral jsonb_array_elements(p_state->'rows') incoming
    where s.user_id=p_user and (s.channel_id<>p_channel or s.message_id<>p_message)
      and existing->>'id'=incoming->>'id'
  ) then raise exception 'RECORD_CONFLICT'; end if;
  for item in select value from jsonb_array_elements(p_changes) loop
    if item->>'collection' not in ('entries','categories') then raise exception 'INVALID_IMPORT'; end if;
    changed := null;
    if (item->>'revision')::bigint = 0 then
      insert into public.sesasi_records(user_id,collection,key,value)
        values(p_user,item->>'collection',item->>'key',nullif(item->'value','null'::jsonb))
        on conflict do nothing returning revision into changed;
    else
      update public.sesasi_records set value=nullif(item->'value','null'::jsonb), revision=revision+1, updated_at=clock_timestamp()
        where user_id=p_user and collection=item->>'collection' and key=item->>'key' and revision=(item->>'revision')::bigint
        returning revision into changed;
    end if;
    if changed is null then raise exception 'RECORD_CONFLICT'; end if;
  end loop;
  insert into private.sesasi_discord_imports(user_id,channel_id,message_id,state)
    values(p_user,p_channel,p_message,p_state)
    on conflict(user_id,channel_id,message_id) do update set state=excluded.state,
      revision=private.sesasi_discord_imports.revision+1, updated_at=clock_timestamp();
end;
$$;
revoke all on function public.sesasi_discord_import_read(uuid,text,text), public.sesasi_discord_import_list(uuid,text), public.sesasi_discord_import_commit(uuid,text,text,bigint,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.sesasi_discord_import_read(uuid,text,text), public.sesasi_discord_import_list(uuid,text), public.sesasi_discord_import_commit(uuid,text,text,bigint,jsonb,jsonb) to service_role;
