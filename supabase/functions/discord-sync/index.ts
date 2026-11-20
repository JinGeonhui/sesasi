import { adminClient, authenticate, env } from '../_shared/runtime.ts';
import { protectedHandler } from '../_shared/http.ts';
import { handleDiscordSync } from '../_shared/discord-sync-handler.ts';

Deno.serve(protectedHandler(env, authenticate, (req, user) => handleDiscordSync(req, user, env, adminClient())));
