-- Server-only durable state. No browser role can read memos or message IDs.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.sesasi_discord (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  lease_token uuid,
  lease_until timestamptz not null default '-infinity',
  updated_at timestamptz not null default now()
);
alter table private.sesasi_discord enable row level security;
revoke all on private.sesasi_discord from public, anon, authenticated;

create function public.sesasi_discord_read(p_user uuid) returns jsonb
language sql security definer set search_path = '' as $$
  select state from private.sesasi_discord where user_id = p_user;
$$;
create function public.sesasi_discord_acquire(p_user uuid, p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare snapshot jsonb;
begin
  insert into private.sesasi_discord (user_id) values (p_user) on conflict do nothing;
  update private.sesasi_discord set lease_token = p_token, lease_until = clock_timestamp() + interval '120 seconds'
  where user_id = p_user and lease_until < clock_timestamp() returning state into snapshot;
  return snapshot;
end;
$$;
create function public.sesasi_discord_save(p_user uuid, p_token uuid, p_state jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update private.sesasi_discord set state = p_state, updated_at = clock_timestamp()
  where user_id = p_user and lease_token = p_token and lease_until > clock_timestamp();
  return found;
end;
$$;
create function public.sesasi_discord_release(p_user uuid, p_token uuid) returns void
language sql security definer set search_path = '' as $$
  update private.sesasi_discord set lease_token = null, lease_until = '-infinity'
  where user_id = p_user and lease_token = p_token;
$$;
revoke all on function public.sesasi_discord_read(uuid) from public, anon, authenticated;
revoke all on function public.sesasi_discord_acquire(uuid, uuid) from public, anon, authenticated;
revoke all on function public.sesasi_discord_save(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.sesasi_discord_release(uuid, uuid) from public, anon, authenticated;
grant execute on function public.sesasi_discord_read(uuid) to service_role;
grant execute on function public.sesasi_discord_acquire(uuid, uuid) to service_role;
grant execute on function public.sesasi_discord_save(uuid, uuid, jsonb) to service_role;
grant execute on function public.sesasi_discord_release(uuid, uuid) to service_role;
