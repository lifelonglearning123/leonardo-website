/* ------------------------------------------------------------------
   The Business Show 2026 hourly draw: the schedule, shared by
   /api/lead (which enters people) and /api/draw (which picks winners).
   The leading underscore keeps Vercel from serving this file itself.

   The show: Wednesday 11 November, 10:00 to 17:00, and Thursday
   12 November, 10:00 to 16:00. The UK is on GMT in November, so these
   times are UTC and London time at once.

   Anyone who sends the show pop-up while the show is open goes into the
   next draw: 10:00 to 11:00 goes into the 11:00 draw, and so on. The
   last hour of Wednesday (16:00 to 17:00) rolls into Thursday's 11:00
   draw. Thursday's last hour (15:00 to 16:00) comes after the final
   draw, so it isn't entered.
   ------------------------------------------------------------------ */

const OPEN = [
  { from: Date.parse('2026-11-11T10:00:00Z'), to: Date.parse('2026-11-11T17:00:00Z') },
  { from: Date.parse('2026-11-12T10:00:00Z'), to: Date.parse('2026-11-12T16:00:00Z') }
];

const DRAWS = [
  '2026-11-11T11:00:00Z', '2026-11-11T12:00:00Z', '2026-11-11T13:00:00Z',
  '2026-11-11T14:00:00Z', '2026-11-11T15:00:00Z', '2026-11-11T16:00:00Z',
  '2026-11-12T11:00:00Z', '2026-11-12T12:00:00Z', '2026-11-12T13:00:00Z',
  '2026-11-12T14:00:00Z', '2026-11-12T15:00:00Z'
].map(Date.parse);

/* GHL tags, lower case because GHL stores them that way:
     show-draw-2026-11-11-1100       entered into that draw
     show-draw-won-2026-11-11-1100   won that draw
     show-draw-winner                won any draw (for a smart list) */
const WINNER_TAG = 'show-draw-winner';

function stamp(at) {
  const d = new Date(at).toISOString();          /* 2026-11-11T11:00:00.000Z */
  return d.slice(0, 10) + '-' + d.slice(11, 13) + d.slice(14, 16);
}
const entryTag = (at) => 'show-draw-' + stamp(at);
const wonTag   = (at) => 'show-draw-won-' + stamp(at);

/* The draw a submission at `now` goes into, or null outside show hours. */
function drawFor(now = Date.now()) {
  const t = typeof now === 'number' ? now : now.getTime();
  if (!OPEN.some(w => t >= w.from && t < w.to)) return null;
  const next = DRAWS.find(at => at > t);
  return next === undefined ? null : next;
}

/* "11:00 on Wednesday 11 November" */
function describe(at) {
  const d = new Date(at);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) +
    ' on ' + d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' });
}

module.exports = { OPEN, DRAWS, WINNER_TAG, entryTag, wonTag, drawFor, describe };
