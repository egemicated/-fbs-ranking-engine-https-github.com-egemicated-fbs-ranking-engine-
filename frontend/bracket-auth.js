const libraryUrl = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js';
const libraryIntegrity = 'sha384-uteMfOloLDGt042uDz+xHGF3ym63/WQ6rFq7murQRG8Ih7QrXGEGNtWd8688sb4O';
let clientRequest;

export async function googleSignInEnabled({ url, publishableKey }) {
  try {
    const response = await fetch(new URL('/auth/v1/settings', url), {
      headers: { apikey: publishableKey }, signal: AbortSignal.timeout(8_000)
    });
    return response.ok && (await response.json()).external?.google === true;
  } catch {
    return false;
  }
}

export function loadBracketClient({ url, publishableKey }) {
  clientRequest ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = libraryUrl;
    script.integrity = libraryIntegrity;
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      try {
        resolve(window.supabase.createClient(url, publishableKey, {
          auth: { flowType: 'pkce', detectSessionInUrl: true }
        }));
      } catch (error) { reject(error); }
    };
    script.onerror = () => reject(new Error('The bracket sign-in library did not load'));
    document.head.append(script);
  }).catch(error => {
    clientRequest = undefined;
    throw error;
  });
  return clientRequest;
}
