import { createSupportHandler } from '../_shared/support-handler.mjs';

// verify_jwt may be false at the gateway because the handler independently
// validates signed-in callers, dispatch secrets or a verified public CAPTCHA.
// No public path can read the queue or obtain server credentials.
Deno.serve(createSupportHandler(Deno.env.toObject()));
