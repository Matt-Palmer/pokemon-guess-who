-- 13 Remove push notifications.
--
-- Tears down the server-side push pipeline added in 00009/00010: the
-- `matches` webhook trigger and its cron-driven claim scan, the functions
-- behind them, the Vault webhook secret, and the push-only `claim_notified`
-- column. The Expo client, its `push` Edge Function, and the `expo_push_token`
-- profile column are removed alongside this migration.
--
-- The inactivity-claim *game* feature (00011) is untouched: its countdown
-- derives from `last_activity_at`, never from `claim_notified`, so dropping the
-- push scaffolding leaves claiming fully functional.

-- The hourly scan that flagged idle matches for a claim-available push.
select cron.unschedule('notify-claimable-matches')
where exists (
  select 1 from cron.job where jobname = 'notify-claimable-matches'
);

-- Triggers first (they depend on the functions below).
drop trigger if exists matches_notify_push on public.matches;
drop trigger if exists matches_reset_claim_notified on public.matches;

drop function if exists public.notify_match_change();
drop function if exists public.reset_claim_notified();
drop function if exists public.get_push_webhook_secret();

-- The DB→Edge Function webhook secret minted into Vault by 00009.
delete from vault.secrets where name = 'push_webhook_secret';

-- Push-only one-shot flag; no game logic reads it.
alter table public.matches
  drop column if exists claim_notified;

-- The device push token stored per profile (00001; client-writable via the
-- 00007 grants, which are dropped automatically with the column).
alter table public.profiles
  drop column if exists expo_push_token;

-- pg_net and pg_cron were added in 00009/00010 solely for the push pipeline;
-- nothing else in the schema uses them.
drop extension if exists pg_net;
drop extension if exists pg_cron;
