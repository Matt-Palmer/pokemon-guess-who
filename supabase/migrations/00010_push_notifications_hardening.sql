-- 10 Hardening follow-ups to 00009 flagged by the security advisors.

-- pg_net was created in `public` (it is not relocatable, so no SET SCHEMA);
-- recreate it under `extensions`. Its callable objects live in the `net`
-- schema either way, and `notify_match_change` resolves net.http_post at
-- runtime, so the trigger is unaffected.
drop extension pg_net;
create extension pg_net with schema extensions;

-- Pin the search_path like every other function in this project.
alter function public.reset_claim_notified() set search_path = public;
