---
title: How to Add a Comment Section in HTML (Self-Hosted, No Disqus)
description: Add a comment section in HTML on a static site with a self-hosted Node and SQLite widget, moderation, and spam checks.
date: 2026-11-19
slug: how-to-add-a-comment-section-in-html
product: comments
query: how to add a comment section in html
queries:
  - add comments to static site
  - self hosted comment system
related:
  - how-to-add-a-contact-form-to-a-static-website
  - how-to-add-testimonials-to-a-website
  - how-to-make-a-status-page
---

To add a comment section in HTML, put a form under the post and send each comment to a small server that stores it. The HTML can draw the box. It cannot remember what anyone typed. A static host returns a file and then forgets the request, so the comment has to land in a database you control, wait for approval, and come back as escaped HTML. This guide is that path: one script tag on the page, a Node process with SQLite, a honeypot and a rate limit, and a moderation flag. No Disqus account, and no comments living in someone else's database.

The code is from a Comments Widget Kit. It runs on Node.js 22.13 or newer, uses the SQLite built into Node (`node:sqlite`), and has no npm packages to download. Demo mode needs no keys.

## A file cannot store a comment

When a reader opens a post, the host looks up `index.html` and sends it. A form whose `action` is that same page comes back as the HTML again, a 404, or a 405. GitHub Pages, an S3 website endpoint, and a Netlify or Vercel static export all behave that way until you attach a function, and that function is a backend you then have to write.

Saving comments inside the HTML fails for the same reason. You would redeploy for every reply, two people posting at once would overwrite each other, and a script tag in a comment would run in the next reader's browser.

The browser can already POST JSON. Leave the post where it is and point the form at a process on another origin, such as `https://comments.yourdomain.com`. That process writes a row and later returns the approved thread. A [contact form on a static website](/guides/how-to-add-a-contact-form-to-a-static-website/) uses the same split for a private message. A comment is public, so it also needs an approval step that inbox does not.

## Three places the row can live

**Paste a hosted widget.** Disqus and the other hosted boxes are one script tag and an account. They store the thread and handle replies. The free tier usually adds branding, ads, or a slow third-party script, and the comments sit in their database. If the account closes, the thread goes with it. A fair trade when you want something up this afternoon and you do not care where the text lives.

**Store the thread in a GitHub repo.** giscus writes to GitHub Discussions. utterances writes to GitHub Issues. Both are free, and there is no comment server to run. Readers need a GitHub account, the issues or discussions are public, and moderation is GitHub's. That fits a docs site whose readers already have accounts. It is a poor fit for a blog where someone should type a name and a paragraph.

**Host it yourself.** A small Node process stores each comment in one SQLite file, serves the thread, and serves the form. You approve before a stranger's words are public. The marketing site never handles the POST. You pay for a machine that keeps the file. The rest of this guide is that design.

You can try the kit with no accounts. `npm install` only checks the Node version, and `npm run demo` serves `http://localhost:3000`. Open `/demo.html` for a pretend blog and `/admin` for the queue (password `demo-admin`). The sample is a fictional food blog with three posts, replies, a few waiting comments, and some caught spam. Demo data is never loaded into a database that already holds comments.

## Paste one script tag

The comments appear where the tag is. `data-page` is the id of the thread. Keep that string forever, even if the URL changes, or the comments stay on the old id.

```html
<section id="comments">
  <script src="https://comments.yourdomain.com/comments.js"
          data-page="/blog/my-first-post"
          data-title="My first post"
          data-theme="auto"
          async></script>
</section>
```

`data-title` is what the dashboard and the webhook show. `data-url` is the canonical link from the dashboard; the default is the current URL without the hash. `data-theme` is `light`, `dark`, or `auto`. `data-accent` is a hex color such as `#0f766e`. `data-sort` is `oldest` or `newest`. `data-target` is a CSS selector to render into, instead of immediately after the tag.

On a blog index, a second script fills every count in one request. Approved comments only, replies included:

```html
<a href="/blog/my-first-post">My first post</a>
· <span data-comment-count="/blog/my-first-post">0 comments</span>
<script src="https://comments.yourdomain.com/count.js" async></script>
```

`data-zero`, `data-one`, and `data-many` change the wording. `{n}` in `data-many` is the number. The widget renders inside a shadow root, so the page CSS cannot restyle the cards by accident, and the widget cannot restyle the page. Theme it with variables on `.comments-widget`: `--cw-accent`, `--cw-surface`, `--cw-text`, `--cw-font`, and `--cw-radius`.

Hugo, Jekyll, Eleventy, and Astro pass the post path as `data-page`. A single-page app calls `window.CommentsWidget.reload()` after navigation, or inserts the script again with the new page id.

## List the thread, then accept a post

SQLite is one file, WAL mode, no database server. The table that matters is `comments`. Top-level rows have `parent_id` null. A reply points at a top-level comment. Status is `pending`, `approved`, or `spam`.

```sql
CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  page        TEXT    NOT NULL,
  page_title  TEXT    NOT NULL DEFAULT '',
  page_url    TEXT    NOT NULL DEFAULT '',
  parent_id   INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  email_hash  TEXT    NOT NULL DEFAULT '',
  body        TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'approved', 'spam')),
  is_admin    INTEGER NOT NULL DEFAULT 0,
  ip_hash     TEXT    NOT NULL DEFAULT '',
  user_agent  TEXT    NOT NULL DEFAULT '',
  spam_reason TEXT    NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
```

The email address is never stored. The column is an HMAC of the address, used for the avatar color and for the "returning commenter" check. The visitor IP is stored as a keyed hash too.

`GET /api/comments?page=/blog/my-first-post` returns only approved rows, nested one level, plus a signed form token and the widget settings. `sort=newest` reverses the top level. Replies stay in the order they were posted.

```js
function threadFor(page) {
  const rows = store.approvedForPage(page);
  const top = [];
  const byId = new Map();
  for (const r of rows) if (!r.parent_id) {
    const pc = { ...publicComment(r), replies: [] };
    byId.set(r.id, pc);
    top.push(pc);
  }
  for (const r of rows) if (r.parent_id && byId.has(r.parent_id)) {
    byId.get(r.parent_id).replies.push(publicComment(r));
  }
  return { top, count: rows.filter((r) => !r.parent_id || byId.has(r.parent_id)).length };
}
```

`publicComment` sends the id, parent, name, initials, hue, author flag, rendered `html`, and time. It does not send the raw body, the email hash, or the IP hash.

`POST /api/comments` takes JSON: `page`, `name`, optional `email`, `body`, optional `parent_id`, optional `title` and `url`, the form `token`, and `website` (the honeypot, empty for a person). Success is `201`. A live comment returns `status: "approved"` and the public object. A comment that is waiting returns `status: "pending"`, `comment: null`, and a `preview` only the poster sees. A spam row uses that same pending answer. A missing page id is `400`. A body over 32 KB is `413`.

A reply to a reply is stored on the top-level comment, so the thread stays one level deep. `ALLOW_REPLIES=false` turns replies off. The parent must be approved and on the same page. Readers cannot edit or delete their own rows. You do both from the dashboard.

`GET /api/counts?page=/a&page=/b` returns the approved totals, up to 100 pages, cached for 30 seconds. The count script writes the number with `textContent`. `GET /healthz` is the check your host should watch.

## Escape the text before you render it

The dangerous moment is putting a stranger's string into HTML. Do the escape first, then allow a few Markdown patterns on the already-safe text. A pasted `<script>` or `<img onerror>` stays text, because `<` is already `&lt;`.

```js
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

function render(src) {
  const text = esc(String(src ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n')).trim();
  if (!text) return '';
  const blocks = text.split(/\n{2,}/);
  const out = [];
  for (const block of blocks) {
    let para = [];
    let quote = [];
    const flush = () => {
      if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
      if (quote.length) out.push(`<blockquote>${quote.map(inline).join('<br>')}</blockquote>`);
      para = []; quote = [];
    };
    for (const line of block.split('\n')) {
      if (/^&gt;\s?/.test(line)) { if (para.length) flush(); quote.push(line.replace(/^&gt;\s?/, '')); }
      else { if (quote.length) flush(); para.push(line); }
    }
    flush();
  }
  return out.join('');
}
```

`inline` runs after that escape. It turns bold, italic, code, strike, and links into tags. Links are only `http://` and `https://`, and each one gets `rel="nofollow ugc noopener noreferrer"` plus `target="_blank"`. A `javascript:` URL never becomes an href. Names never go through `render`.

The widget may set `innerHTML` on the comment body, and only there, because `c.html` already went through `render`. Names go through `textContent`:

```js
function el(tag, attrs, children) {
  var n = document.createElement(tag);
  if (attrs) for (var k in attrs) {
    if (!Object.prototype.hasOwnProperty.call(attrs, k) || attrs[k] === null || attrs[k] === undefined || attrs[k] === false) continue;
    if (k === 'text') n.textContent = attrs[k];
    else if (k === 'className') n.className = attrs[k];
    else n.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
  }
  (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
  return n;
}

var body = el('div', { className: 'cw-body' });
body.innerHTML = c.html; // escaped, then Markdown-lite, on the server
el('span', { className: 'cw-name', text: c.name });
```

A blank line starts a paragraph. A line that was `> quote` is a blockquote, matched after escaping as `&gt;`. That is the whole formatter.

## Stop the obvious spam before it is a row

The checks run in order. A failure answers with `{ error, code }` and, except for a blocked word, stores nothing.

The honeypot is a field named `website` (or `url_hp`). The widget puts it off screen, out of tab order, with autocomplete off. People leave it empty. A filled honeypot increments a "bots blocked" counter and returns `400` with code `SPAM`.

The rate limit is in memory, per visitor, per 10 minutes. The default is 5 (`COMMENT_RATE_LIMIT`). Over that is `429` and `RATE_LIMIT`.

```js
function limited(key, max, windowMs) {
  const t = now();
  let b = buckets.get(key);
  if (!b || t - b.start >= windowMs) { b = { start: t, n: 0 }; buckets.set(key, b); }
  b.n += 1;
  return b.n > max;
}

// inside postComment:
if (clean(body.website ?? body.url_hp ?? '', 50)) {
  store.bump('blocked_total');
  throw new HttpError(400, 'Your comment could not be posted.', 'SPAM');
}
if (limited(`c:${ipHash}`, C.rateLimit, 10 * MIN)) {
  throw new HttpError(429, 'You are commenting too fast. Please wait a few minutes.', 'RATE_LIMIT');
}
```

The form also carries a signed token from the GET, bound to the page: the open time in base 36, a dot, and an HMAC of that time plus the page id. `MIN_SUBMIT_SECONDS` defaults to 3. Faster than that is `400` and `TOO_FAST`. A missing, forged, or two-day-old token is `TOKEN`. A bot that POSTs without loading the widget never has a valid token.

More than `MAX_LINKS` links (default 2) is `TOO_MANY_LINKS`. The same text from the same visitor on the same page within 10 minutes is `409` and `DUPLICATE`. Over `MAX_COMMENT_LENGTH` characters (default 4000) is `TOO_LONG`. Shorter than 2 characters is `VALIDATION`.

A phrase in `BLOCKED_WORDS` is stored as `spam` instead of refused. The default list is viagra, casino bonus, crypto giveaway, payday loan, and seo services. The poster is told the comment is awaiting approval. **Not spam** in the dashboard rescues the row. Set `TRUST_PROXY=true` behind a proxy, or every visitor shares one address and the rate limit locks the site. `ALLOWED_ORIGINS` is the CORS list. Leave `*` on localhost, then set the real origins, including a `github.io` or `pages.dev` host.

## Approve it before anyone else can see it

Nothing is public until you say so, unless you change the mode. The default is `manual`: a clean comment is `pending`. It is absent from the GET, the counts, and everyone else's widget. The poster still sees their own preview, labeled awaiting approval.

```js
const word = blockedWords.find((w) => lower.includes(w));
let status = 'pending';
let reason = '';
if (word) { status = 'spam'; reason = `blocked word: ${word}`; }
else if (settings.moderation === 'auto') status = 'approved';
else if (settings.moderation === 'known') status = store.isKnown(emailHash) ? 'approved' : 'pending';
```

| Mode | What a clean comment does |
| --- | --- |
| manual | Waits in Pending. This is the default. |
| known | Publishes if this email hash already has an approved comment. Everyone else waits. |
| auto | Publishes as soon as the spam checks pass. |

`known` uses the email hash. The address is never shown. With `REQUIRE_EMAIL=false`, a name-only comment always waits in that mode.

`/admin` asks for `ADMIN_PASSWORD`. No password and no `ADMIN_PASSWORD_HASH` means login returns `503`. The queue opens on Pending. Approve, Spam, Reply, and Delete work per row or in bulk. Delete removes the replies. A dashboard reply uses `ADMIN_DISPLAY_NAME` (default `Author`), shows an Author badge, and approves the pending parent. Closing threads keeps old comments visible and makes a POST return `403` `CLOSED`.

A comment that is not spam can POST to `WEBHOOK_URL` as JSON, Slack, or Discord. A signed JSON body uses `X-Comments-Signature`. A failed webhook does not block the post, and the kit sends no email. The widget sets no cookie.

A [testimonial wall](/guides/how-to-add-testimonials-to-a-website/) publishes a quote you asked for. A comment section publishes a thread under one post.

## Put the database on a disk that survives deploy

SQLite is one file, plus a `-wal` file while the process runs. A host that replaces the filesystem on deploy will throw the thread away. Use a VPS, or Render, Fly, or Railway with a disk. Point `DATA_PATH` at that disk (default `data/comments.db`). The kit ships a Dockerfile, a Render blueprint, and a Fly config for this process. The static site does not need them.

Copy `.env.example` to `.env` and set four values.

- `ADMIN_PASSWORD`: a long random string. `demo-admin` stays on your laptop.
- `PUBLIC_URL`: `https://comments.yourdomain.com`, with no trailing slash.
- `ALLOWED_ORIGINS`: the blog origins, space-separated.
- `TRUST_PROXY=true` when a proxy sits in front.

`npm start` listens on `PORT` or 3000. Watch `GET /healthz` from a [status page](/guides/how-to-make-a-status-page/) on another machine. Then paste the Install snippet under a real post, wait a few seconds, and confirm a new comment stays hidden until you approve it. A honeypot submission should add no row.

GitHub Pages, Netlify, Vercel, and S3 only serve the HTML. Keep the Node process awake. Back up the database, or run `sqlite3 comments.db ".backup backup.db"`. One volume means one process. A second brand is a second process. Say in the privacy policy that comments store the name and the text submitted. An email is kept only as a hash.

## FAQ

### Can I add a comment section with only HTML?

You can add the form. The comments need a server. `mailto:` opens the visitor's mail app and never builds a thread. A hosted widget or this endpoint is what a later reader sees. The page itself stays plain HTML either way.

### How is this different from Disqus?

Disqus stores the thread in their account. This kit stores it in your SQLite file and loads the script from your host. You moderate in `/admin`. You also run the process and the disk.

### Will it work on GitHub Pages and other static hosts?

Yes. Those hosts serve the post. The script and `count.js` call the comments server. Put the site's origin in `ALLOWED_ORIGINS`, scheme included. A missing origin is why the widget says the comments could not be loaded.

### How does the comment section avoid XSS?

The server HTML-escapes the whole comment, then applies a short Markdown list to that escaped string. Names and labels go through `textContent`. The widget's only `innerHTML` write is the server-rendered `html` field. A `<script>` in the body is shown as text.

### Do I have to run a separate database server?

No. Comments live in one SQLite file next to the process. Node 22.13 or newer includes `node:sqlite`. The file has to sit on a disk that survives the next deploy. Set `DATA_PATH` to that path.
