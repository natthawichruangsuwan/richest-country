---
title: How to Add a Contact Form to a Static Website (Without a Backend You Have to Write)
description: Add a contact form to a static website that emails you, using plain HTML or fetch(), allowed origins, and spam scoring on a self-hosted endpoint.
date: 2026-11-17
slug: how-to-add-a-contact-form-to-a-static-website
product: formbox
query: contact form for static website
queries:
  - free contact form for static website
  - contact form for static site
  - how to create an html form that sends you an email
related:
  - how-to-create-a-waitlist-landing-page
  - how-to-make-a-status-page
---

A contact form for a static website is a small HTML form that has to deliver a message to you, even though the site itself is only files. GitHub Pages, a Netlify or Vercel static deploy, an S3 bucket, and a folder of plain HTML can all show the form. None of them can read the POST, store the row, or hand it to a mail server. This guide covers that limit, the usual ways around it, and a working setup: plain HTML and a `fetch()` version that both post to a self-hosted endpoint, with a honeypot, a time trap, an allowed-origin list, spam scoring, email and webhooks, and a disk that keeps the SQLite file.

## A static host serves files

When someone opens your contact page, the host looks up a file and returns it. A form pointed at that same page comes back as a 405, a 404, or the HTML again. GitHub Pages will not run a server you commit beside the markup. An S3 website endpoint does not execute code. A Netlify or Vercel static export behaves the same way until you attach a function, and that function is a backend you then have to write.

The browser can already send `application/x-www-form-urlencoded`, `multipart/form-data`, or JSON. Leave the page where it is. Post to a small endpoint on another origin, such as `https://forms.yourdomain.com/f/k3m9x2qapz`. The page stays a file. The endpoint stores the message and emails you. Run that process on its own host, the same way a [status page](/guides/how-to-make-a-status-page/) stays up on a machine of its own.

## Four ways to get the message to you

**Open the visitor's mail app.** `action="mailto:you@example.com"` fills a draft in their mail program. There is no server, which is why it shows up in every thread about a free contact form for a static site. Many phones have no mail app, you get no copy in a mailbox you control, and nothing filters spam. Fine for a personal page with a message a month.

**Hand the POST to a hosted form service.** Their URL is the form action. They store the submission and email you. A free tier usually caps submissions or adds a badge, and the form goes quiet when the cap hits on launch day. A fair trade for a side project.

**Write a serverless function.** A Netlify Function, a Vercel route, or a Cloudflare Worker can accept the POST and call an email API. You then own parsing, CORS, and spam filtering. A good fit when you already deploy there and you only have one form.

**Run a self-hosted form endpoint.** A small Node process stores every submission in SQLite: an inbox, a spam folder, email, and webhooks. The static site never handles the POST, so the same HTML works on GitHub Pages, S3, Netlify, Vercel, or a VPS. The rest of this guide is that path. The code is from Formbox, on Node.js 22.13 or newer (24 if you are choosing today). SQLite is the one built into Node.

You can try it with no accounts. `npm install` only checks the Node version, and `npm run demo` serves `http://localhost:3000` (password `demo-admin`). The sample data is a fictional app, Fieldnote Labs: six forms, about 490 submissions, about 58 of them spam. Mail is only logged, webhooks are simulated, and `/try` posts at the demo endpoints. `npm run seed` reloads those rows and refuses to wipe forms you created yourself.

## Add the form in plain HTML

Sign in, create a form, add your site under Allowed websites, and copy the Embed tab. The snippet already has your endpoint and the honeypot:

```html
<form action="https://forms.yourdomain.com/f/k3m9x2qapz" method="POST">
  <label>Name <input type="text" name="name" required></label>
  <label>Email <input type="email" name="email" required></label>
  <label>Message <textarea name="message" required></textarea></label>

  <!-- Spam trap: people never see or fill this field -->
  <input type="text" name="_gotcha" tabindex="-1" autocomplete="off"
         style="position:absolute;left:-5000px" aria-hidden="true">

  <button type="submit">Send</button>
</form>

<!-- Optional: adds the time-trap field that stops bots which submit instantly -->
<script src="https://forms.yourdomain.com/fb.js" defer></script>
```

Visible names are yours. `name`, `email`, `company`, or `plan` are stored as you named them, and checkboxes that share a name are stored as a list. A name starting with `_` steers the request and is not stored.

`_gotcha` is the honeypot: off screen, out of tab order, autocomplete off. People leave it empty. Bots fill it. Rename it per form if you want; the Embed tab follows.

`fb.js` writes `_t`, the page-load time in milliseconds, and `_page`, the full address of the page. Without `_page`, a top-pages report shows only the domain, because browsers usually omit the path on a cross-site post. `_page` is accepted only when it is on the site that posted.

After submit, the visitor goes to `_next` if you sent it, else the form's redirect URL, else a built-in thank-you page. `_next` has to be on an allowed origin or on the form server:

```html
<input type="hidden" name="_next" value="https://www.yourdomain.com/thanks.html">
```

`_subject` is the notification subject. `_replyto` is the Reply-To header. Omit `_replyto` and the first email address in the submission is used, so a reply from your mail client reaches the person who wrote.

Accepted bodies: a normal form post, `FormData` text fields (empty file inputs are ignored; a real file is `415`), JSON (nested objects stored as text), and `text/plain` JSON for `navigator.sendBeacon`. Limits default to 256 KB, 100 fields, and 10,000 characters per field (`413` over the limit, `422` if every field is empty, `404` if the form is missing or paused). JSON callers (`Accept: application/json`, a JSON content type, or `X-Requested-With`) get `200` and `{"ok": true, "id": 123, "message": "Thanks! Your message has been sent."}`. A plain form gets `303 See Other`. Spam gets that same success, so the status code teaches a bot nothing.

## Send it with fetch()

To stay on the page, post JSON and ask for JSON. Record the load time before the visitor types, so the time trap has a real start:

```js
const startedAt = Date.now();
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  data._t = startedAt;
  data._page = location.href;
  const res = await fetch('https://forms.yourdomain.com/f/k3m9x2qapz', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(data),
  });
  const result = await res.json();
});
```

Show `result.message`. On failure, show `result.error`. The Embed tab's React snippet is a complete component. Vue, Svelte, Astro, and Next.js do this same `fetch()`. The demo's bug-report form is posted that way from an app. The endpoint cares about the origin and the body, not which framework rendered the button.

## Allowed websites are the CORS list

Allowed websites is one origin per line: `https://www.yourdomain.com`, or `https://*.yourdomain.com` for every subdomain. Browsers send `Origin` on a form post and on `fetch()`. Anything else gets `403`, and CORS preflights are answered only for origins you listed.

An empty list allows any website, which is handy while you test from `localhost`. Put the real origins in before the page is public, including a `github.io` or `pages.dev` host — a wildcard on your own domain does not cover those.

A request with no `Origin` is accepted. curl does not send one. The check stops another site from embedding your form. A script is the spam score's problem.

A [waitlist landing page](/guides/how-to-create-a-waitlist-landing-page/) that already has a signup API should keep it. This endpoint does not understand a referral code. Use it when the page is static and the job is to deliver a message.

## Score the spam, and keep what you catch

Every submission is scored. Each check adds points and a reason. Fifty or more is spam. Spam is stored, so a false positive can be rescued, and it never sends mail or calls a webhook. The sender still gets the ordinary success response.

| Check | Points | What it means |
| --- | --- | --- |
| Honeypot filled in | 100 | Default field `_gotcha` was not empty. |
| Sent too fast | 100 | Under the minimum (default 3 s). Needs `_t`. |
| Invalid timer | 60 | `_t` is not a positive number, or it is over a minute ahead. Missing `_t` skips this. |
| Too many links | 60 | Over the limit (default 3; `-1` means unlimited). |
| HTML or BBCode links | 60 | `<a href`, `[url=`, or `[link=`. |
| Your blocked phrase | 60 each | Whole-word match. One hit is spam. |
| Built-in phrase | 40 each | "SEO services", "backlinks", "crypto investment", "casino", "payday loan", "buy followers", plus about twenty more. Two hits are spam. |
| Gibberish | 50 | 45+ letters or digits in a row, URLs ignored. |
| Same value everywhere | 30 | Three or more fields, one repeated non-empty value. |
| Known spam sender | 50 | Salted IP hash you marked before. |

Your phrases are checked first, then the built-in list, and only three hits are recorded. A form with no `_t` (plain HTML, no `fb.js`) skips the timer, so the honeypot has to do that job. The function below is the kit's scorer. `valueText` comes from the parser; underscore fields arrive separately as `meta`.

```js
const { valueText } = require('./parse');

const THRESHOLD = 50;

const DEFAULT_BLOCKED = [
  'viagra', 'cialis', 'casino', 'crypto investment', 'bitcoin investment', 'forex signals', 'binary options',
  'seo services', 'backlinks', 'guest post', 'rank your website', 'first page of google', 'website traffic',
  'payday loan', 'loan offer', 'escort', 'porn', 'xxx', 'replica watches', 'buy followers', 'make money online',
  'work from home opportunity', 'whatsapp me', 'telegram me', 'unsubscribe from this list',
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordList = (text) => String(text || '').split(/[\n,]/).map((w) => w.trim().toLowerCase()).filter(Boolean);

function countLinks(text) {
  const m = text.match(/\bhttps?:\/\/[^\s<>"']+|\bwww\.[a-z0-9-]+\.[a-z]{2,}/gi);
  return m ? m.length : 0;
}

function score(fields, meta, form, ctx = {}) {
  const now = ctx.now || Date.now();
  const reasons = [];
  let points = 0;
  const add = (n, why) => { points += n; reasons.push(why); };

  const hp = form.honeypot_field || '_gotcha';
  if (meta[hp]) add(100, 'Honeypot field was filled in');

  if (meta._t !== undefined && meta._t !== '') {
    const t = Number(meta._t);
    const min = Number(form.min_seconds || 0);
    if (!Number.isFinite(t) || t <= 0 || t > now + 60000) add(60, 'Invalid form timer');
    else if (min > 0 && now - t < min * 1000) {
      add(100, `Sent ${((now - t) / 1000).toFixed(1)} s after the page loaded (minimum ${min} s)`);
    }
  }

  const values = Object.values(fields).map(valueText);
  const text = values.join('\n');
  const lower = text.toLowerCase();

  const links = countLinks(text);
  const maxLinks = Number.isFinite(Number(form.max_links)) ? Number(form.max_links) : 3;
  if (maxLinks >= 0 && links > maxLinks) add(60, `${links} links (limit ${maxLinks})`);
  if (/\[url=|\[link=|<a\s+href=/i.test(text)) add(60, 'HTML or BBCode links');

  const own = wordList(form.blocked_words);
  const hits = [];
  for (const [list, pts] of [[own, 60], [DEFAULT_BLOCKED, 40]]) {
    for (const w of list) {
      if (hits.length >= 3) break;
      const matched = new RegExp(`(^|[^a-z0-9])${escapeRe(w)}($|[^a-z0-9])`, 'i').test(lower);
      if (matched && !hits.some((h) => h.w === w)) hits.push({ w, pts });
    }
  }
  for (const h of hits) add(h.pts, `Blocked phrase "${h.w}"`);

  if (values.some((v) => /[A-Za-z0-9]{45,}/.test(v.replace(/https?:\/\/\S+/g, '')))) {
    add(50, 'Gibberish text');
  }
  if (values.length >= 3 && new Set(values.filter(Boolean)).size === 1) {
    add(30, 'Every field has the same value');
  }

  if (ctx.ipMarkedSpam) add(50, 'Sender was marked as spam before');

  return { spam: points >= THRESHOLD, score: Math.min(points, 999), reasons };
}
```

A normal note scores 0 and may notify you. Two built-in phrases score 80. One phrase from your own list scores 60.

The rate limit is 10 posts per visitor, per form, per 10 minutes (`SUBMIT_RATE_LIMIT`); the next is `429` and is not stored. Captcha is optional: set `TURNSTILE_*` or `HCAPTCHA_*`, restart, and pick it in Settings so the Embed tab includes the widget. Tokens arrive as `cf-turnstile-response` or `h-captcha-response`. With no secret set, that check is skipped. A bad token is `400`.

Spam sits in the Spam folder with its reasons and is deleted after 30 days (`SPAM_RETENTION_DAYS`). **Not spam** moves the row to the inbox and sends the email and webhooks it missed, once. **Spam** flags that sender next time.

## Email, webhooks, and the inbox

The inbox is the record. Mail is a notification on top of it. Set `SMTP_*` when you want a copy in your own mailbox; with it unset, the dashboard still collects every row. The demo contact form already has a redirect, email, and a webhook, and the demo waitlist form includes failed webhook deliveries so you can see a miss with nothing live. Demo mode only logs mail and simulates webhooks. A spam row fires neither. The row is stored before SMTP or the webhook runs, so a failed notification does not lose the message.

## Deploy it on a disk that survives the next push

SQLite is one file. A host that replaces the filesystem on deploy will throw the inbox away. Use a machine that keeps files: a small VPS, or Render, Fly, or Railway with a persistent disk or volume. Point `forms.yourdomain.com` at it and serve HTTPS.

On a VPS, copy `.env.example` to `.env`.

- `ADMIN_PASSWORD`: a long random string. `demo-admin` stays on your laptop.
- `PUBLIC_URL`: the origin with no trailing slash, such as `https://forms.yourdomain.com`.
- `TRUST_PROXY=true` behind Render, Fly, Railway, Nginx, Caddy, or Cloudflare, so the rate limit and the sender hash see the visitor's address.
- `SMTP_*`: only when you want email.

`npm start`, or the Docker image. `GET /healthz` should answer. Create the form, add the static origin with its scheme, paste the snippet, and send a test from the real page. A second test with the honeypot filled belongs in Spam, with no email and no webhook.

Keep the database file on that disk. The HTML can live on a host that sleeps. The form endpoint should stay awake, and `/healthz` belongs on a status page hosted somewhere else, so a full disk does not hide the outage notice too.

## FAQ

### Can I add a free contact form to a static website?

The page is free on the host you already use. `mailto:` costs nothing and depends on the visitor's mail app. A hosted service is often free until a monthly cap. Self-hosting costs whatever the machine with the disk costs. Demo mode needs no keys.

### How do I create an HTML form that sends me an email?

Point the form above at your endpoint and set `SMTP_*` there. `_replyto` sets Reply-To; otherwise the first email in the submission is used. `_subject` sets the subject. The form host sends the mail after the row is stored.

### Will this work on GitHub Pages, Netlify, Vercel, and S3?

Yes. Those hosts only serve the HTML. List every origin you submit from. `https://*.yourdomain.com` covers your subdomains. A `github.io` or `pages.dev` hostname needs its own line.

### What does a visitor see when the message is spam?

The same thank-you redirect, or the same `{"ok": true}` JSON, as a real message. The row is in Spam with the reasons, and nothing is emailed. Past 10 posts in 10 minutes the answer is `429` and the post is dropped.

### Do I have to add a captcha?

The honeypot, the time trap, the link limit, and both phrase lists run with no third-party account. Add Turnstile or hCaptcha per form when you want it. Until that secret key is set, the score still runs on its own.
