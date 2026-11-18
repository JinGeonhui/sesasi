import { env, authenticate } from '../_shared/runtime.ts';
import { fields, HttpError, protectedHandler } from '../_shared/http.ts';
import { createWeatherProvider, WeatherProviderError } from '../_shared/weather-provider.ts';
const provider = createWeatherProvider();
Deno.serve(protectedHandler(env, authenticate, async req => {
  if (req.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED');
  const { kind, city } = fields(new URL(req.url), ['kind', 'city']);
  try { return Response.json(await provider.read(kind, city)); }
  catch (error) {
    if (!(error instanceof WeatherProviderError)) throw error;
    throw new HttpError(error.code === 'INVALID_REQUEST' ? 400 : error.code === 'WEATHER_RATE_LIMITED' ? 429 : error.code === 'WEATHER_TIMEOUT' ? 504 : 502, error.code, error.retryAfter);
  }
}));
