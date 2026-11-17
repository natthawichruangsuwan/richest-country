---
title: How to Make a Donation Leaderboard with Stripe
description: Build a live donation leaderboard that credits points only after a verified Stripe payment, resets every week in a real time zone, and stays honest when the same webhook arrives twice.
date: 2026-11-16
slug: how-to-make-a-donation-leaderboard-with-stripe
product: leaderboard
query: how to make a donation leaderboard
queries:
  - how to create a donation leaderboard
  - how to make a donation leaderboard with Stripe
  - how to build a Stripe-powered leaderboard
related:
  - how-to-create-a-waitlist-landing-page
  - how-to-make-a-status-page
---

A donation leaderboard is a public ranking that moves when someone pays. Visitors pick a cause, a country, a team, or a character, send money through Stripe Checkout, and watch that entry climb a live board. The interesting part is not the HTML list. It is making the ranking trustworthy: points should come from a paid Checkout Session, not from a number the browser volunteered, and a replayed webhook should never count twice.

This guide walks through that design as it works in a production kit: configurable branding, points computed at read time, a Monday-to-Monday weekly reset in a named time zone, and a free minigame that also refuses to trust the client. You can follow the same architecture in your own repo, or start from the kit this code is taken from.

## What you are actually building

Three pieces have to work together:

1. A checkout flow that collects a small, structured payload (who paid, which entry they backed, an optional name and message) without putting secret keys in the page.
2. A webhook endpoint that verifies Stripe's signature, checks the event type and payment status, and credits the donation exactly once.
3. A read API that totals those donations into a board — this week and all-time — and renders a podium, a searchable list, and a recent-payments feed.

Everything else is product: weekly champions, a hall of fame, share links, a theme, a legal page. Those matter once the money path is honest.

If you only store scores in `localStorage`, you have a personal best, not a leaderboard. A board needs a shared store and a server that decides what a payment is worth.

## Do not credit the success URL

Stripe Checkout will send the donor back to a success URL you choose. That redirect is a convenience for the visitor. It is not proof of payment. Anyone can open the URL, add query parameters, or replay it.

The reliable signal is the `checkout.session.completed` webhook, and only when `payment_status` is `paid`. The kit creates the Checkout Session on the server (`POST /api/contribute`) and puts the country, name, message, and other display fields in the session `metadata`. The browser never tells the server "add 5,000 points." It only starts Checkout. The webhook is what writes the row.

That split is the whole security model. If you take one thing from this guide, take that.

## Verify the webhook, then make it idempotent

A webhook handler has to do three unglamorous things well: reject unsigned events, reject stale events, and survive retries.

Stripe signs the raw request body with the endpoint's signing secret. The header looks like `t=<timestamp>,v1=<hex>`. The expected signature is HMAC-SHA256 of `timestamp + '.' + raw_body`. Compare it with a constant-time function, and reject events whose timestamp is older than a short window (five minutes is a reasonable default). If a Stripe secret key is configured but the webhook secret is missing, refuse the event outright — otherwise anyone who can POST to `/webhook` could invent a payment.

Here is the verification and credit path, cleaned up from the kit's `server.js` but with the same checks:

```js
app.post('/webhook', express.raw({ type: '*/*' }), async (req, res) => {
  if (!WEBHOOK_SECRET) {
    if (STRIPE_SECRET_KEY) {
      return res.status(500).send('webhook secret not configured');
    }
  } else {
    const sig = String(req.headers['stripe-signature'] || '');
    const parts = sig.split(',').map((x) => x.split('='));
    const t = (parts.find((x) => x[0] === 't') || [])[1];
    const v1s = parts.filter((x) => x[0] === 'v1').map((x) => x[1] || '');
    if (!t || Math.abs(Date.now() / 1000 - Number(t)) > 300) {
      return res.status(400).send('bad sig');
    }
    const expected = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(t + '.' + req.body)
      .digest('hex');
    const ok = v1s.some(
      (v) =>
        v.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v))
    );
    if (!ok) return res.status(400).send('bad sig');
  }

  const ev = JSON.parse(req.body);
  if (ev.type === 'checkout.session.completed' && ev.data.object.payment_status === 'paid') {
    const s = ev.data.object;
    await credit(s.metadata.country, s.amount_total, s.metadata.name, s.id, s.metadata.message);
  }
  res.json({ ok: 1 });
});
```

Idempotency is the fourth check. Stripe will retry. Your handler will also get run twice if you debug carelessly. The Checkout Session id is a stable unique key. In Postgres the kit inserts with `ON CONFLICT (payment_id) DO NOTHING`. In the local JSON fallback it keeps a `seen` map of payment ids and returns early. Either way, a replay does not double-count.

Store the **amount in cents**, not a precomputed point total. You will thank yourself the first time you change the exchange rate.

## Compute points at read time

A simple, honest formula is enough: one unit of currency becomes a fixed number of points, and a single large payment can earn a bonus tier. The kit keeps both in `config.js` and applies them when it reads donations, not when it writes them:

```js
// $1 = 100,000 points. Highest matching bonus wins.
bonusTiers: [
  [50000, 0.5],  // $500+ → +50%
  [10000, 0.3],  // $100+ → +30%
  [5000,  0.2],
  [2000,  0.1],
  [500,   0.05],
],

const BON = [...CFG.bonusTiers].sort((a, b) => b[0] - a[0]);
const bonusOf = (cents) => (BON.find(([min]) => cents >= min) || [0, 0])[1];
const PTS = (cents) => Math.round((cents / 100) * CFG.pointsPerUnit * (1 + bonusOf(cents)));
```

Because the row in the database is still `amount_cents`, you can retune `pointsPerUnit` or the bonus table later and the board recalculates. If you had written `points` at payment time, a rate change would fork history into two incompatible systems.

The same idea shows up in the [waitlist landing page](/guides/how-to-create-a-waitlist-landing-page/): referral rank is computed at read time from a `spotsPerReferral` constant, so you can change how much a referral is worth without rewriting old rows.

## Reset the week in a real time zone

"Reset every Monday" is vague once you leave UTC. Mondays begin at different instants in Tokyo and Los Angeles, and Pacific Time also jumps an hour for daylight saving. The robust approach is:

- Pick an IANA time zone (`America/Los_Angeles`) and a label for the UI ("Pacific Time").
- Format "now" in that zone, find the Monday of that week, and convert that Monday 00:00 back to a UTC instant, adjusting for the zone offset (including DST).
- Store a `week_key` such as `2026-11-16` (the Monday date).
- The public board filters donations whose timestamp falls in `[start, end)`. An all-time tab skips the filter.
- When a week ends, finalize the winner **once** (a unique `week_key` in a `weekly_champions` table) so a delayed webhook or a double cron cannot crown two champions.

Ties should be explicit. A fair default is: more points win, and if points are equal, the entry that reached that total first stays ahead.

## Keep branding in one file

If you want other people — or your future self — to launch a new board without hunting through templates, put the marketing knobs in one module and keep secrets out of it. The kit's `config.js` is the whole rebrand surface:

```js
module.exports = {
  siteName: 'The Richest Country in the World',
  shortName: 'Richest Country',
  tagline: 'Push your country to #1!',
  currency: 'usd',
  minAmount: 2,              // smallest single payment
  pointsPerUnit: 100000,     // points per 1.00 of currency
  timeZone: 'America/Los_Angeles',
  timeZoneLabel: 'Pacific Time',
  theme: {
    accent: '#ffd700',
    accent2: '#ff9a00',
    bg: '#1a0b2e',
    bg2: '#3b1d60',
  },
};
```

Stripe keys and `DATABASE_URL` stay in environment variables. Most of the fields above can also be overridden with env vars, so you can retune a live deploy without a code edit.

A few product rules belong next to the branding, not in a blog post you will forget:

- Profile links and vanity cosmetics should unlock at a payment threshold, and the server should validate the URL (https only, no credentials, length cap).
- Names and messages need stripping of control characters and a hard length limit. They are displayed to everyone.
- Points, titles, and cosmetics should have **no cash value**. Do not add cash-outs, prize draws, or anything that reads as a lottery. Say so in your terms.

## If you also ship a minigame, still do not trust the client

A free game gives people a reason to come back on days they do not pay. It is also the first thing a bored visitor will try to break from the browser console.

The pattern used by the kit's Flag Rush mode is:

- `POST /api/game/start` issues an HMAC-signed run token that already contains the start time, the chosen country, and a random nonce.
- `POST /api/game/finish` verifies the token with `timingSafeEqual`, then checks that the run did not finish impossibly fast or after the token expired (a 29–40 second window around a 30 second game).
- Tap counts are capped, and an optional per-second array is rejected if any bucket exceeds a taps-per-second ceiling.
- Each visitor has a daily run limit and a per-country point cap, reset on a published schedule.

The client can still lie about how many times it was tapped. The server can still refuse impossible timings and unbounded grinding. That is the same idea as the payment webhook: the browser proposes, the server decides.

## Run it locally, then put a real database behind it

You should be able to demo the whole site with no accounts. Leave `STRIPE_SECRET_KEY` empty and the pay button simulates a payment, with a visible demo banner. Leave `DATABASE_URL` empty and rows go to a local JSON file. That is fine on a laptop. It is not fine in production: a host that wipes the filesystem on every deploy will erase the board.

A practical production path looks like this:

1. Create a Postgres database (Neon’s free tier is enough to start). Use the **pooled** connection string.
2. Let the app create its tables on boot, or apply a `schema.sql` yourself.
3. Use Stripe **test mode** first. Forward webhooks with the Stripe CLI: `stripe listen --forward-to localhost:3000/webhook`. Put the printed `whsec_...` in `STRIPE_WEBHOOK_SECRET`.
4. Pay with the test card `4242 4242 4242 4242`. Confirm the board updates only after the webhook returns 200, not merely after the redirect.
5. Deploy a Node host (Render’s Blueprint is one option). Set `BASE_URL` to the public HTTPS URL, add a Stripe webhook endpoint at `/webhook` for `checkout.session.completed`, and copy the endpoint’s signing secret into the host.
6. Switch to live keys only after a test payment works end to end, and update the webhook URL to match.

Free web hosts often sleep after a short idle period. The first visitor then waits half a minute. That is acceptable for a personal experiment. It is a poor fit for a board you are asking people to pay into. A small always-on plan, plus a [public status page](/guides/how-to-make-a-status-page/) on a *different* host, is the grown-up version of the same launch.

## A short checklist before you take real money

- The success URL never writes to the database.
- `/webhook` rejects bad signatures, stale timestamps, and unsigned events when a Stripe key is present.
- `payment_id` is unique, so retries do not double-count.
- Amounts are stored in cents; points are computed on read.
- The weekly window uses a named time zone and an idempotent champion row.
- Demo mode cannot be reached with live keys accidentally, and legal pages are edited, not shipped as "Your Company."
- You have a refund path and a contact address that actually works.

Once those are true, the leaderboard is a product, not a demo: a public ranking that moves when the money does, and stays still when the webhook comes in twice.
