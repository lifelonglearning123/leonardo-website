/* ------------------------------------------------------------------
   GET /api/checkout  —  Vercel serverless function

   The Business Show 2026 offer: Signal, Nexus and Google Business
   Profile for £99 a month, for life. Opens a Stripe Checkout for that
   subscription and sends the visitor straight to it.

   The "Who are we building for?" step saves the lead to GHL first,
   then arrives here with ?email=… so Stripe has it filled in.

   Required env vars (Vercel → Project → Settings → Environment Variables,
   or .env for `vercel dev`):
     STRIPE_SECRET_KEY      sk_live_… (or sk_test_… while testing)
     STRIPE_SHOW_PRICE_ID   price_… — the £99/month recurring price

   Until both are set, visitors are sent to the show pop-up instead,
   so the button never dead-ends and the lead is still captured.
   ------------------------------------------------------------------ */

const STRIPE_SESSIONS = 'https://api.stripe.com/v1/checkout/sessions';
const OFFER = 'business-show-2026';

function siteOrigin(req) {
  const host  = req.headers['x-forwarded-host'] || req.headers.host || 'leonardopower.com';
  const proto = req.headers['x-forwarded-proto'] || (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto.split(',')[0]}://${host}`;
}

function redirect(res, url) {
  res.statusCode = 303;
  res.setHeader('Location', url);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const origin = siteOrigin(req);
  const key    = process.env.STRIPE_SECRET_KEY;
  const price  = process.env.STRIPE_SHOW_PRICE_ID;

  if (!key || !price) {
    console.error('[Stripe] Missing STRIPE_SECRET_KEY or STRIPE_SHOW_PRICE_ID — sending to the pop-up');
    return redirect(res, origin + '/?bs26');
  }

  const email = String((req.query && req.query.email) || '').trim().slice(0, 254);

  const form = new URLSearchParams({
    'mode': 'subscription',
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    'success_url': origin + '/?offer=paid',
    'cancel_url': origin + '/',
    'billing_address_collection': 'required',
    'metadata[offer]': OFFER,
    'subscription_data[metadata][offer]': OFFER
  });
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) form.set('customer_email', email);

  try {
    const r = await fetch(STRIPE_SESSIONS, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form.toString()
    });
    const body = await r.json().catch(() => ({}));

    if (!r.ok || !body.url) {
      /* Detail stays in the server log, never in the browser. */
      console.error('[Stripe] Session failed:', r.status, body && body.error);
      return redirect(res, origin + '/?bs26');
    }
    return redirect(res, body.url);
  } catch (err) {
    console.error('[Stripe] Request error:', err);
    return redirect(res, origin + '/?bs26');
  }
};
