// Push notification sender. Invoked by the `matches_notify_push` DB trigger
// (migration 00009) with the old/new row of every `matches` UPDATE, it derives
// which notifications the transition warrants (derive.ts — the pure, tested
// logic), resolves the recipients' Expo push tokens from `profiles`, and sends
// via the Expo push API.
//
// Auth: deployed with verify_jwt=false because pg_net cannot mint a Supabase
// JWT. Instead the trigger sends the `x-push-secret` header, whose value lives
// only in Vault (minted randomly by the migration); we verify it against the
// same secret read back through the service-role-only `get_push_webhook_secret`
// RPC. Requests without it are rejected, so clients can't forge notifications.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

import {
  deriveNotifications,
  MatchWebhookRow,
  NameMap,
  toExpoMessages,
} from './derive.ts';

type WebhookPayload = {
  type: string;
  table: string;
  record: MatchWebhookRow;
  old_record: MatchWebhookRow;
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

let cachedSecret: string | null = null;
async function webhookSecret(): Promise<string> {
  if (cachedSecret === null) {
    const { data, error } = await supabase.rpc('get_push_webhook_secret');
    if (error) throw new Error(`could not load webhook secret: ${error.message}`);
    cachedSecret = data as string;
  }
  return cachedSecret;
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const provided = req.headers.get('x-push-secret');
  if (!provided || provided !== (await webhookSecret())) {
    return json({ error: 'unauthorized' }, 401);
  }

  const payload = (await req.json()) as WebhookPayload;
  if (payload.table !== 'matches' || payload.type !== 'UPDATE') {
    return json({ sent: 0, ignored: true });
  }

  // Most updates (asks that only move the phase for the actor, activity bumps)
  // warrant nothing — check before touching the database at all.
  if (deriveNotifications(payload.old_record, payload.record).length === 0) {
    return json({ sent: 0 });
  }

  const after = payload.record;
  const playerIds = [after.player1_id, after.player2_id].filter(
    (id): id is string => Boolean(id),
  );
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('clerk_id, username, expo_push_token')
    .in('clerk_id', playerIds);
  if (error) return json({ error: error.message }, 500);

  const names: NameMap = {};
  const tokens: Record<string, string | null> = {};
  for (const p of profiles ?? []) {
    names[p.clerk_id] = p.username;
    tokens[p.clerk_id] = p.expo_push_token;
  }

  const messages = deriveNotifications(payload.old_record, after, names);
  const expoMessages = toExpoMessages(messages, tokens);
  console.log(
    `match ${after.id}: derived [${messages.map((m) => m.kind).join(', ')}], ` +
      `${expoMessages.length} deliverable`,
  );
  if (expoMessages.length === 0) return json({ sent: 0, derived: messages.length });

  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(expoMessages),
  });
  if (!res.ok) {
    console.error(`expo push send failed: ${res.status} ${await res.text()}`);
    return json({ sent: 0, expoStatus: res.status }, 502);
  }
  return json({ sent: expoMessages.length });
});
