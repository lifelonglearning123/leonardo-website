/* ------------------------------------------------------------------
   POST /api/demo-call  —  the live demo callback

   The visitor tells us three things about their own business and gives
   us a number. We create the lead in GoHighLevel, then ask Retell to
   ring them with those details already in the agent's head, so the
   assistant opens by talking about THEIR trade.

   This endpoint places a real phone call and costs real money on every
   press, so it is guarded:
     · the visitor must tick a specific consent box
     · UK numbers only, validated to E.164
     · one demo call per number, ever — enforced by a tag in GHL
     · a honeypot field for bots
     · an in-memory per-IP throttle (only spans a warm instance, so it
       is a speed bump, not the real control — the per-number tag is)

   Set a hard spend cap in the Retell dashboard as well. Nothing here
   can stop a determined person cycling through numbers they own.

   Required env vars:
     GHL_LOCATION_ID    sub-account / location ID
     GHL_TOKEN          Private Integration Token (contacts.write/read)
     RETELL_API_KEY     Retell API key
     RETELL_AGENT_ID    the demo agent
     RETELL_FROM_NUMBER the Twilio number connected to Retell, E.164
   ------------------------------------------------------------------ */

const GHL_BASE    = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const RETELL_CALL = 'https://api.retellai.com/v2/create-phone-call';

const CALLED_TAG = 'demo-called';
const SOURCE     = 'leonardopower.co.uk — live demo callback';
const MAX_LEN    = 300;

/* Warm-instance throttle. Resets whenever Vercel spins a new one. */
const recent = new Map();
const IP_WINDOW_MS = 15 * 60 * 1000;
const IP_MAX = 3;

function clean(v) {
  return typeof v === 'string' ? v.trim().slice(0, MAX_LEN) : '';
}

/* UK only, and mobiles are what make the demo land. */
function toE164(raw) {
  const digits = clean(raw).replace(/[^\d+]/g, '');
  let v = digits;
  if (v.startsWith('00')) v = '+' + v.slice(2);
  else if (v.startsWith('0')) v = '+44' + v.slice(1);
  else if (v.startsWith('44')) v = '+' + v;
  else if (!v.startsWith('+')) v = '+44' + v;
  return /^\+44\d{9,10}$/.test(v) ? v : '';
}

async function ghl(path, token, { method = 'GET', body } = {}) {
  const res = await fetch(GHL_BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_VERSION,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let parsed = {};
  try { parsed = await res.json(); } catch (_) { /* empty or non-JSON */ }
  return { ok: res.ok, status: res.status, body: parsed };
}

/* One demo per number. The tag is the record of it. */
async function alreadyCalled(phone, locationId, token) {
  const q = encodeURIComponent(phone);
  const res = await ghl(`/contacts/?locationId=${locationId}&query=${q}`, token);
  if (!res.ok) {
    /* If the lookup itself fails, let the call through rather than
       block a genuine visitor — the tag still gets written below. */
    console.warn('[demo] contact lookup failed:', res.status, res.body);
    return false;
  }
  const contacts = Array.isArray(res.body.contacts) ? res.body.contacts : [];
  return contacts.some(c =>
    (c.phone || '').replace(/\D/g, '').endsWith(phone.replace(/\D/g, '').slice(-9)) &&
    (c.tags || []).includes(CALLED_TAG));
}

function buildNote(d) {
  const stamp = new Date().toLocaleString('en-GB', {
    dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/London'
  });
  return [
    'Live demo callback — ' + stamp, '',
    'Business: ' + d.business,
    'People ring them about: ' + d.calls_about, '',
    'They pressed the button on the site and asked the assistant to ring them.'
  ].join('\n');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { GHL_LOCATION_ID: locationId, GHL_TOKEN: token,
          RETELL_API_KEY: retellKey, RETELL_AGENT_ID: agentId,
          RETELL_FROM_NUMBER: fromNumber } = process.env;

  if (!locationId || !token || !retellKey || !agentId || !fromNumber) {
    console.error('[demo] missing env vars');
    return res.status(500).json({ error: 'The demo is not configured yet.' });
  }

  const data = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

  /* Bots fill the hidden field. Answer 200 so they move along. */
  if (clean(data.website)) return res.status(200).json({ ok: true });

  const name        = clean(data.name);
  const business    = clean(data.business);
  const calls_about = clean(data.calls_about);
  const phone       = toE164(data.phone);

  if (!name || !business || !calls_about) {
    return res.status(400).json({ error: 'Fill in all three boxes and we will make the call worth taking.' });
  }
  if (!phone) {
    return res.status(400).json({ error: 'That does not look like a UK number. Try it as 07… or +44…' });
  }
  if (data.consent !== true && data.consent !== 'true' && data.consent !== 'on') {
    return res.status(400).json({ error: 'Tick the box and we will ring you.' });
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const hits = (recent.get(ip) || []).filter(t => now - t < IP_WINDOW_MS);
  if (hits.length >= IP_MAX) {
    return res.status(429).json({ error: 'That is a few calls in a row. Give it fifteen minutes, or book a proper one.' });
  }
  recent.set(ip, hits.concat(now));

  try {
    if (await alreadyCalled(phone, locationId, token)) {
      return res.status(409).json({
        error: 'We have already rung that number once — that is the demo used up. Book a proper call and we will talk about your site.'
      });
    }

    const upsert = await ghl('/contacts/upsert', token, {
      method: 'POST',
      body: {
        locationId,
        firstName: name.split(/\s+/)[0],
        lastName: name.split(/\s+/).slice(1).join(' '),
        phone,
        companyName: business,
        source: SOURCE,
        country: 'GB',
        tags: ['website-lead', 'demo-callback', CALLED_TAG]
      }
    });

    if (!upsert.ok) {
      console.error('[demo] upsert failed:', upsert.status, upsert.body);
      return res.status(502).json({ error: 'We could not set the call up. Please ring us on +44 20 4572 2164.' });
    }

    const contactId = upsert.body && upsert.body.contact && upsert.body.contact.id;
    if (contactId) {
      const note = await ghl(`/contacts/${contactId}/notes`, token,
        { method: 'POST', body: { body: buildNote({ business, calls_about }) } });
      if (!note.ok) console.error('[demo] note failed:', note.status, note.body);
    }

    /* These land in the agent's prompt as {{visitor_name}} and friends. */
    const call = await fetch(RETELL_CALL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${retellKey}` },
      body: JSON.stringify({
        from_number: fromNumber,
        to_number: phone,
        override_agent_id: agentId,
        retell_llm_dynamic_variables: {
          visitor_name: name.split(/\s+/)[0],
          visitor_full_name: name,
          visitor_business: business,
          visitor_calls_about: calls_about
        },
        metadata: { source: 'leonardopower-demo', ghl_contact_id: contactId || '' }
      })
    });

    if (!call.ok) {
      const detail = await call.text();
      console.error('[demo] Retell call failed:', call.status, detail);
      /* The lead is saved either way — say so rather than pretend it worked. */
      return res.status(502).json({
        error: 'We saved your details but could not place the call. We will ring you by hand shortly.'
      });
    }

    const { call_id } = await call.json();
    return res.status(200).json({ ok: true, call_id });
  } catch (err) {
    console.error('[demo] error:', err);
    return res.status(502).json({ error: 'Something went wrong setting the call up. Please ring +44 20 4572 2164.' });
  }
};
