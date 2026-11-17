---
title: How to Create a Waitlist Landing Page
description: Build a pre-launch waitlist that collects emails, issues a unique referral link, ranks people fairly, and survives bots, repeat signups, and a host that wipes its disk.
date: 2026-11-16
slug: how-to-create-a-waitlist-landing-page
product: waitlist
query: how to create a waitlist landing page
queries:
  - how to create a waitlist page
  - how to build a waitlist
  - how to make a waitlist landing page
related:
  - how-to-make-a-donation-leaderboard-with-stripe
  - how-to-make-a-status-page
---

A waitlist landing page has one job: get the right visitor to leave an email, then show them what happens next. If you are launching a product, that page is also your first growth loop — each person should leave with a unique link, and friends who join through that link should move the referrer up the queue.

You can collect addresses with a Google Form in an afternoon. You cannot run a fair referral queue, a position page, or a private admin export that way. This guide covers the page itself, the signup API, the ranking math, and the boring production details that decide whether the list is still there after a deploy. The code examples are taken from a working Waitlist Launch Kit; the same design works if you build it yourself.

## What the page needs (and what to leave out)

The first screen should answer three questions without scrolling: what is this, who is it for, and what do I get if I join. A useful default structure is:

1. A short eyebrow or date ("Early access is limited", or a real month if you have one).
2. A headline and one supporting sentence.
3. A form with an email field, an optional name, and a button that says "Get early access" — not "Submit."
4. One line on what you will email them about. If you will only write at launch, say so.
5. A short "how it works" section under the fold: join, share your link, move up.

That is enough. Cut pricing tables you have not finalized, testimonials you cannot stand behind, and countdown timers that are not tied to a real date. A single screenshot of the actual product helps more than a stock illustration. If you only have a mockup, say it is a mockup.

Navigation is optional and usually harmful. Every extra link is a way to leave without joining. A privacy policy in the footer is the exception — you are collecting emails, so say how you will use them, and edit the template before you go live.

On a phone, the email field and the button should be reachable without sideways scrolling. Most waitlist traffic arrives from a shared link on a small screen.

## The signup request should be boring and strict

The browser submits JSON to `POST /api/signup`. The body is small on purpose: `{ "email", "name?", "ref?", "website?" }`. `ref` is the referral code from the URL (`?ref=ab3kxm2q`). `website` is not a real field. It is a hidden honeypot.

A few rules keep the list clean:

- Normalize the email (trim, lowercase) and reject anything that fails a basic pattern or is longer than 254 characters.
- Cap the name at a short length. You may show first name plus last initial on a public queue (`Maya C.`); you should never show the email on the public page.
- If the same email signs up again, do not insert a second row. Return the existing position page. People refresh, hit back, and double-tap the button.
- If two requests race, the unique constraint on email should win, and the second request should be treated as "already joined."
- You cannot refer yourself. An invalid referral code is ignored, and the visitor still joins at the back of the line.
- Rate-limit by IP. The kit allows eight attempts per 15 minutes and returns `429` with a clear error.

The honeypot deserves a special mention. Bots fill every field they see, including a hidden `website` or `company` input. The correct response is not an error. It is a *fake success* that does not store anything:

```js
app.post('/api/signup', async (req, res) => {
  const ip = clientIp(req);
  if (!rateLimit(`signup:${ip}`, 8, 15 * 60 * 1000)) {
    return res.status(429).json({
      error: 'Too many attempts. Please try again in a few minutes.',
    });
  }

  const body = req.body || {};
  // Honeypot: bots fill hidden fields. Pretend success, do not store.
  if (String(body.website || body.company || '').trim()) {
    return res.json({
      ok: true,
      already: false,
      position: 1,
      referralLink: BASE_URL + '/',
      referral_code: 'ok',
    });
  }

  const email = String(body.email || '').trim().toLowerCase();
  const name = String(body.name || '').trim().slice(0, 80);
  const ref = String(body.ref || '').trim().toLowerCase();
  // validate email, reuse an existing row, or create a new one
});
```

Returning a realistic-looking payload stops the bot from retrying with different garbage. It also avoids teaching scrapers which field was the trap.

Assign every real signup an 8-character referral code and make sure it is unique. Build the public link from `BASE_URL`, not from the request host header, so a misconfigured proxy cannot mint links on the wrong domain.

## Rank the queue at read time

A fair referral queue can be a single SQL expression. Each person starts with a position equal to the order they joined (their row id, if ids are monotonic). Each confirmed friend subtracts a configurable number of spots. Ties go to whoever joined first.

The kit computes that in a CTE and never writes a stored rank:

```sql
WITH counts AS (
  SELECT s.id, s.email, s.name, s.referral_code, s.created_at,
         COALESCE(c.n, 0) AS referral_count
  FROM signups s
  LEFT JOIN (
    SELECT referred_by AS id, COUNT(*) AS n
    FROM signups
    WHERE referred_by IS NOT NULL
    GROUP BY referred_by
  ) c ON c.id = s.id
),
ranked AS (
  SELECT counts.*,
         ROW_NUMBER() OVER (
           ORDER BY (counts.id - counts.referral_count * $1) ASC,
                    counts.id ASC
         ) AS position
  FROM counts
)
SELECT * FROM ranked
ORDER BY position ASC;
```

`$1` is `spotsPerReferral` (default 5). Because the math happens at read time, you can change that constant later without rewriting history. The same "store facts, compute scores on the way out" idea is how a [donation leaderboard](/guides/how-to-make-a-donation-leaderboard-with-stripe/) should treat payment amounts and point rates.

After signup, send the visitor to a position page, not back to the form. That page should show a large position number, how many spots they have moved, their referral link, and share buttons (a copy-link control, WhatsApp, X, and the Web Share API on phones). The share text can be a template with `{siteName}`, `{position}`, and `{url}` filled in.

The public landing page can show a live queue of first names. Keep it short, and keep emails out of it. If you would rather show no names at all, turn off `collectName` or stop returning names from `/api/queue`.

## Give yourself an admin page and a CSV

You will need to see who joined, who is referring, and you will need a copy of the list that is not trapped in a dashboard. A password-protected `/admin` with a searchable table, referral counts, totals, and `GET /api/admin/export.csv` is enough for a launch.

A few production notes that are easy to skip:

- Change `ADMIN_PASSWORD` from any example value before the site is public.
- Hashed IP addresses can help you debug rate-limit issues. They should not appear in the admin UI or the CSV.
- The in-memory rate limiter is per process. That is fine on a single instance. If you scale to more than one, put a shared limiter in front or stay on one process.
- You are responsible for consent and anti-spam rules where you operate. The privacy page in a kit is a template, not legal advice.

Optional hooks make the list useful on day one. A `SIGNUP_WEBHOOK_URL` can POST a small JSON payload after every new signup (`event`, `email`, `position`, `referralLink`, `already`). Welcome email through Resend or Mailgun can include the same position and link. The signup itself should succeed even if the hook or the email provider fails — log the error, do not roll back the join.

## Brand it from one file, then deploy it like it matters

All of the copy and color should live in one config module so a rebrand is not a scavenger hunt:

```js
module.exports = {
  siteName: 'Northstar',
  headline: 'Be first in line.',
  subheadline:
    'Northstar is coming soon. Join the waitlist — invite friends and move up the queue.',
  cta: 'Get early access',
  collectName: true,
  spotsPerReferral: 5,
  eyebrow: 'Early access is limited',
  footerNote: "No spam. We'll only email you about the launch.",
  theme: {
    bg: '#0B0D12',
    accent: '#7CFFB2',
    accentText: '#062016',
    text: '#F4F1EA',
  },
};
```

Locally, you should be able to start with no cloud accounts. Empty `DATABASE_URL` can fall back to SQLite. That is a development convenience. **Do not use SQLite on a host with an ephemeral disk.** Render, Railway, and similar platforms will wipe the filesystem on a deploy or a restart, and your waitlist will disappear. In production, set `DATABASE_URL` to a pooled Postgres string (Neon works), set `BASE_URL` to the public HTTPS origin so referral links are correct, and put a strong admin password in the environment.

A typical path is: create the database, push a *private* repo (if you started from a commercial kit, the license usually forbids publishing the source), deploy with the included Blueprint or a start command of `npm start`, then join with a real address you control and sign in at `/admin`. Confirm the row is there, the referral link uses your public host, and a second signup with the same email returns the same position.

Free web hosts often sleep after about 15 minutes idle. The next visitor waits 30–60 seconds. If you are actively promoting the launch, use a plan that stays awake. And host a [status page](/guides/how-to-make-a-status-page/) somewhere else — if the waitlist and its status page share a box, an outage hides both.

## Test the live page before you share the link

Walk through the flow as a subscriber, not as the person who built it:

- Empty email and a malformed address both show a clear error.
- A good signup lands on the position page, and the welcome email (if you enabled it) actually arrives — check spam and promotions too.
- The same email again does not create a second row or send a second "welcome, you are new" message.
- A referral link increments the referrer’s count and moves their position by `spotsPerReferral`.
- A self-referral or a garbage `ref` still creates a valid signup at the back.
- The hidden honeypot field, if filled, does not appear in admin or the CSV.
- `/admin` rejects a wrong password and exports a CSV that opens in a spreadsheet.
- The form is usable on a phone.

Once that list is green, the page is doing its job: one honest offer, one form, a queue people can climb, and a list you can still export after the host restarts.
