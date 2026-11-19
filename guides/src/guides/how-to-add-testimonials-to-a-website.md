---
title: How to Add Testimonials to Your Website (Self-Hosted Wall of Love + Embed Widget)
description: Add testimonials to a website with a self-hosted form, moderation, a Wall of Love, and a one-line script or iframe embed.
date: 2026-11-18
slug: how-to-add-testimonials-to-a-website
product: testimonial
query: how to add testimonials to website
queries:
  - how to add testimonials to a website
  - how to embed testimonials on a website
  - how to make a wall of love
related:
  - how-to-add-a-contact-form-to-a-static-website
  - how-to-create-a-waitlist-landing-page
---

Adding testimonials to a website means showing quotes from real customers at the moment a visitor decides whether to trust you. HTML you typed yourself goes stale, and it leaves no record that the person agreed to be shown. A hosted widget keeps the quotes in someone else's account. This guide is the self-hosted path: a public form, a moderation queue, a Wall of Love, and a one-line embed for a site you already have.

The examples come from a Testimonial Wall Kit. It runs on Node and Express, stores rows in SQLite, and falls back to a JSON file when that Node build has no SQLite. Demo mode needs no keys. The kit sends no email, calls no webhook, and adds no captcha.

## Why the quote has to be a real one

A price and a screenshot say what the product is. A testimonial says whether it worked for someone in a similar spot. Put that next to the decision: under pricing, beside a signup, or on its own wall.

A useful quote names a real person and says something specific. You should know who wrote it, you should have approved the wording, and you should be able to remove it when they ask. A form that stores consent, and a dashboard that approves a row before it is public, is what makes that possible.

A private message is a different job. A [contact form on a static website](/guides/how-to-add-a-contact-form-to-a-static-website/) delivers a note to an inbox. A testimonial is published, so it needs a review step that inbox does not have. A thread of replies under a post is [a comment section in HTML](/guides/how-to-add-a-comment-section-in-html/).

## Three ways to put quotes on a site

**Edit the HTML.** A blockquote, a name, and some stars. Honest for two quotes you will never collect again. Every typo is a deploy, and the client has nowhere to submit.

**Paste a hosted widget.** You get a form, a wall, and a script tag in an afternoon. The quotes live in their database. A fair trade when you do not want a process of your own.

**Host it yourself.** A small Node process stores each submission, serves the wall, and serves the embed. The marketing site never sees the POST. The collector sits on its own host, the same split a [waitlist landing page](/guides/how-to-create-a-waitlist-landing-page/) uses for signups. The rest of this guide is that design.

Node.js 20.12 or newer is enough. Node 22.5 or later (24 if you are choosing today) includes SQLite as `node:sqlite`. Express is the only dependency. From the kit directory, `npm install` then `npm run demo` serves `http://localhost:3000` with 17 sample testimonials and a demo banner. The admin password on that laptop is `demo-admin`. Delete `data/` to start over.

## What the form collects

`/submit` asks for a rating from 1 to 5, the quote, a name, an optional role, an optional company, an optional email, an optional photo link, and a consent checkbox. A live preview updates as they type. No photo means an initials avatar colored from the name.

- The quote must be 20 to 1,000 characters. Both ends are configurable.
- The name needs at least 2 characters. Name, role, and company stop at 80.
- Email is optional. It is stored for you and omitted from the wall, the widget, and the public JSON.
- A photo must be `https://` with no username or password, or a path inside the kit's public folder.
- Consent stays required. You are publishing someone's name.

Control characters are stripped and line breaks in the quote are kept. Cards are built with DOM APIs, and the element helper sets `textContent`, so a script tag in a quote is text:

```js
function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}
```

A honeypot named `website` sits off screen, out of tab order, with autocomplete off. People leave it empty. A filled honeypot gets HTTP 201 and `{ ok: true, status: "pending" }`, and nothing is stored.

## Save it as pending

`POST /api/testimonials` takes `rating`, `text`, `name`, and optionally `role`, `company`, `email`, `avatarUrl`, and `consent: true`.

```js
app.post('/api/testimonials', async (req, res) => {
  const body = req.body || {};
  if (body.website) {
    // Honeypot filled in → almost certainly a bot. Pretend it worked, store nothing.
    return res.status(201).json({ ok: true, status: 'pending' });
  }
  if (!submitLimit.hit(req.ip)) {
    return res.status(429).set('Retry-After', String(submitLimit.retryAfter(req.ip))).json({
      error: 'rate_limited',
      message: 'Too many submissions from this network. Please try again later.',
    });
  }
  const v = validate(body, 'public');
  if (v.error) return res.status(400).json(v);
  if (config.form.requireConsent && body.consent !== true) {
    return res.status(400).json({
      error: 'consent',
      message: 'Please tick the box to allow us to show your testimonial publicly.',
    });
  }
  const auto = config.form.autoApprove && v.value.rating >= config.form.autoApproveMinRating;
  const t = await db.create({
    ...v.value,
    consent: body.consent === true,
    status: auto ? 'approved' : 'pending',
    source: 'form',
    ipHash: ipHash(req.ip),
  });
  res.status(201).json({ ok: true, status: t.status, testimonial: publicItem(t) });
});
```

The default limit is 5 submissions per IP per 10 minutes. Over that is `429` and the row is dropped. A bad field is `400`. Success is `201`.

Automatic approval is off, so a real row is `pending` until you say otherwise. It is absent from the wall, the widget, and `GET /api/testimonials`. With automatic approval on, only a rating at or above the minimum (default 4) is published. The rest still wait.

| Status | Who sees it |
| --- | --- |
| pending | Admin only. This is the queue. |
| approved | Wall, embed, and the public JSON API. |
| hidden | Kept, and shown nowhere public. |

Featured is a flag on an approved row, not a fourth status. Featured rows sort first, which puts them on the top row of the wall and at the start of the widget. The average is the mean of approved ratings, rounded to one decimal.

The public object drops the email. The IP is stored as a salted SHA-256 hash. Set a fixed salt if those hashes should survive a restart.

```js
function publicItem(t) {
  return {
    id: t.id,
    name: t.name,
    role: t.role,
    company: t.company,
    rating: t.rating,
    text: t.text,
    avatarUrl: t.avatarUrl,
    initials: initials(t.name),
    featured: t.featured,
    createdAt: t.createdAt,
  };
}
```

## Moderate from the dashboard

`/admin` asks for `ADMIN_PASSWORD`. Empty means the dashboard is off and the API returns `503`. Demo mode with no password of your own uses `demo-admin`. Generate a real one before the site is public:

```bash
node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"
```

The tab stores the password in `sessionStorage` and sends `Authorization: Bearer` plus that value. Both sides are hashed with SHA-256 and compared with `crypto.timingSafeEqual`. After 10 failures from one IP inside 10 minutes, that IP is locked out for the rest of the window.

The top shows pending, live, featured, and the average. Tabs are Pending, Approved, Hidden, and All. Search matches name, role, company, email, and the quote.

Approve, Hide, Feature, Edit, and Delete are on each row. Featuring a pending quote also sets it to approved, so that click publishes it. Unfeaturing leaves the status alone. Edit changes name, role, company, email, rating, text, photo link, status, and the featured flag. Delete asks first and cannot be undone.

`PATCH /api/admin/testimonials/:id` saves an edit. `DELETE /api/admin/testimonials/:id` removes the row. Both require the bearer token. An unknown id is `404`.

CSV export includes the private email, as UTF-8 with a byte-order mark. A cell that starts with `=`, `+`, `-`, `@`, or a tab is prefixed so a spreadsheet does not treat it as a formula:

```js
function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
```

The same page builds the embed. Choices are light or dark, carousel or grid, a limit from 1 to 100, a minimum of any rating, 4 and up, or 5 only, featured-only, and a link to the form. A preview sits beside the script, the iframe, and a sample `GET` URL. The snippets use `PUBLIC_URL`. Leave it empty and they point at the origin you have open, which is localhost on a laptop.

Old quotes in email or a direct message still need a submission. Ask the person to use `/submit` so consent is on record, then fix wording with Edit.

## Embed the widget on your site

The Wall of Love is `GET /`. It loads approved quotes, featured first, up to `WALL_LIMIT` (default 200). The header shows the average and the count while the summary is on. Theme is light, dark, or auto, and the visitor can toggle it. Cards sit in a masonry of up to three columns. Link `/` from the marketing site, a signature, or an invoice.

Where the quotes should sit on that site, paste:

```html
<script src="https://reviews.yourdomain.com/widget.js" data-theme="light" data-layout="carousel" async></script>
```

The script inserts an iframe to `/embed` on its own origin, after the tag, or inside `data-target`. Page CSS cannot restyle the cards, and the widget cannot read the page. Height starts at 360 pixels for a carousel and 640 for a grid, then follows the embed page. The parent accepts the height message only from the widget origin and that frame, and clamps it between 60 and 20,000 pixels.

A builder that blocks scripts gets a plain iframe. It does not resize, so set the height yourself:

```html
<iframe src="https://reviews.yourdomain.com/embed?theme=light&layout=grid&limit=6"
        style="width:100%;height:640px;border:0" title="Testimonials"></iframe>
```

Script attributes, all optional: `data-theme` (`light` or `dark`), `data-layout` (`carousel` or `grid`), `data-limit` (1 to 100), `data-featured="true"`, `data-min-rating` (1 to 5), `data-sort` (`featured`, `newest`, or `rating`), `data-accent` (hex), `data-bg="transparent"`, `data-summary="false"`, `data-cta="true"`, `data-autoplay` (seconds; `0` is off, and playback pauses on hover and for reduced motion), and `data-target`. The iframe uses the same names as query parameters. `accent` has no hash mark. Flags are `featured=1`, `bg=transparent`, `summary=0`, and `cta=1`. The dashboard writes theme, layout, limit, minimum rating, featured, and the call to action. Add the rest by hand. Autoplay defaults to 6 seconds when the snippet omits it.

`GET /api/testimonials` is the same approved list as JSON: brand name, count, average, and items. `limit` is 1 to 500, default 50. `minRating`, `featured=1`, and `sort` match the widget. Emails are not included. `API_CORS_ORIGIN` defaults to any origin. The route allows 240 requests per IP per minute.

`EMBED_ALLOWED_ORIGINS` also defaults to any site. Set your own origins, separated by spaces, before launch. Only `/embed` may be framed. Other pages send `X-Frame-Options: DENY` and `frame-ancestors 'none'`. "Refused to connect" means the embedding origin is missing. Add it as the address bar shows it, scheme included, no trailing slash.

## One config file, one database

Environment variables override `config.js`. The form rules are the block you will change first:

```js
form: {
  minLength: num('TEXT_MIN_LENGTH', 20),
  maxLength: num('TEXT_MAX_LENGTH', 1000),
  requireConsent: bool('REQUIRE_CONSENT', true),
  allowAvatarUrl: bool('ALLOW_AVATAR_URL', true),
  askEmail: bool('ASK_EMAIL', true),
  autoApprove: bool('AUTO_APPROVE', false),
  autoApproveMinRating: num('AUTO_APPROVE_MIN_RATING', 4),
},
```

`BRAND_NAME`, `BRAND_LOGO_TEXT`, and an optional `BRAND_LOGO_URL` (a file under `public/`, or an `https://` URL) are the header. The sample name in the file is Lumen Studio. Replace it. Wall title, form intro, consent sentence, thank-you text, and the empty-wall sentence are the `copy` object. `THEME_ACCENT`, `THEME_ACCENT_2`, `THEME_STAR`, and the two backgrounds are hex.

SQLite at `data/testimonials.db` is the default. Rating must be 1 to 5. Status must be pending, approved, or hidden. If `node:sqlite` fails to load and you did not force it, the process switches to `data/testimonials.json` and logs that. `STORAGE=json` selects the file. `STORAGE=memory` is for tests and forgets every row on restart. JSON writes go to a temp file and are renamed into place.

```js
function open() {
  const storage = String(process.env.STORAGE || '').toLowerCase();
  if (storage === 'memory') return { db: jsonBackend(null), label: 'in-memory (resets on restart)' };
  const jsonFile = path.resolve(process.env.JSON_PATH || path.join(__dirname, 'data', 'testimonials.json'));
  if (storage === 'json') return { db: jsonBackend(jsonFile), label: `JSON file (${rel(jsonFile)})` };
  const sqliteFile = process.env.SQLITE_PATH === ':memory:'
    ? ':memory:'
    : path.resolve(process.env.SQLITE_PATH || path.join(__dirname, 'data', 'testimonials.db'));
  try {
    return { db: sqliteBackend(sqliteFile), label: `SQLite (${sqliteFile === ':memory:' ? 'in-memory' : rel(sqliteFile)})` };
  } catch (err) {
    if (storage === 'sqlite') throw new Error(`STORAGE=sqlite needs Node 22.5+ (node:sqlite): ${err.message}`);
    return { db: jsonBackend(jsonFile), label: `JSON file (${rel(jsonFile)}) — node:sqlite unavailable` };
  }
}
```

Thousands of rows fit in the JSON file. The file still has to live on a disk that survives deploy. One install is one brand. A second brand is a second process, with its own URL, password, and database.

## Deploy it, then try the real flow

Copy the example env file. Set `ADMIN_PASSWORD`, `PUBLIC_URL` with no trailing slash (the process rejects a value that does not look like `https://reviews.yourdomain.com`), and `BRAND_NAME`. Behind Render, Railway, Fly, Nginx, or Cloudflare, set `TRUST_PROXY=true` so limits see the visitor. Add `EMBED_ALLOWED_ORIGINS` when the real site is known.

`npm start` listens on `PORT` or 3000. `GET /healthz` returns ok, demo mode, the storage label, and the row count. Watch that URL from a [status page](/guides/how-to-make-a-status-page/) on another machine. A full disk should not take the outage notice down with it.

The kit includes a Dockerfile, a Fly config, and a Render blueprint with a persistent disk. Point `SQLITE_PATH` or `JSON_PATH` at that disk. On a VPS, `npm ci --omit=dev` and `npm start` under systemd or pm2, behind HTTPS, is enough. Back up `data/`. The CSV is the other copy.

Before sharing `/submit`, send a quote with a name and consent, and confirm the thank-you text says it waits for review. The wall and the widget should still omit it. Approve it, then confirm the card on both. Feature it, edit a typo, and reload. A honeypot submission should add no row. Delete the test when you are done.

GitHub Pages, Netlify, and S3 only need the script or the iframe. The Node process keeps the file. Keep it awake while people are submitting, because a cold start makes the form feel broken.

## FAQ

### Why is a new testimonial missing from the wall?

It is pending. Approve it in `/admin`. That is what stops a stranger from publishing with a POST. Automatic approval only publishes a rating at or above the cutoff, default 4.

### Can I add testimonials to a static website?

Yes. Leave the marketing site as files. The script or iframe loads the widget from the host that stores the rows. Put that origin on `EMBED_ALLOWED_ORIGINS`, or the browser refuses the frame. Use `GET /api/testimonials` when you want your own markup.

### Do I have to use SQLite?

No. Node 22.5 and newer use the built-in module. Node 20.12 through 22.4 logs that SQLite is unavailable and writes JSON instead. `STORAGE` forces either. The file has to persist across deploys either way.

### Will I get an email when someone submits?

No. Check Pending, or download the CSV. The thank-you screen says the quote waits for review, or that it is already live when automatic approval published it.

### Can one install collect quotes for several clients?

No. Brand, colors, and the database are one product. Run another copy for another brand.
