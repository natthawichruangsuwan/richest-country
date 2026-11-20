---
title: How to Make a URL Shortener
description: Make a URL shortener in Node.js with readable slugs, a 302 you can still change, click counts that skip bots, and no raw IP storage.
date: 2026-11-20
slug: how-to-make-a-url-shortener
product: shortlink
query: how to make a url shortener
queries:
  - how to build a url shortener
  - how to make a url shortener for free
  - how to create a url shortener javascript
related:
  - how-to-create-a-waitlist-landing-page
  - how-to-make-a-status-page
---

To make a URL shortener, store a short slug beside a long address, and when someone opens the slug, redirect them and record the visit. `go.yourdomain.com/spring` opens the long page, and you can see that it happened.

This is JavaScript for Node.js. A browser page can show a form and call your API, but the map of slug to destination has to live in a process you run, or the next phone has nothing to look up. The functions below come from a working shortener. The free edition is one Node file, zero packages, and a JSON file. The full edition adds SQLite, per-click analytics, bot filtering, link rules, and QR codes. Both use the same slug rules and the same kind of redirect.

## Generate a slug you can read aloud

A slug is the path. Six characters is enough to read from a slide or a podcast. Mixing `0` with `o`, or `1` with `l` and `i`, turns a correct link into a 404.

Drop those characters. The alphabet here is 31 symbols: `abcdefghjkmnpqrstuvwxyz23456789`. Six draws is 31^6, about 887 million combinations. The slug stays public. On the full kit, a password on the link is what keeps the destination off the redirect.

`byte % 31` is slightly biased, because a random byte is 0–255 and 256 is not divisible by 31. 31 times 8 is 248, so any byte at 248 or above is skipped and the rest fall evenly:

```js
const crypto = require('crypto');

const SLUG_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function randomSlug(len = 6) {
  const n = Math.max(4, Math.min(16, Number(len) || 6));
  const bytes = crypto.randomBytes(n * 2);
  let s = '';
  for (let i = 0; s.length < n; i++) {
    const b = bytes[i % bytes.length];
    if (b < 248) s += SLUG_ALPHABET[b % 31]; // 248 = 31 * 8, so no modulo bias
    if (i > n * 8) return s.padEnd(n, 'k');
  }
  return s;
}

const slug = randomSlug(6);
console.log(slug, slug.length, /^[abcdefghjkmnpqrstuvwxyz23456789]+$/.test(slug));
```

A custom slug is 1 to 64 characters: letters, numbers, dashes, and underscores, starting and ending with a letter or a number. Reserve your own paths, or a slug named `admin` or `qr` swallows the dashboard and the QR route:

```js
const SLUG_RE = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,62}[A-Za-z0-9])?$/;
const RESERVED = new Set(['admin', 'api', 'qr', 'healthz', 'fonts', 'robots', 'favicon', 'static', 'assets', 'login', 'logout', 'unlock', 'preview', 'theme', 'theme-config', 'sitemap', 'well-known']);

function checkSlug(slug, extraReserved = []) {
  const s = String(slug || '').trim();
  if (!SLUG_RE.test(s)) return 'Use 1–64 letters, numbers, dashes or underscores (start and end with a letter or number).';
  const low = s.toLowerCase();
  if (RESERVED.has(low) || extraReserved.map((x) => String(x).toLowerCase()).includes(low)) return `"${s}" is reserved. Pick another slug.`;
  return '';
}

console.log(checkSlug('spring') || 'ok');
console.log(checkSlug('qr'));
console.log(checkSlug('spring-sale') || 'ok');
```

Store the visible slug and a lower-case `slug_key` with a unique index. `/Spring` and `/spring` are one link. An empty field calls `randomSlug` and retries on a collision, adding a character after a run of misses. At length 6 that is rare unless the import is huge.

## Save the row, then choose 302 or 301

The free server keeps an array in memory and writes `data/links.json`. Creates and deletes write immediately. Clicks flush at most once a second, and again on exit. The write uses a temporary file renamed over `links.json`, so a crash leaves the previous file intact. Demo mode never touches the disk. One total per link is all that file needs to hold.

A row per visit needs a table. The full kit uses SQLite through `node:sqlite` on Node 22.5 and newer, and the same API falls back to JSON when that module is missing. The database is a file either way. A host that wipes the disk on deploy wipes every short link you have already printed.

The redirect reads a few columns. The real table also stores a title, tags, notes, a password hash, an expiry, a max-click cap, and separate human, unique, and bot counters. Lookup uses the lower-case key:

```js
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL,
    slug_key TEXT NOT NULL,
    url TEXT NOT NULL,
    redirect_type INTEGER NOT NULL DEFAULT 302,
    enabled INTEGER NOT NULL DEFAULT 1,
    clicks INTEGER NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX links_slug_key ON links (slug_key);
`);

const insert = db.prepare(
  'INSERT INTO links (slug, slug_key, url, redirect_type) VALUES (?, ?, ?, ?)'
);
insert.run('Spring', 'spring', 'https://example.com/spring-sale', 302);

const row = db.prepare(
  'SELECT slug, url, redirect_type, clicks FROM links WHERE slug_key = ?'
).get('spring');
console.log(row.slug, row.redirect_type, row.url);
```

Match one path segment. `GET` counts. `HEAD` redirects and leaves the counter unchanged. Unknown slugs return 404. A trailing slash is the same slug. `ask` below just fires one GET and one HEAD so you can see the result:

```js
const http = require('http');

const links = new Map([
  ['spring', { url: 'https://example.com/spring-sale', clicks: 0, redirectType: 302 }],
]);

function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end('Method not allowed');
    return;
  }
  let slug = '';
  try {
    slug = decodeURIComponent(new URL(req.url, 'http://x').pathname.slice(1)).replace(/\/$/, '');
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('This short link does not exist');
    return;
  }
  const link = links.get(slug.toLowerCase());
  if (!link) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('This short link does not exist');
    return;
  }
  if (req.method === 'GET') link.clicks += 1;
  const permanent = link.redirectType === 301 || link.redirectType === 308;
  res.writeHead(link.redirectType || 302, {
    Location: link.url,
    'Cache-Control': permanent ? 'public, max-age=3600' : 'private, no-store',
    'X-Robots-Tag': 'noindex',
  });
  res.end();
}

function ask(port, method, path) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, method, path }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, cache: res.headers['cache-control'] }));
    });
    req.end();
  });
}

async function main() {
  const server = http.createServer(handle);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const got = await ask(port, 'GET', '/Spring');
  const head = await ask(port, 'HEAD', '/spring');
  console.log('GET', got.status, got.location, got.cache);
  console.log('HEAD', head.status, 'clicks', links.get('spring').clicks);
  server.close();
}

main();
```

A **302** is temporary. The response sends `Cache-Control: private, no-store`, so the next click comes back to your server. Change the destination, disable the link, or expire it, and the following visit sees the new answer. 302 is the default. The free server always sends it, plus `Referrer-Policy: unsafe-url`, so the destination can see `https://go.yourdomain.com/spring`. The full kit sends `strict-origin-when-cross-origin` on every response, so the destination sees the origin and the slug stays in your logs.

A **301** is permanent. The full kit treats 301 and 308 as cacheable and sends `Cache-Control: public, max-age=3600`. A browser can reuse that hop for an hour, so the repeat visit is missing from the count. Pick 301 when the destination is finished. 307 and 308 are the method-preserving pair. A short link is a GET, so the useful choice is 302 or 301. The allowed set is 301, 302, 307, and 308.

An expired link, or one that has hit its max human clicks, returns **410** and a plain page. A date with no time means the end of that UTC day. A disabled link returns **404**, the same as an unknown slug. A password-protected link shows a password page and records the click only after the password matches. The password is a scrypt hash, and the destination stays out of the HTML until the check succeeds.

Copy the visitor's query string onto the destination when that key is absent. `/spring?ref=sms` opens the long URL with `ref=sms` added, up to 30 keys. UTM tags are written on create and read back if a pasted URL already has them.

## Count the click, and keep the IP out of the row

Hash the IP and the User-Agent with a salt you set once, and keep a prefix of the digest. That prefix is the visitor id. The same browser on the same network hashes the same way, so the second visit is a repeat and `is_unique` stays 0. A different browser or network is a new hash. Leave `HASH_SALT` alone. Changing it makes every returning visitor look new.

```js
const crypto = require('crypto');

const hash = (v, salt) => crypto.createHash('sha256').update(`${salt}|${v}`).digest('hex').slice(0, 32);

const HASH_SALT = 'set-this-once-and-keep-it';
const ip = '203.0.113.10';
const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
const visitor = hash(`${ip}|${ua}`, HASH_SALT);

const row = {
  link_id: 1,
  visitor_hash: visitor,
  is_unique: 1,
  is_bot: 0,
  referrer: 'news.ycombinator.com',
  country: 'US',
  device: 'Desktop',
  browser: 'Chrome',
  os: 'macOS',
};
console.log(row.visitor_hash, row.visitor_hash.length);
console.log('raw ip in the row:', JSON.stringify(row).includes(ip));
```

The raw address is absent from that row and from the CSV. The export keeps the first 12 hex characters of the hash, plus time, slug, unique flag, bot flag, referrer host, country, device, browser, and OS. The rate limiter does see the IP, so one client cannot flood redirects (600 per IP per minute by default). That entry expires with the window and is never inserted into `clicks`.

Country comes from a header your proxy already added (`CF-IPCountry`, or the Vercel, CloudFront, or Fastly equivalent). With no such header, the region in `Accept-Language` (`en-GB` becomes GB) is a rough guess. There is no GeoIP database and no outbound lookup. The referrer is stored as a hostname (`t.co` becomes `x.com`). Your own host counts as direct. Visitors get a short privacy note: no cookie on the click, no IP address, no third-party script. The only cookie is the admin session.

## Filter bots and link-preview crawlers

Slack, Discord, iMessage, WhatsApp, Facebook, LinkedIn, and X fetch a new link to draw a preview card. Counting every `GET` shows a click before any person opens it. Crawlers, uptime checks, and `curl` do the same.

The full kit classifies the request first. An empty User-Agent matches. So does `Purpose: prefetch` or `Sec-Purpose: preview`. Known preview agents match on the User-Agent:

```js
const BOT_RE = /bot\b|bot\/|crawl|spider|slurp|facebookexternalhit|facebookcatalog|meta-externalagent|embedly|quora link preview|showyoubot|outbrain|pinterest|vkshare|w3c_validator|whatsapp|telegrambot|discordbot|slackbot|slack-imgproxy|linkedinbot|twitterbot|skypeuripreview|redditbot|applebot|googlebot|bingbot|yandex|baiduspider|duckduckbot|petalbot|semrush|ahrefs|mj12bot|headlesschrome|phantomjs|lighthouse|pingdom|uptimerobot|statuscake|monitor|preview|curl\/|wget\/|python-requests|python-urllib|aiohttp|httpx|go-http-client|okhttp|java\/|libwww|axios\/|node-fetch|undici|postman|insomnia|scrapy|feedfetcher|validator|^$/i;

function isBot(ua, headers = {}) {
  const purpose = String(headers['sec-purpose'] || headers.purpose || headers['x-purpose'] || headers['x-moz'] || '').toLowerCase();
  if (purpose.includes('prefetch') || purpose.includes('preview')) return true;
  return BOT_RE.test(String(ua || '').trim());
}

const browser = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
console.log('browser', isBot(browser));
console.log('slack', isBot('Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'));
console.log('empty', isBot(''));
console.log('prefetch', isBot(browser, { purpose: 'prefetch' }));
```

A bot is still redirected. The visit is stored with `is_bot` set and left out of the human total and the unique total, so the dashboard can show how many were filtered. With `RECORD_BOTS` off, the detail row is skipped and only the bot counter increments. `HEAD` never reaches this function.

The free server skips this filter. Every `GET` of a real slug adds one, including a chat preview. Treat that total as requests. Use the filtered counter when the number should mean a person.

Point uptime checks at `/healthz` (or `/health` on the free server). That route is JSON, and it is not a slug. A checker that hits `/spring` with a browser User-Agent will inflate the count. A [status page](/guides/how-to-make-a-status-page/) should watch the health URL from a different machine.

## Reject a destination that should not be shortened

Creating a link stays behind the admin password or an API key. A public paste box turns the domain into an open redirect, and both phishing pages and cloud-metadata addresses show up once that box is indexed.

Check the destination on the way in, so a bad CSV row fails closed:

```js
const net = require('net');

function isPrivateHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h === '0.0.0.0') return true;
  if (net.isIPv4(h)) {
    const [a, b] = h.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (net.isIPv6(h)) return h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:');
  return false;
}

const domainMatch = (host, domain) => {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  return h === domain || h.endsWith('.' + domain);
};

function checkDestination(input, opts = {}) {
  let raw = String(input || '').trim();
  if (!raw) return { error: 'url', message: 'Enter the destination URL.' };
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = 'https://' + raw; // "example.com/pricing" → https://
  if (raw.length > (opts.maxLength || 4096)) return { error: 'url', message: 'That URL is too long.' };
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { error: 'url', message: 'That does not look like a valid URL.' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'url', message: 'Only http:// and https:// links are allowed.' };
  if (u.username || u.password) return { error: 'url', message: 'URLs with a username or password are not allowed.' };
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') && !net.isIP(host.replace(/^\[|\]$/g, '')) && host !== 'localhost') return { error: 'url', message: 'Enter a full domain name, e.g. https://example.com/page.' };
  for (const own of opts.ownHosts || []) {
    if (own && host === String(own).toLowerCase()) return { error: 'loop', message: 'A short link cannot point to this shortener itself.' };
  }
  if (!opts.allowPrivate && isPrivateHost(host)) return { error: 'blocked', message: 'Links to private or local network addresses are not allowed.' };
  const blockedBy = (opts.blocked || []).find((d) => d && domainMatch(host, d));
  if (blockedBy) return { error: 'blocked', message: `Links to ${blockedBy} are blocked by the link-safety list.` };
  const allowed = (opts.allowed || []).filter(Boolean);
  if (allowed.length && !allowed.some((d) => domainMatch(host, d))) return { error: 'not_allowed', message: `Only links to ${allowed.join(', ')} are allowed.` };
  return { value: u.toString() };
}

const opts = { blocked: ['evil.example'], ownHosts: ['go.example.com'] };
console.log(checkDestination('example.com/pricing', opts).value);
console.log(checkDestination('http://169.254.169.254/', opts).error);
console.log(checkDestination('https://go.example.com/spring', opts).error);
console.log(checkDestination('https://phish.evil.example/a', opts).error);
```

Only `http` and `https` pass. A username or password in the URL is rejected. `example.com/pricing` is rewritten to `https://example.com/pricing`. `localhost`, link-local, and private ranges are rejected unless you allow them for a local demo. A destination on the shortener's own host is rejected, which stops a loop. A blocklist matches the domain and its subdomains, and adding a domain there also disables links that already point at it. An allow-list, when set, means only those domains can be shortened. `www` is stripped first, so `example.com` covers `www.example.com`.

## Serve it on a domain you own

`https://go.yourdomain.com/spring` is what you publish. The path is the slug. The host is yours, so next year `spring` can point at a new page and every email, bio, and poster still works.

Set `PUBLIC_URL` on the full kit, or `BASE_URL` on the free server, to that origin with no path and no trailing slash. Build copied links, CSV rows, and QR codes from that setting. Building them from the request `Host` header mints `localhost` links as soon as a proxy is wrong. A [waitlist landing page](/guides/how-to-create-a-waitlist-landing-page/) follows the same rule for referral URLs, and a long referral link is a normal thing to put behind a slug for a slide or a card.

Point DNS at the process and terminate HTTPS in front. Turn `TRUST_PROXY` on so the rate limit and the visitor hash see the caller. Send `/` to your main site with `HOME_URL` or `ROOT_REDIRECT`. Leave it empty and the bare domain shows a one-line note that it is for short links.

The process has to stay awake. A host that sleeps after a short idle stretch turns every published link into a timeout. Keep the machine running, put the database on a disk that survives deploys, and back up that one file (`links.db`, or `links.json` on the free server).

Cloudflare in front adds HTTPS, a layer against floods, and `CF-IPCountry` for the country column. Use Full (strict) TLS, and leave caching at the default. The 302 already says `Cache-Control: private, no-store`, so the click reaches your process.

## Put the short link in the QR code

Encode `https://go.yourdomain.com/spring`, the short link, so a poster stays valid when you fix a typo or move the campaign. The image is drawn on your server. There is no QR account and no call to another API.

`qr.js` is a byte-mode encoder for versions 1 through 40, error correction L, M, Q, and H. M is the default, about 15 percent recovery. Use Q or H when the code will be small or might get scratched. Run this from the kit folder, next to that file:

```js
const qr = require('./qr');

const text = 'https://go.example.com/spring';
const code = qr.encode(text, { ecc: 'M' });
const svg = qr.toSvg(code, { fg: '#111111', bg: '#ffffff', margin: 4 });
console.log(text, 'version', code.version, 'svg', svg.startsWith('<svg'));
```

Active links with no password also have public images at `/qr/spring.svg` and `/qr/spring.png`. Size, colors, margin, and error correction are query parameters. A password-protected link has no public QR image, so a preview fetch cannot skip the password page. The dashboard can still draw one while you are logged in. Set `PUBLIC_URL` before you print, or the squares contain `localhost`.

`/spring+` shows a preview page with the title, the destination, and the QR code, and that view is not a click. Turn previews off when every visit should go straight through.

## Run the free server first

The free path needs Node 18 or newer and nothing to install. From the Lite folder:

```bash
node server.js --demo
```

Open `/admin` with the password `demo-admin`. Sample links for a fictional company stay in memory. Create a slug, request it, and the total goes up by one. `GET /health` returns a small JSON body. Unknown slugs get a plain 404.

For a real domain, set a long admin password and the public origin:

```bash
ADMIN_PASSWORD="a-long-random-string" BASE_URL="https://go.yourdomain.com" HOST="0.0.0.0" node server.js
```

Put HTTPS in front, set `TRUST_PROXY=1` and `COOKIE_SECURE=1`, and keep `data/links.json`. You then have custom slugs, a 302, a total per link, a dashboard password, and reserved paths. Per-click analytics, bot filtering, a 301 option, expiry, a password on one link, a domain blocklist, and QR codes are the full kit.

That kit wants Node 20.12 or newer and Express. SQLite is used when Node provides `node:sqlite`. `npm run demo` loads a fictional company and sample clicks, with no API keys. Log in at `/admin` with `demo-admin`, open `/spring` in a private window, and confirm the click is on that link's chart.

Before a real link goes out, check three things. `curl -I` shows 302, a `Location`, and `Cache-Control: private, no-store`. A browser visit moves the human count by one. Editing the destination changes where the next 302 goes. When those three hold, the shortener works. The remaining question is whether the number on the dashboard means a person.
