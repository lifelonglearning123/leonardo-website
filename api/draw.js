/* ------------------------------------------------------------------
   GET /api/draw  —  Vercel serverless function

   The Business Show 2026 hourly draw. Returns every draw time and, for
   each one that has happened, the winner's first name, surname initial
   and business, for the board on the front page.

   No database and no cron job: GHL is the record. /api/lead tags each
   entry with the draw it's in (see _show-draw.js). The first request
   after a draw time picks the winner from that tag, and tags the winner
   in GHL with show-draw-won-… and show-draw-winner, plus a note. Every
   later request finds that tag and shows the same person.

   The pick is random to anyone outside, but repeatable: entrants are
   sorted by contact ID and the index comes from an HMAC of the draw time
   keyed with the GHL token. Two requests racing at 11:00 pick the same
   person, so there is never a second winner. Anyone who has already won
   is left out of later draws.

   Each draw waits SETTLE_MS after the hour, because GHL's search can
   take a few seconds to show a contact that was just saved.

   Needs GHL_TOKEN with contacts.readonly (to search) as well as
   contacts.write (to tag the winner), and GHL_LOCATION_ID.

   /api/draw?check=1 returns how many entries each draw has and whether
   the search works, without any names. Use it to test the setup.
   ------------------------------------------------------------------ */

const crypto = require('crypto');
const { DRAWS, WINNER_TAG, entryTag, wonTag, describe } = require('./_show-draw');

const GHL         = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const SETTLE_MS   = 90 * 1000;
const PAGE        = 500;

async function ghl(path, token, body) {
  const res = await fetch(GHL + path, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Version':       GHL_VERSION,
      'Content-Type':  'application/json',
      'Accept':        'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000)
  });
  let parsed = {};
  try { parsed = await res.json(); } catch (_) { /* empty or non-JSON */ }
  return { ok: res.ok, status: res.status, body: parsed };
}

/* Every contact with this tag. Throws with the status if GHL says no. */
async function withTag(tag, cfg) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const r = await ghl('/contacts/search', cfg.token, {
      locationId: cfg.locationId,
      page, pageLimit: PAGE,
      filters: [{ field: 'tags', operator: 'eq', value: tag }]
    });
    if (!r.ok || !Array.isArray(r.body.contacts)) {
      const err = new Error('GHL search failed');
      err.status = r.status; err.detail = r.body;
      throw err;
    }
    /* Belt and braces: only keep contacts that really carry the tag */
    out.push(...r.body.contacts.filter(c => c && c.id &&
      (!Array.isArray(c.tags) || c.tags.map(t => String(t).toLowerCase()).includes(tag))));
    if (r.body.contacts.length < PAGE) break;
  }
  return out;
}

function pick(entrants, at, key) {
  const sorted = entrants.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const h = crypto.createHmac('sha256', key).update('business-show-2026-draw|' + at).digest();
  return sorted[Number(h.readBigUInt64BE(0) % BigInt(sorted.length))];
}

/* What the board shows: never an email, phone or full surname. */
function publicName(c) {
  const first = String(c.firstName || '').trim();
  const last  = String(c.lastName || '').trim();
  const name  = first ? first + (last ? ' ' + last.charAt(0).toUpperCase() + '.' : '') : 'A visitor';
  return { name, business: String(c.companyName || '').trim() };
}

/* Tags and a note on the winner, so the team knows who to hand it to. */
async function markWinner(c, at, cfg) {
  const tags = await ghl(`/contacts/${c.id}/tags`, cfg.token, { tags: [wonTag(at), WINNER_TAG] });
  if (!tags.ok) console.error('[Draw] Could not tag winner', c.id, tags.status, tags.body);
  const note = await ghl(`/contacts/${c.id}/notes`, cfg.token, {
    body: 'Won the Business Show draw at ' + describe(at) +
      ': a Leonardo Power product free for a year. Their first name, surname initial and business are now on the website.'
  });
  if (!note.ok) console.error('[Draw] Could not add note for', c.id, note.status, note.body);
}

/* This instance's memory of draws already settled, so a warm function
   doesn't search GHL again for them. */
const settled = new Map();

async function run(now, cfg, check) {
  const draws = [];
  const winners = new Set();

  for (const at of DRAWS) {
    const row = { at: new Date(at).toISOString() };
    draws.push(row);
    if (now < at) { row.status = 'upcoming'; continue; }

    if (check) {
      try {
        row.entries = (await withTag(entryTag(at), cfg)).length;
        row.won = (await withTag(wonTag(at), cfg)).length;
        row.status = 'ok';
      } catch (err) { row.status = 'error ' + err.status; }
      continue;
    }

    if (now < at + SETTLE_MS) { row.status = 'drawing'; continue; }

    const known = settled.get(at);
    if (known) {
      Object.assign(row, known.row);
      if (known.id) winners.add(known.id);
      continue;
    }

    try {
      /* Already drawn? Then that's the winner, whatever else has changed. */
      let winner = (await withTag(wonTag(at), cfg))[0];
      let fresh = false;
      if (!winner) {
        const entrants = (await withTag(entryTag(at), cfg)).filter(c => !winners.has(c.id));
        if (entrants.length) { winner = pick(entrants, at, cfg.token); fresh = true; }
      }
      if (!winner) {
        row.status = 'no-entries';
      } else {
        row.status = 'won';
        Object.assign(row, publicName(winner));
        winners.add(winner.id);
        if (fresh) await markWinner(winner, at, cfg);
      }
      const { at: _, ...rest } = row;
      settled.set(at, { id: winner && winner.id, row: rest });
    } catch (err) {
      console.error('[Draw] Could not settle', describe(at), err.status, err.detail || err);
      row.status = 'drawing';     /* try again on the next request */
    }
  }
  return draws;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cfg = { locationId: process.env.GHL_LOCATION_ID, token: process.env.GHL_TOKEN };
  const check = !!(req.query && req.query.check);
  const now = Date.now();

  if (!cfg.locationId || !cfg.token) {
    console.error('[Draw] Missing GHL_LOCATION_ID or GHL_TOKEN');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ error: 'The draw is not configured yet.' });
  }

  if (check) {
    /* Proves the search works even before the first draw, with no names */
    let search = 'ok';
    try { await withTag(WINNER_TAG, cfg); } catch (err) { search = 'error ' + err.status; }
    const draws = await run(Number.MAX_SAFE_INTEGER, cfg, true);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ search, draws });
  }

  const draws = await run(now, cfg, false);
  /* A short CDN cache keeps GHL calls down when the stand sends a crowd */
  res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=40');
  return res.status(200).json({ now: new Date(now).toISOString(), draws });
};

module.exports._test = { pick, publicName, run };
