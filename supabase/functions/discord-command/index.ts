import { adminClient, env } from '../_shared/runtime.ts';
import { createDiscordImportHandler } from '../_shared/discord-import-handler.ts';
import { handleDiscordSync } from '../_shared/discord-sync-handler.ts';
import { createDiscordCommandHandler, syncDiscordCommand } from '../_shared/discord-command.ts';

declare const EdgeRuntime: { waitUntil(task: Promise<unknown>): void };
const db = adminClient();
const importer = createDiscordImportHandler(env, db, userId => handleDiscordSync(new Request('https://internal/discord-sync', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId: userId, todos: [] }),
}), { id: userId }, env, db));
const rpc = async (name: string, id: string) => {
  const { data, error } = await db.rpc(name, { p_user: env('DISCORD_OWNER_USER_ID'), p_interaction: id });
  if (error) throw new Error('COMMAND_STATE_UNAVAILABLE');
  return data;
};
Deno.serve(createDiscordCommandHandler({
  env, waitUntil: task => EdgeRuntime.waitUntil(task),
  claim: id => rpc('sesasi_discord_command_claim', id),
  release: async id => { await rpc('sesasi_discord_command_release', id); },
  sync: () => syncDiscordCommand(env, importer),
}));
