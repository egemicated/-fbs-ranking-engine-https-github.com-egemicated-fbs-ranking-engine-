// Optional retry on the existing refresh schedule. Never fetches CFBD or reads user rows.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export async function dispatchSupportNotifications({ env = process.env, fetcher = fetch } = {}) {
  const secret = env.SUPPORT_DISPATCH_SECRET;
  if (!secret) return { configured: false, message: 'Email notifications are not configured; requests remain in the private queue.' };
  if (secret.length < 32 || secret.length > 512) throw Error('Invalid support dispatch configuration');
  const url = new URL(env.ACCOUNT_SUPPORT_URL || 'https://egxyfyorggwnrnmirrax.supabase.co/functions/v1/account-support');
  if (url.origin !== 'https://egxyfyorggwnrnmirrax.supabase.co' || url.pathname !== '/functions/v1/account-support' || url.search || url.hash) throw Error('Unexpected support dispatch destination');
  const response = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-support-dispatch-secret': secret },
    body: JSON.stringify({ action: 'dispatch' }), signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw Error(`Support dispatch unavailable (HTTP ${response.status}); private requests are retained`);
  const result = await response.json();
  if (result.accepted !== true || !['processed', 'retry_pending'].includes(result.delivery)) throw Error('Invalid support delivery acknowledgement');
  return { configured: true, delivery: result.delivery };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await dispatchSupportNotifications())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
