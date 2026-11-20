import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { bridgeConfig, bridgeRequest, createBridge } from './bridge.mjs';

let config;
try { config = bridgeConfig(process.env); }
catch (error) { console.error(error.message); process.exit(1); }
if (process.argv.includes('--check')) {
  console.log('Bot settings are valid. No connection or message was sent.');
  process.exit(0);
}
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent], partials: [Partials.Message, Partials.Channel] });
const bridge = createBridge({ config, request: bridgeRequest(config), fetchPage: async before => {
  const channel = await client.channels.fetch(config.channelId);
  if (!channel || channel.guildId !== config.guildId || channel.type !== 0) throw new Error('CHANNEL_DENIED');
  return [...(await channel.messages.fetch({ limit: 100, before, cache: false })).values()];
}, report: (id, code) => console.error(`Discord import ${id}: ${code}`) });
const failed = () => console.error('Discord bridge operation failed; the next scan will retry.');
const receive = async message => {
  if (message.channelId !== config.channelId) return;
  try { await bridge.onMessage(message.partial ? await message.fetch() : message); } catch { failed(); }
};
client.on(Events.MessageCreate, receive);
client.on(Events.MessageUpdate, (_, message) => void receive(message));
client.on(Events.MessageDelete, message => void bridge.onDelete(message).catch(failed));
client.on(Events.MessageBulkDelete, messages => { for (const message of messages.values()) void bridge.onDelete(message).catch(failed); });
client.on(Events.Error, failed);
client.on(Events.ShardResume, () => void bridge.scan().catch(failed));
const timers = [];
client.once(Events.ClientReady, () => {
  console.log('Discord bridge connected. Source messages are never edited by this bot.');
  void bridge.scan().catch(failed);
  timers.push(setInterval(() => void bridge.scan().catch(failed), 60000));
  timers.push(setInterval(() => void bridge.flush().catch(failed), 15000));
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  timers.forEach(clearInterval);
  await client.destroy();
  await bridge.drain();
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
client.login(config.token).catch(() => { console.error('Discord bot login failed. Check the bot token and Message Content Intent.'); process.exitCode = 1; void stop(); });
