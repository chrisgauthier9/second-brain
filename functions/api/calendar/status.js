import { jsonResponse } from '../../_lib.js';

export async function onRequest(context) {
  const { env } = context;
  const refreshToken = await env.SECOND_BRAIN_KV.get('google_refresh_token');
  return jsonResponse({
    connected: !!refreshToken,
    kv_bound: !!env.SECOND_BRAIN_KV,
    client_id_set: !!env.GOOGLE_CLIENT_ID
  });
}
