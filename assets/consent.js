/* ══════════════════════════════════════════════════════════════════
   Leonardo Power — cookie consent

   UK PECR says non-essential storage needs opt-in BEFORE it happens,
   so nothing advertising- or analytics-related is loaded until someone
   says yes. That is the whole job of this file.

   TO SWITCH ON A PIXEL: put its ID in the TAGS object below. Nothing
   else. The tag is then loaded only for visitors who accept marketing
   (or analytics) cookies, and unloaded expectations are handled for you.

   DO NOT paste a gtag / fbq / ttq snippet into the page itself. If you
   do, it fires before anyone has consented and the consent record here
   becomes a lie — which is the thing regulators actually fine people for.

   Loaded with `defer` on every page. It sets Google Consent Mode v2
   defaults to denied before it loads anything Google, so Google Ads
   still gets its conversion modelling for visitors who decline.
   ══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── the only thing you should need to edit ─────────────────────── */
  var TAGS = {
    ga4:         '',   // 'G-XXXXXXXXXX'      — Google Analytics 4      (analytics)
    googleAds:   '',   // 'AW-XXXXXXXXXX'     — Google Ads              (marketing)
    metaPixel:   '',   // '1234567890123456'  — Meta / Facebook Pixel   (marketing)
    tiktokPixel: ''    // 'CXXXXXXXXXXXXXXXX' — TikTok Pixel            (marketing)
  };

  var KEY = 'lp-consent';
  var VERSION = 1;              // bump to re-ask everyone
  var REASK_AFTER_DAYS = 365;   // ICO expects consent to be refreshed, not permanent
  var HONOUR_GPC = true;        // treat a Global Privacy Control signal as "reject"
  var POLICY_URL = '/cookies';

  /* ── state ──────────────────────────────────────────────────────── */
  var doc = document;
  var loaded = { ga4: false, googleAds: false, meta: false, tiktok: false };
  var banner = null, panel = null, lastFocus = null;

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || s.v !== VERSION) return null;
      var age = (Date.now() - (s.ts || 0)) / 86400000;
      if (age > REASK_AFTER_DAYS) return null;
      return s;
    } catch (e) { return null; }
  }

  function write(analytics, marketing) {
    var s = { v: VERSION, ts: Date.now(), necessary: true, analytics: !!analytics, marketing: !!marketing };
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
    return s;
  }

  var state = read();
  var gpc = HONOUR_GPC && (navigator.globalPrivacyControl === true);

  /* ── Google Consent Mode v2 ─────────────────────────────────────
     Defaults go in before any Google tag loads. ad_user_data and
     ad_personalization are the two that Google Ads requires in the
     UK and EEA; without them, remarketing audiences stop collecting. */
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;

  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    functionality_storage: 'granted',
    security_storage: 'granted',
    wait_for_update: 500
  });

  function pushConsent(s) {
    gtag('consent', 'update', {
      ad_storage: s.marketing ? 'granted' : 'denied',
      ad_user_data: s.marketing ? 'granted' : 'denied',
      ad_personalization: s.marketing ? 'granted' : 'denied',
      analytics_storage: s.analytics ? 'granted' : 'denied'
    });
    window.dataLayer.push({ event: 'lp_consent_update', lp_analytics: !!s.analytics, lp_marketing: !!s.marketing });
  }

  /* ── tag loaders — each one runs at most once, and only on consent ── */
  function script(src, attrs) {
    var el = doc.createElement('script');
    el.async = true; el.src = src;
    if (attrs) Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    doc.head.appendChild(el);
    return el;
  }

  function loadGoogle(s) {
    var id = s.analytics ? TAGS.ga4 : '';
    var ads = s.marketing ? TAGS.googleAds : '';
    var first = id || ads;
    if (!first) return;
    if (!loaded.ga4 && !loaded.googleAds) {
      script('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(first));
      gtag('js', new Date());
    }
    if (id && !loaded.ga4) { gtag('config', id); loaded.ga4 = true; }
    if (ads && !loaded.googleAds) { gtag('config', ads); loaded.googleAds = true; }
  }

  function loadMeta(s) {
    if (!s.marketing || !TAGS.metaPixel || loaded.meta) return;
    /* standard Meta base code, minus the auto-init we do ourselves */
    !function (f, b, e, v, n, t, s2) {
      if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = true; t.src = v;
      s2 = b.getElementsByTagName(e)[0]; s2.parentNode.insertBefore(t, s2);
    }(window, doc, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('consent', 'grant');
    window.fbq('init', TAGS.metaPixel);
    window.fbq('track', 'PageView');
    loaded.meta = true;
  }

  function loadTikTok(s) {
    if (!s.marketing || !TAGS.tiktokPixel || loaded.tiktok) return;
    !function (w, d, t) {
      w.TiktokAnalyticsObject = t;
      var ttq = w[t] = w[t] || [];
      ttq.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie'];
      ttq.setAndDefer = function (obj, m) { obj[m] = function () { obj.push([m].concat(Array.prototype.slice.call(arguments, 0))); }; };
      for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
      ttq.instance = function (id) { var e = ttq._i[id] || []; for (var n = 0; n < ttq.methods.length; n++) ttq.setAndDefer(e, ttq.methods[n]); return e; };
      ttq.load = function (e, n) {
        var url = 'https://analytics.tiktok.com/i18n/pixel/events.js';
        ttq._i = ttq._i || {}; ttq._i[e] = []; ttq._i[e]._u = url; ttq._t = ttq._t || {}; ttq._t[e] = +new Date();
        ttq._o = ttq._o || {}; ttq._o[e] = n || {};
        var s2 = d.createElement('script'); s2.type = 'text/javascript'; s2.async = true; s2.src = url + '?sdkid=' + e + '&lib=' + t;
        var f = d.getElementsByTagName('script')[0]; f.parentNode.insertBefore(s2, f);
      };
      ttq.load(TAGS.tiktokPixel);
      ttq.page();
    }(window, doc, 'ttq');
    loaded.tiktok = true;
  }

  /* Scripts written into the page as
       <script type="text/plain" data-consent="marketing" data-src="…">
     are activated here and nowhere else. */
  function loadGated(s) {
    [].slice.call(doc.querySelectorAll('script[type="text/plain"][data-consent]')).forEach(function (node) {
      var need = node.getAttribute('data-consent');
      if (need !== 'analytics' && need !== 'marketing') return;
      if (!s[need]) return;
      var el = doc.createElement('script');
      if (node.dataset.src) { el.src = node.dataset.src; el.async = true; }
      else { el.text = node.textContent; }
      node.parentNode.insertBefore(el, node);
      node.remove();
    });
  }

  function apply(s) {
    pushConsent(s);
    if (s.analytics || s.marketing) { loadGoogle(s); }
    loadMeta(s);
    loadTikTok(s);
    loadGated(s);
    doc.dispatchEvent(new CustomEvent('lp:consent', { detail: s }));
  }

  /* ── styles, scoped and palette-aware ───────────────────────────── */
  var CSS = [
    '.lpc,.lpc *{box-sizing:border-box}',
    '.lpc{position:fixed;left:0;right:0;bottom:0;z-index:90;padding:14px;font-family:var(--body,system-ui,sans-serif)}',
    '.lpc-card{width:min(1100px,100%);margin-inline:auto;background:var(--bg-2,#f3f5fb);color:var(--fg,#0e3190);',
    '  border:1px solid var(--line,#dbe1f0);border-radius:20px;padding:20px;',
    '  box-shadow:0 30px 70px -24px rgb(var(--sh,14 30 90) / .5)}',
    '.lpc h2[tabindex]:focus,.lpc-panel h2[tabindex]:focus{outline:none}',
    '.lpc-card h2{font-family:var(--display,Georgia,serif);font-weight:640;letter-spacing:-.02em;',
    '  font-size:21px;line-height:1.2;margin:0 0 8px}',
    '.lpc-card p{margin:0 0 16px;font-size:15px;line-height:1.55;color:var(--fg-2,#46589c);max-width:78ch}',
    '.lpc-card a{color:var(--accent,#2b5cf6)}',
    '.lpc-btns{display:flex;flex-wrap:wrap;gap:10px}',
    '.lpc-b{appearance:none;font:inherit;font-weight:600;font-size:15px;line-height:1;min-height:48px;',
    '  padding:14px 20px;border-radius:999px;border:1px solid transparent;cursor:pointer;flex:1 1 auto;',
    '  display:inline-flex;align-items:center;justify-content:center;text-align:center}',
    '.lpc-b.pri{background:var(--inverse-bg,#0e3190);color:var(--inverse-fg,#fff)}',
    '.lpc-b.sec{background:var(--bg-3,#eaeef8);color:var(--fg,#0e3190);border-color:var(--line-2,#c3cce4)}',
    '.lpc-b.link{background:none;border-color:transparent;color:var(--fg-2,#46589c);text-decoration:underline;',
    '  text-underline-offset:3px;flex:0 1 auto}',
    '.lpc-b:hover{filter:brightness(1.06)}',
    '.lpc-b:focus-visible{outline:2px solid var(--accent,#2b5cf6);outline-offset:3px}',
    '@media (min-width:720px){.lpc-card{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px 28px;align-items:center;padding:22px 24px}',
    '  .lpc-txt{grid-row:1/3}.lpc-card p{margin-bottom:0}.lpc-btns{flex-wrap:nowrap}.lpc-b{flex:0 0 auto}}',
    /* preference panel */
    '.lpc-mask{position:fixed;inset:0;z-index:95;background:rgb(var(--bg-rgb,10 17 40) / .6);',
    '  backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:safe center;',
    '  justify-content:center;padding:16px;overflow:auto}',
    '.lpc-panel{width:min(560px,100%);background:var(--bg,#fff);color:var(--fg,#0e3190);',
    '  border:1px solid var(--line,#dbe1f0);border-radius:22px;padding:24px;',
    '  box-shadow:0 40px 90px -30px rgb(var(--sh,14 30 90) / .7);font-family:var(--body,system-ui,sans-serif)}',
    '.lpc-panel h2{font-family:var(--display,Georgia,serif);font-weight:640;font-size:25px;letter-spacing:-.03em;margin:0 0 6px}',
    '.lpc-panel .sub{font-size:15px;line-height:1.55;color:var(--fg-2,#46589c);margin:0 0 18px}',
    '.lpc-row{display:flex;gap:14px;align-items:flex-start;padding:16px 0;border-top:1px solid var(--line,#dbe1f0)}',
    '.lpc-row .txt{flex:1}',
    '.lpc-row b{display:block;font-size:15.5px;font-weight:600;margin-bottom:4px}',
    '.lpc-row span{display:block;font-size:14px;line-height:1.5;color:var(--fg-2,#46589c)}',
    '.lpc-row input{width:22px;height:22px;margin:2px 0 0;flex:none;accent-color:var(--accent,#2b5cf6)}',
    '.lpc-row.locked span.fixed{font-family:var(--mono,monospace);font-size:11px;letter-spacing:.1em;',
    '  text-transform:uppercase;color:var(--fg-3,#5e6ca6);margin-top:6px}',
    '.lpc-panel .acts{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}',
    '@media (prefers-reduced-motion:no-preference){.lpc{animation:lpc-up .5s cubic-bezier(.16,1,.3,1) both}',
    '  @keyframes lpc-up{from{transform:translateY(120%)}to{transform:none}}}'
  ].join('');

  function injectCSS() {
    if (doc.getElementById('lpc-css')) return;
    var st = doc.createElement('style'); st.id = 'lpc-css'; st.textContent = CSS;
    doc.head.appendChild(st);
  }

  /* ── banner ─────────────────────────────────────────────────────── */
  function showBanner() {
    if (banner) return;
    injectCSS();
    banner = doc.createElement('div');
    banner.className = 'lpc';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-labelledby', 'lpc-h');
    banner.setAttribute('aria-describedby', 'lpc-p');
    banner.innerHTML =
      '<div class="lpc-card">' +
        '<div class="lpc-txt">' +
          '<h2 id="lpc-h" tabindex="-1">Before you look round</h2>' +
          '<p id="lpc-p">We use cookies that are needed to make the site work, and — only if you say yes — ' +
          'cookies that measure how the site is doing and let us show you our ads on Google, Facebook, ' +
          'Instagram and TikTok. You can change your mind whenever you like. ' +
          '<a href="' + POLICY_URL + '">Read the cookie policy</a>.</p>' +
        '</div>' +
        '<div class="lpc-btns">' +
          '<button type="button" class="lpc-b pri" data-lpc="all">Accept all</button>' +
          '<button type="button" class="lpc-b sec" data-lpc="none">Reject all</button>' +
          '<button type="button" class="lpc-b link" data-lpc="choose">Choose cookies</button>' +
        '</div>' +
      '</div>';
    doc.body.appendChild(banner);
    banner.addEventListener('click', function (e) {
      var b = e.target.closest('[data-lpc]'); if (!b) return;
      var v = b.getAttribute('data-lpc');
      if (v === 'all') save(true, true);
      else if (v === 'none') save(false, false);
      else openPanel();
    });
    /* announce it, without yanking focus out of a field someone is using */
    setTimeout(function () {
      if (banner && doc.activeElement === doc.body) doc.getElementById('lpc-h').focus({ preventScroll: true });
    }, 700);
  }

  function hideBanner() { if (banner) { banner.remove(); banner = null; } }

  /* ── preference panel ───────────────────────────────────────────── */
  function openPanel() {
    if (panel) return;
    injectCSS();
    lastFocus = doc.activeElement;
    var s = state || { analytics: false, marketing: false };
    panel = doc.createElement('div');
    panel.className = 'lpc-mask';
    panel.innerHTML =
      '<div class="lpc-panel" role="dialog" aria-modal="true" aria-labelledby="lpc-ph">' +
        '<h2 id="lpc-ph" tabindex="-1">Choose your cookies</h2>' +
        '<p class="sub">Nothing in the second and third groups runs until you switch it on.</p>' +
        '<div class="lpc-row locked">' +
          '<input type="checkbox" checked disabled aria-hidden="true" tabindex="-1">' +
          '<div class="txt"><b>Strictly necessary</b>' +
          '<span>Remembers this choice and which colour scheme you picked, and keeps the forms working. ' +
          'No advertising, no tracking, never shared.</span>' +
          '<span class="fixed">Always on</span></div>' +
        '</div>' +
        '<label class="lpc-row">' +
          '<input type="checkbox" id="lpc-an"' + (s.analytics ? ' checked' : '') + '>' +
          '<div class="txt"><b>Measurement</b>' +
          '<span>Counts visits and shows us which pages people actually read, so we can fix the ones they don\'t. ' +
          'Google Analytics.</span></div>' +
        '</label>' +
        '<label class="lpc-row">' +
          '<input type="checkbox" id="lpc-mk"' + (s.marketing ? ' checked' : '') + '>' +
          '<div class="txt"><b>Advertising</b>' +
          '<span>Lets Google, Meta (Facebook and Instagram) and TikTok recognise this browser, so we can show ' +
          'our ads to people who have been here and stop paying to show them twice.</span></div>' +
        '</label>' +
        '<div class="acts">' +
          '<button type="button" class="lpc-b pri" data-lpc="save">Save my choice</button>' +
          '<button type="button" class="lpc-b sec" data-lpc="all">Accept all</button>' +
          '<button type="button" class="lpc-b link" data-lpc="close">Cancel</button>' +
        '</div>' +
      '</div>';
    doc.body.appendChild(panel);
    doc.documentElement.style.overflow = 'hidden';
    panel.addEventListener('click', function (e) {
      if (e.target === panel) return closePanel();
      var b = e.target.closest('[data-lpc]'); if (!b) return;
      var v = b.getAttribute('data-lpc');
      if (v === 'save') save(doc.getElementById('lpc-an').checked, doc.getElementById('lpc-mk').checked);
      else if (v === 'all') save(true, true);
      else closePanel();
    });
    panel.addEventListener('keydown', trap);
    doc.getElementById('lpc-ph').focus({ preventScroll: true });
  }

  function closePanel() {
    if (!panel) return;
    panel.remove(); panel = null;
    doc.documentElement.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    else if (banner) doc.getElementById('lpc-h').focus({ preventScroll: true });
  }

  function trap(e) {
    if (e.key === 'Escape') { e.preventDefault(); return closePanel(); }
    if (e.key !== 'Tab') return;
    var f = panel.querySelectorAll('button, input:not([disabled]), a[href]');
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function save(analytics, marketing) {
    state = write(analytics, marketing);
    closePanel();
    hideBanner();
    apply(state);
  }

  /* ── public API — the footer link and the cookie page use this ──── */
  window.lpConsent = {
    open: function () { openPanel(); },
    state: function () { return state ? JSON.parse(JSON.stringify(state)) : null; },
    withdraw: function () { try { localStorage.removeItem(KEY); } catch (e) {} location.reload(); }
  };

  /* ── go ─────────────────────────────────────────────────────────── */
  function start() {
    [].slice.call(doc.querySelectorAll('[data-cookie-settings]')).forEach(function (el) {
      el.addEventListener('click', function (e) { e.preventDefault(); openPanel(); });
    });

    if (state) { apply(state); return; }
    if (gpc) { state = write(false, false); apply(state); return; }  /* browser already said no */
    showBanner();
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
  else start();
})();
