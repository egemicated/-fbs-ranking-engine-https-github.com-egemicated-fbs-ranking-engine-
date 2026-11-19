// A saved request is durable even when an optional email notification fails.
export async function notifySupportIfReady(client, config = {}) {
  if (config.supportNotificationsEnabled !== true) return { enabled:false, notified:false };
  try {
    const result = await client.functions.invoke('account-support',{body:{action:'notify'}});
    return { enabled:true, notified:!result.error && result.data?.accepted === true && result.data?.delivery !== 'retry_pending' };
  } catch { return { enabled:true, notified:false }; }
}
