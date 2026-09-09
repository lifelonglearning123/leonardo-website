/* ------------------------------------------------------------------
   POST /api/lead  —  Vercel serverless function

   Takes the "Start a project" form and creates or updates the contact
   in the Leonardo Power GoHighLevel location. The location ID and the
   token are read from environment variables and stay on the server, so
   nothing sensitive is ever shipped to the browser.

   Required env vars (Vercel → Project → Settings → Environment Variables):
     GHL_LOCATION_ID   the sub-account / location ID
     GHL_TOKEN         Private Integration Token with contacts.write

   Locally, `python -m http.server` cannot run this — use `vercel dev`.
   ------------------------------------------------------------------ */

const UPSERT_URL  = 'https://services.leadconnectorhq.com/contacts/upsert';
const GHL_VERSION = '2021-07-28';

const SOURCE  = 'leonardopower.com — Start a project';
const COUNTRY = 'GB';
const MAX_LEN = 5000;

/* What they picked in "What do you need?" becomes a tag, so the lead can
   be routed and reported on without anyone reading the note first. */
const NEED_TAGS = {
  'Starter':                                       'starter',
  'Front desk':                                    'front-desk',
  'A new website with the voice and CRM built in': 'new-site',
  'Add the voice and CRM to my existing site':     'retrofit',
  'SEO and AEO — get found, get quoted':           'seo-aeo',
  "Not sure yet — let's talk":                     'unsure'
};

function clean(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, MAX_LEN);
}

/* UK numbers arrive as 07912 615229 or 020 4572 2164 — GHL wants E.164. */
function normalisePhone(raw) {
  const v = clean(raw).replace(/[^\d+]/g, '');
  if (!v) return '';
  if (v.startsWith('+'))  return v;
  if (v.startsWith('00')) return '+' + v.slice(2);
  if (v.startsWith('44')) return '+' + v;
  if (v.startsWith('0'))  return '+44' + v.slice(1);
  return '+44' + v;
}

/* One name field on the form, two on the contact record. */
function splitName(full) {
  const parts = clean(full).split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: '', lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function buildPayload(data, locationId) {
  const { firstName, lastName } = splitName(data.name);
  const need = clean(data.need);

  const payload = {
    locationId,
    firstName,
    lastName,
    email:   clean(data.email),
    source:  SOURCE,
    country: COUNTRY,
    tags:    ['website-lead'].concat(NEED_TAGS[need] ? [NEED_TAGS[need]] : [])
  };

  const business = clean(data.business);
  if (business) payload.companyName = business;

  const phone = normalisePhone(data.phone);
  if (phone) payload.phone = phone;

  return payload;
}

async function ghl(url, token, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Version':       GHL_VERSION,
      'Content-Type':  'application/json',
      'Accept':        'application/json'
    },
    body: JSON.stringify(body)
  });
  let parsed = {};
  try { parsed = await res.json(); } catch (_) { /* empty or non-JSON */ }
  return { ok: res.ok, status: res.status, body: parsed };
}

/* The answers that have no standard GHL field go on as a note. A note
   always lands, whereas a custom field silently vanishes if the key
   doesn't exist in the location. */
function buildNote(data) {
  const stamp = new Date().toLocaleString('en-GB', {
    dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/London'
  });
  const lines = ['Website lead — ' + stamp, ''];

  const business = clean(data.business);
  const need     = clean(data.need);
  const phone    = clean(data.phone);
  if (business) lines.push('Business: ' + business);
  if (need)     lines.push('Wants: ' + need);
  if (phone)    lines.push('Phone as typed: ' + phone);

  const message = clean(data.message);
  if (message) lines.push('', 'About the business:', message);

  return lines.join('\n');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const locationId = process.env.GHL_LOCATION_ID;
  const token      = process.env.GHL_TOKEN;

  if (!locationId || !token) {
    console.error('[GHL] Missing GHL_LOCATION_ID or GHL_TOKEN');
    return res.status(500).json({ error: 'The form is not configured yet.' });
  }

  const data = typeof req.body === 'string'
    ? JSON.parse(req.body || '{}')
    : (req.body || {});

  /* Honeypot: bots fill the hidden field, people never see it.
     Answer 200 so the bot thinks it worked and moves on. */
  if (clean(data.website)) return res.status(200).json({ ok: true });

  const name  = clean(data.name);
  const email = clean(data.email);
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Please give us your name and a valid email address.' });
  }

  try {
    const result = await ghl(UPSERT_URL, token, buildPayload(data, locationId));

    if (!result.ok) {
      /* Detail stays in the server log, never in the browser response. */
      console.error('[GHL] Upsert failed:', result.status, result.body);
      return res.status(502).json({ error: 'We could not save that. Please email hello@leonardopower.com.' });
    }

    const contactId = result.body && result.body.contact && result.body.contact.id;

    if (contactId) {
      const note = await ghl(
        `https://services.leadconnectorhq.com/contacts/${contactId}/notes`,
        token, { body: buildNote(data) });
      /* The lead is safely in GHL. A missing note is an inconvenience
         for whoever picks it up, not a reason to tell the visitor it failed. */
      if (!note.ok) console.error('[GHL] Note failed for', contactId, note.status, note.body);
    } else {
      console.error('[GHL] Upsert returned no contact id; note skipped');
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[GHL] Request error:', err);
    return res.status(502).json({ error: 'We could not save that. Please email hello@leonardopower.com.' });
  }
};
