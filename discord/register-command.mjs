import { writeFileSync } from 'node:fs';
import { REST, Routes } from 'discord.js';

// Credentials stay in the ignored env file; never print Discord API error bodies.
async function main() {
  const token = process.env.DISCORD_BOT_TOKEN, guild = process.env.DISCORD_GUILD_ID;
  const origin = new URL(process.env.SUPABASE_URL);
  if (!token || !/^\d{17,20}$/.test(guild ?? '') || origin.protocol !== 'https:' || !origin.hostname.endsWith('.supabase.co')) throw new Error('Invalid settings');
  const rest = new REST({ version: '10' }).setToken(token);
  const app = await rest.get(Routes.currentApplication());
  if (!/^[a-f\d]{64}$/i.test(app.verify_key)) throw new Error('Missing public key');
  if (process.argv.includes('--prepare')) {
    writeFileSync('.env.discord-command.local', `DISCORD_APPLICATION_ID=${app.id}\nDISCORD_APPLICATION_PUBLIC_KEY=${app.verify_key}\n`, { mode: 0o600 });
    console.log('Prepared application verification settings in .env.discord-command.local.');
    return;
  }
  if (!process.argv.includes('--register')) throw new Error('Use --prepare or --register');
  const endpoint = `${origin.origin}/functions/v1/discord-command`;
  await rest.patch(Routes.currentApplication(), { body: { interactions_endpoint_url: endpoint } });
  const commands = await rest.get(Routes.applicationGuildCommands(app.id, guild));
  const existing = commands.find(command => command.name === '적용') ?? commands.find(command => command.name === '메모동기화');
  const body = {
    name: '적용', description: '이 채널에 작성한 내 메모를 서사시에 반영합니다.', type: 1,
    default_member_permissions: '0', dm_permission: false,
  };
  const command = existing
    ? await rest.patch(Routes.applicationGuildCommand(app.id, guild, existing.id), { body })
    : await rest.post(Routes.applicationGuildCommands(app.id, guild), { body });
  const updated = await rest.get(Routes.currentApplication());
  console.log(JSON.stringify({ command: command.name, id: command.id, endpointVerified: updated.interactions_endpoint_url === endpoint }));
}
main().catch(error => { console.error(`Command setup failed (${Number.isInteger(error.status) ? error.status : 'check settings'}).`); process.exitCode = 1; });
