-- Short-lived command receipts prevent Discord retries and overlapping commands
-- from importing the same source concurrently. No token or memo content is kept.
create table private.sesasi_discord_commands (
  interaction_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz
);
alter table private.sesasi_discord_commands enable row level security;
revoke all on private.sesasi_discord_commands from public, anon, authenticated;

create function public.sesasi_discord_command_claim(p_user uuid, p_interaction text) returns text
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 315));
  delete from private.sesasi_discord_commands where started_at < clock_timestamp() - interval '1 day';
  if exists (select 1 from private.sesasi_discord_commands where interaction_id=p_interaction) then return 'duplicate'; end if;
  if exists (select 1 from private.sesasi_discord_commands where user_id=p_user and finished_at is null and started_at > clock_timestamp() - interval '150 seconds') then return 'busy'; end if;
  insert into private.sesasi_discord_commands(interaction_id,user_id) values(p_interaction,p_user);
  return 'acquired';
end;
$$;
create function public.sesasi_discord_command_release(p_user uuid, p_interaction text) returns void
language sql security definer set search_path = '' as $$
  update private.sesasi_discord_commands set finished_at=clock_timestamp() where user_id=p_user and interaction_id=p_interaction;
$$;
revoke all on function public.sesasi_discord_command_claim(uuid,text), public.sesasi_discord_command_release(uuid,text) from public, anon, authenticated;
grant execute on function public.sesasi_discord_command_claim(uuid,text), public.sesasi_discord_command_release(uuid,text) to service_role;
