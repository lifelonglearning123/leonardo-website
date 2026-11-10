/* ------------------------------------------------------------------
   GET /api/checkout?plan=…  —  Vercel serverless function

   Opens a Stripe Checkout for one of the plans below and sends the
   visitor straight to it. Every price excludes VAT; VAT (20%) is added
   on top at checkout by a Stripe tax rate, so the invoice shows it
   separately.

     plan=starter    £99 / month, plus £99 once to set it up and build it
     plan=frontdesk  £299 / month
     plan=signal     £100 / month   Signal, AI voice
     plan=gbp        £50 / month    Google Business Profile
     plan=nexus      £100 / month   Nexus CRM
     plan=show       £99 / month    Business Show 2026 bundle (the default)

   The "Who are we building for?" step saves the lead to GHL first,
   then arrives here with ?email=… so Stripe has it filled in.

   Env vars (Vercel → Project → Settings → Environment Variables,
   or .env for `vercel dev`):
     STRIPE_SECRET_KEY      required — sk_live_… / rk_live_… (sk_test_… while testing)
     STRIPE_SHOW_PRICE_ID   optional — overrides the show bundle price below
     STRIPE_VAT_RATE_ID     optional — overrides the 20% VAT rate below

   Until the key is set, or if Stripe fails, visitors are sent back to
   the site (the show pop-up, or the contact section) so the button
   never dead-ends. The lead was already saved by then.
   ------------------------------------------------------------------ */

const STRIPE_SESSIONS = 'https://api.stripe.com/v1/checkout/sessions';

/* Not secrets: IDs of objects in the live Stripe account. Stripe prices
   can't be edited, so a price change means a new price ID here. */
const UK_VAT = 'txr_1UaMsoBdqYbaDfVsgj0Z1z7D';    /* VAT 20%, added on top */

const PLANS = {
  starter:   { prices: ['price_1UaO3eBdqYbaDfVsIg81dlyV',    /* £99 a month */
                        'price_1UaO3xBdqYbaDfVsoiBV0KZy'] },  /* £99 once, setup and build */
  frontdesk: { prices: ['price_1UaO3fBdqYbaDfVsdOXr5d4q'] },  /* £299 a month */
  signal:    { prices: ['price_1UaO3xBdqYbaDfVssU4od94u'] },  /* £100 a month */
  gbp:       { prices: ['price_1UaO3dBdqYbaDfVsUnFhlYGx'] },  /* £50 a month */
  nexus:     { prices: ['price_1UaO3dBdqYbaDfVsRi4DYBn9'] },  /* £100 a month */
  show:      { prices: [process.env.STRIPE_SHOW_PRICE_ID || 'price_1UaMfmBdqYbaDfVseJCpyw3O'],  /* £99 a month */
               offer: 'business-show-2026', fallback: '/?bs26' }
};

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

  const q      = req.query || {};
  const name   = Object.prototype.hasOwnProperty.call(PLANS, q.plan) ? q.plan : 'show';
  const plan   = PLANS[name];
  const origin = siteOrigin(req);
  const back   = origin + (plan.fallback || '/#contact');
  const key    = process.env.STRIPE_SECRET_KEY;
  const vat    = process.env.STRIPE_VAT_RATE_ID || UK_VAT;

  if (!key) {
    console.error('[Stripe] Missing STRIPE_SECRET_KEY — sending back to the site');
    return redirect(res, back);
  }

  const email = String(q.email || '').trim().slice(0, 254);

  const form = new URLSearchParams({
    'mode': 'subscription',
    'success_url': origin + '/?offer=paid',
    'cancel_url': origin + '/#pricing',
    'billing_address_collection': 'required',
    'metadata[plan]': name,
    'subscription_data[metadata][plan]': name
  });
  plan.prices.forEach((price, i) => {
    form.set(`line_items[${i}][price]`, price);
    form.set(`line_items[${i}][quantity]`, '1');
    form.set(`line_items[${i}][tax_rates][0]`, vat);
  });
  if (plan.offer) {
    form.set('metadata[offer]', plan.offer);
    form.set('subscription_data[metadata][offer]', plan.offer);
  }
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
      console.error('[Stripe] Session failed:', name, r.status, body && body.error);
      return redirect(res, back);
    }
    return redirect(res, body.url);
  } catch (err) {
    console.error('[Stripe] Request error:', err);
    return redirect(res, back);
  }
};
