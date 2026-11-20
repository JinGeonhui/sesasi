import { adminClient, env } from '../_shared/runtime.ts';
import { createDiscordImportHandler } from '../_shared/discord-import-handler.ts';
import { handleDiscordSync } from '../_shared/discord-sync-handler.ts';

const db = adminClient();
Deno.serve(createDiscordImportHandler(env, db, userId => handleDiscordSync(new Request('https://internal/discord-sync', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId: userId, todos: [] }),
}), { id: userId }, env, db)));
