-- 09 Push notifications: server-side push via a DB webhook → Edge Function.
--
-- Every UPDATE on `matches` posts its old/new row (secrets stripped) to the
-- `push` Edge Function through pg_net; the function's pure, jest-tested
-- derivation decides which of the PRD's notified events the transition is
-- (your turn / answer needed, game ended, party joined, claim available) and
-- who the correct recipient is, then sends via the Expo push API. Chat can
-- never ping anyone by construction: nothing fires on `match_events` inserts —
-- a question's notification is the phase change it causes on `matches`.
--
-- Authenticity: the trigger sends an `x-push-secret` header whose value is
-- minted randomly below straight into Vault (it never appears in this file or
-- the repo). The Edge Function reads the same secret back through the
-- service-role-only `get_push_webhook_secret` RPC and rejects mismatches, so
-- clients holding the anon key cannot forge notifications.
--
-- Claim-available is time-based, so it can't come from a row change on its
-- own: an hourly pg_cron scan flags active matches idle for 7+ days by setting
-- `claim_notified` — that UPDATE rides the same webhook, and the flag resets
-- whenever the match sees real activity so a re-stalled game notifies again.

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- One-shot flag: has the current stall already produced a claim notification?
-- Not granted to clients (their SELECT on matches is column-explicit); the
-- claim countdown in Issue 10 derives from last_activity_at, not this.
alter table public.matches
  add column claim_notified boolean not null default false;

-- Mint the shared webhook secret directly into Vault.
select vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'hex'),
  'push_webhook_secret'
);

-- The Edge Function's side of the handshake. Vault isn't exposed over
-- PostgREST, so the function (holding the service-role key) reads the secret
-- through this RPC; nobody else may execute it.
create or replace function public.get_push_webhook_secret()
returns text
language sql
security definer
set search_path = public
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'push_webhook_secret';
$$;

revoke execute on function public.get_push_webhook_secret() from public, anon, authenticated;
grant execute on function public.get_push_webhook_secret() to service_role;

-- The webhook itself. pg_net queues the request asynchronously, so a game
-- write can never fail or slow down because the push pipeline is down. The
-- secret columns are stripped before the row leaves Postgres — the Edge
-- Function never needs them (the drawn flags carry the draw progress).
create or replace function public.notify_match_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  secret text;
begin
  select decrypted_secret into secret
  from vault.decrypted_secrets
  where name = 'push_webhook_secret';

  perform net.http_post(
    url := 'https://azaemyxdzapolhqmcwpq.supabase.co/functions/v1/push',
    body := jsonb_build_object(
      'type', tg_op,
      'table', tg_table_name,
      'record', to_jsonb(new) - 'player1_secret' - 'player2_secret',
      'old_record', to_jsonb(old) - 'player1_secret' - 'player2_secret'
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', secret
    ),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

revoke execute on function public.notify_match_change() from public, anon, authenticated;

create trigger matches_notify_push
  after update on public.matches
  for each row
  execute function public.notify_match_change();

-- A real move re-arms the claim notification for any future stall. Keyed on
-- last_activity_at (every gameplay RPC bumps it); the cron flag-set below
-- deliberately does NOT touch last_activity_at, so it never un-flags itself.
create or replace function public.reset_claim_notified()
returns trigger
language plpgsql
as $$
begin
  new.claim_notified := false;
  return new;
end;
$$;

revoke execute on function public.reset_claim_notified() from public, anon, authenticated;

create trigger matches_reset_claim_notified
  before update on public.matches
  for each row
  when (old.last_activity_at is distinct from new.last_activity_at and old.claim_notified)
  execute function public.reset_claim_notified();

-- Hourly scan: flag active games whose player-to-move is 7+ days idle. The
-- flag flip fires matches_notify_push, whose derivation picks the *waiting*
-- player as the recipient. Precision to the hour is plenty for a 7-day window.
select cron.schedule(
  'notify-claimable-matches',
  '17 * * * *',
  $cron$
    update public.matches
    set claim_notified = true
    where status = 'active'
      and player2_id is not null
      and claim_notified = false
      and last_activity_at < now() - interval '7 days'
  $cron$
);
