/* ------------------------------------------------------------------
   POST /api/lead  —  Vercel serverless function

   Takes the "Start a project" form and creates or updates the contact
   in the Leonardo Power GoHighLevel location. The location ID and the
   token are read from environment variables and stay on the server, so
   nothing sensitive is ever shipped to the browser.

   Required env vars (Vercel → Project → Settings → Environment Variables):
     GHL_LOCATION_ID   the sub-account / location ID
     GHL_TOKEN         Private Integration Token with contacts.write

   Optional, for the Business Show follow-up call (see "THE FOLLOW-UP
   CALL" below). With any of the first three missing, no call is placed
   and the form behaves exactly as before:
     RETELL_API_KEY         Leonardo Power's Retell API key
     SHOW_CALL_AGENT_ID     the Retell agent that makes the call (agent_…)
     SHOW_CALL_FROM_NUMBER  the number it rings from, E.164 (+447…)
     SHOW_CALL_ENABLED      set to "false" to stop the calls without a deploy
     SHOW_CALL_DAILY_CAP    most calls in any 24 hours (default 60)

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
  'Assistant - call requested':                    'assistant-callback',
  'Assistant - question':                          'assistant-question',
  'Business Show offer':                           'show-offer',
  'Signal':                                        'signal',
  'Google Business Profile':                       'gbp',
  'Nexus':                                         'nexus',
  'A new website with the voice and CRM built in': 'new-site',
  'Add the voice and CRM to my existing site':     'retrofit',
  'SEO and AEO — get found, get quoted':           'seo-aeo',
  "Not sure yet — let's talk":                     'unsure'
};

/* The Business Show 2026 pop-up. Each ticked product becomes a tag, so a
   GHL smart list or workflow can pick up "everyone who wants Signal"
   without anyone opening the notes. Only these keys are accepted. */
const EVENT_FORM   = 'business-show-2026';
const EVENT_SOURCE = 'leonardopower.com — Business Show 2026 pop-up';
const PRODUCTS = {
  gbp:    { tag: 'interest-gbp',    label: 'Google Business Profile' },
  signal: { tag: 'interest-signal', label: 'Signal (AI voice)' },
  nexus:  { tag: 'interest-nexus',  label: 'Nexus (CRM)' }
};

function interestsOf(data) {
  const raw = Array.isArray(data.interests) ? data.interests : [];
  return Object.keys(PRODUCTS).filter(k => raw.includes(k));
}

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
  const isEvent = data.form === EVENT_FORM;

  let tags = ['website-lead'].concat(NEED_TAGS[need] ? [NEED_TAGS[need]] : []);
  if (isEvent) {
    tags = tags.concat(EVENT_FORM, interestsOf(data).map(k => PRODUCTS[k].tag));
  }

  const payload = {
    locationId,
    firstName,
    lastName,
    source:  isEvent ? EVENT_SOURCE : SOURCE,
    country: COUNTRY,
    tags
  };

  /* An empty string is not an absent field: GHL answers an empty email
     with "email must be an email" and rejects the whole contact. The
     assistant often has a number and nothing else, so leave it out. */
  const email = clean(data.email);
  if (email) payload.email = email;

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

/* ------------------------------------------------------------------
   THE FOLLOW-UP CALL

   Someone who sends the Business Show form is rung straight away by
   Leonardo Power's own AI assistant, which knows their first name and
   what they ticked. The call is the demonstration.

   The agent's script is agent/show-call-prompt.md. It lives in Retell;
   that file is the copy to edit and re-send.

   Anyone can type any number into a web form, so before ringing:
     - UK landlines and mobiles only (no premium, personal or pager ranges)
     - 08:00 to 21:00 UK time only
     - a number is rung once (Retell's call list, 60 days back)
     - no more than SHOW_CALL_DAILY_CAP calls in any 24 hours
   Retell's own call list is the record for the last two, so there is no
   database here. If that list can't be read, nobody is rung.

   A call that isn't placed never fails the form: the lead is already
   saved, and the team follows up as they always did.
   ------------------------------------------------------------------ */
const RETELL_BASE    = 'https://api.retellai.com';
const RETELL_TIMEOUT = 6000;
const CALL_DAILY_CAP = 60;
const DAY_MS         = 24 * 60 * 60 * 1000;
const ONCE_WINDOW_MS = 60 * DAY_MS;

/* 01, 02, 03 and real mobiles. Not 070 (personal numbers), 076 (pagers),
   08 or 09. */
const UK_CALLABLE = /^\+44(?:1\d{8,9}|2\d{9}|3\d{9}|7[1-57-9]\d{8})$/;

function showCallConfig() {
  const apiKey     = (process.env.RETELL_API_KEY || '').trim();
  const agentId    = (process.env.SHOW_CALL_AGENT_ID || '').trim();
  const fromNumber = (process.env.SHOW_CALL_FROM_NUMBER || '').trim();
  if (!apiKey || !agentId || !/^\+\d{8,15}$/.test(fromNumber)) return null;
  if ((process.env.SHOW_CALL_ENABLED || '').trim().toLowerCase() === 'false') return null;
  const cap = Number((process.env.SHOW_CALL_DAILY_CAP || '').trim());
  return {
    apiKey, agentId, fromNumber,
    dailyCap: Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : CALL_DAILY_CAP
  };
}

function londonHour(now) {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: 'numeric', hour12: false
  }).format(now)) % 24;
}

/* "Signal", "Signal and Nexus", or all three by name: read aloud by the
   agent, so written the way a person would say it. */
function spokenInterests(keys) {
  const names = { gbp: 'Google Business Profile', signal: 'Signal', nexus: 'Nexus' };
  const picked = ['signal', 'nexus', 'gbp'].filter(k => keys.includes(k)).map(k => names[k]);
  if (picked.length === 3) return 'all three: Signal, Nexus and Google Business Profile';
  if (picked.length === 2) return picked[0] + ' and ' + picked[1];
  return picked[0] || 'what Leonardo Power does';
}

async function retell(path, apiKey, body) {
  const res = await fetch(RETELL_BASE + path, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(RETELL_TIMEOUT)
  });
  let parsed = null;
  try { parsed = await res.json(); } catch (_) { /* empty or non-JSON */ }
  return { ok: res.ok, status: res.status, body: parsed };
}

/* Returns { placed: true } or { placed: false, reason } — the reason goes
   on the contact's note and in the log, never to the browser. */
async function placeShowCall(data, phone, contactId, now = new Date()) {
  const cfg = showCallConfig();
  if (!cfg) return { placed: false, reason: 'calls are switched off' };
  if (!UK_CALLABLE.test(phone)) return { placed: false, reason: 'not a UK landline or mobile' };
  const hour = londonHour(now);
  if (hour < 8 || hour >= 21) return { placed: false, reason: 'outside 08:00 to 21:00' };

  try {
    /* Retell's v3 list: typed filters, and the calls come back in `items`.
       One page is 1,000 calls, far more than the show will make. */
    const recent = await retell('/v3/list-calls', cfg.apiKey, {
      filter_criteria: {
        agent_id: [cfg.agentId],
        start_timestamp: { type: 'number', op: 'ge', value: now.getTime() - ONCE_WINDOW_MS }
      },
      sort_order: 'descending',
      limit: 1000
    });
    const calls = recent.body && recent.body.items;
    if (!recent.ok || !Array.isArray(calls)) {
      console.error('[Call] Could not read recent calls:', recent.status, recent.body);
      return { placed: false, reason: 'could not check earlier calls' };
    }
    if (calls.some(c => c && c.to_number === phone)) {
      return { placed: false, reason: 'this number has already been rung' };
    }
    const dayAgo = now.getTime() - DAY_MS;
    const today = calls.filter(c => c && Number(c.start_timestamp) >= dayAgo).length;
    if (today >= cfg.dailyCap) {
      console.error('[Call] Daily cap reached:', today);
      return { placed: false, reason: 'the daily limit of calls was reached' };
    }

    const call = await retell('/v2/create-phone-call', cfg.apiKey, {
      from_number: cfg.fromNumber,
      to_number: phone,
      override_agent_id: cfg.agentId,
      metadata: { source: EVENT_FORM, ghl_contact_id: contactId || '' },
      retell_llm_dynamic_variables: {
        first_name: splitName(data.name).firstName || 'there',
        interests: spokenInterests(interestsOf(data))
      }
    });
    if (!call.ok || !call.body || !call.body.call_id) {
      console.error('[Call] Retell would not place the call:', call.status, call.body);
      return { placed: false, reason: 'the call could not be started' };
    }
    return { placed: true };
  } catch (err) {
    console.error('[Call] Request error:', err);
    return { placed: false, reason: 'the call could not be started' };
  }
}

/* The answers that have no standard GHL field go on as a note. A note
   always lands, whereas a custom field silently vanishes if the key
   doesn't exist in the location. */
function buildNote(data, call) {
  const stamp = new Date().toLocaleString('en-GB', {
    dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/London'
  });
  const isEvent = data.form === EVENT_FORM;
  const lines = [(isEvent ? 'Business Show 2026 pop-up — ' : 'Website lead — ') + stamp, ''];

  if (isEvent) {
    const picked = interestsOf(data).map(k => PRODUCTS[k].label);
    lines.push('Interested in: ' + (picked.length ? picked.join(', ') : 'nothing ticked'));
    if (call) {
      lines.push(call.placed
        ? 'The AI assistant rang them straight away.'
        : 'The AI assistant did not ring them: ' + call.reason + '.');
    }
  }

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

  const email = clean(data.email);
  const phone = normalisePhone(data.phone);
  const hasEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  const hasPhone = /^\+\d{10,15}$/.test(phone);

  /* One way to reach them is enough. The website form asks for both and
     enforces it in the browser; the assistant often has only a number. */
  if (!hasEmail && !hasPhone) {
    return res.status(400).json({ error: 'Please give us an email address or a phone number.' });
  }

  try {
    const result = await ghl(UPSERT_URL, token, buildPayload(data, locationId));

    if (!result.ok) {
      /* Detail stays in the server log, never in the browser response. */
      console.error('[GHL] Upsert failed:', result.status, result.body);
      return res.status(502).json({ error: 'We could not save that. Please email hello@leonardopower.com.' });
    }

    const contactId = result.body && result.body.contact && result.body.contact.id;

    /* Ring them before the note is written, so the note can say whether
       the call went out. Unticking "ring me now" on the form skips it. */
    let call = null;
    if (data.form === EVENT_FORM) {
      call = data.callNow === false
        ? { placed: false, reason: 'they asked not to be rung now' }
        : await placeShowCall(data, phone, contactId);
    }

    if (contactId) {
      const note = await ghl(
        `https://services.leadconnectorhq.com/contacts/${contactId}/notes`,
        token, { body: buildNote(data, call) });
      /* The lead is safely in GHL. A missing note is an inconvenience
         for whoever picks it up, not a reason to tell the visitor it failed. */
      if (!note.ok) console.error('[GHL] Note failed for', contactId, note.status, note.body);
    } else {
      console.error('[GHL] Upsert returned no contact id; note skipped');
    }

    return res.status(200).json({ ok: true, calling: !!(call && call.placed) });
  } catch (err) {
    console.error('[GHL] Request error:', err);
    return res.status(502).json({ error: 'We could not save that. Please email hello@leonardopower.com.' });
  }
};
