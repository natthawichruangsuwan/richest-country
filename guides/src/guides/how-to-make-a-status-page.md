---
title: How to Make a Status Page
description: Set up a free, self-hosted status page that checks your own URLs, shows 90-day uptime and incidents, and stays up when the product it monitors does not.
date: 2026-11-16
slug: how-to-make-a-status-page
product: status
query: how to make a status page
queries:
  - how to create a service status page
  - how to make a server status page
  - how to make a status website
related:
  - how-to-create-a-waitlist-landing-page
  - how-to-make-a-donation-leaderboard-with-stripe
---

A status page is a public, boring, always-on site that answers one question: is the product working right now, and what happened when it was not? Users look for it when something already feels wrong. Support looks at it before writing the tenth identical reply. You look at it to be honest in public instead of silent.

You can buy this as a hosted SaaS, or you can run a small app that checks your own URLs, stores the history in your own database, and costs only whatever you already pay for a tiny always-on host. This guide is the second path: a self-hosted page you can put on `status.yourdomain.com` for free at the software layer, with working monitoring, incidents, and badges. The examples come from a Status Page Kit; the design applies if you build the same pieces yourself.

## What a useful page actually shows

Visitors should understand the page in a few seconds, on a phone, without an account.

- An overall banner: "All systems operational," "Degraded performance," or "Major outage." This is a summary, not a vibe. It has to be derived from the components below it.
- A list of **components people recognize**: Website, API, Checkout, Email — not the names of your internal microservices.
- A 90-day uptime bar per component, with a way to see a single day.
- A response-time sparkline if you collect timings, so a slow-but-up API is visible.
- Recent incidents with a timeline of updates, plus scheduled maintenance.
- A way to subscribe without creating an account: RSS or Atom is the honest minimum. Email or Slack can come later.
- A link back to your product and a way to contact support. On a static marketing site, make that a [contact form posting to its own endpoint](/guides/how-to-add-a-contact-form-to-a-static-website/) so the status host only has to stay up.

That is the whole product. A status page that only says "we're down" in a tweet, or that you update by editing a static HTML file during an outage, will go stale the first night you are busy.

Two placement rules matter more than typography. Put the page on a **different host** from the app it monitors. If they share a server, the status page disappears in the same incident it is supposed to explain. And give it a URL people can guess or find: `status.yourdomain.com`, plus a footer link on the main site and in your help docs. When the main site is down, the footer link is useless, which is another reason the status host should be separate.

The same rule applies if you are about to launch a [waitlist](/guides/how-to-create-a-waitlist-landing-page/) or a [donation leaderboard](/guides/how-to-make-a-donation-leaderboard-with-stripe/): monitor them from somewhere that does not sleep and die with the app.

## Model statuses so a single blip is not a "major outage"

If every failed check paints the banner red, you will train users to ignore you. A small, explicit state machine is enough:

| Status | When it appears |
|---|---|
| Operational | The last check succeeded and was fast enough. |
| Degraded performance | The last check succeeded but was slower than a "slow above" threshold, **or** it is the first failed check in a streak. |
| Partial outage | Never from a check alone. You set this with a manual override or an incident. |
| Major outage | A configurable number of failed checks in a row (default two). |
| Under maintenance | The component is in a maintenance window that is in progress. |
| No data yet | Not checked yet. It should not drag the banner down. |

The kit's checker applies that in a few lines after each HTTP result:

```js
if (result.ok) {
  status = result.ms > fresh.degraded_ms ? 'degraded' : 'operational';
} else {
  status = streak >= m.failuresBeforeDown ? 'major_outage' : 'degraded';
}
```

The overall banner should also be conservative. A reasonable rule: if at least half of the visible components are in major outage, the banner is a major outage; if any component is in partial outage, say so; if any is degraded, say degraded; otherwise "All systems operational." Manual overrides always win over the checker, which is how you tell the truth when the health endpoint is up and the product is still broken.

Uptime math should be public and slightly generous in a way you can defend. Counting a "degraded" day as available (slow, but serving) is common. A 90-day bar that treats a one-minute blip as a fully down day is not. Store per-day tallies in UTC, and keep a short sparkline of recent results (a few hundred points is plenty).

## Check the URLs your users actually feel

A component needs a URL, not a novel. Prefer a dedicated health endpoint (`/health` or `/healthz`) that does not run a heavy query. Follow redirects. Fail on timeout. Optionally require a keyword in the body so an nginx default page does not count as "the API is fine."

You can describe the same list as code and load it on boot, then keep the dashboard as the source of truth afterwards (editing a service in the UI should not be overwritten by the file):

```json
[
  {
    "name": "Website",
    "group": "Public",
    "description": "Marketing site",
    "url": "https://www.example.com/",
    "expectedStatus": "200-399",
    "intervalSeconds": 60
  },
  {
    "name": "API",
    "group": "Public",
    "description": "REST API health endpoint",
    "url": "https://api.example.com/health",
    "method": "GET",
    "expectedStatus": "200",
    "keyword": "\"ok\"",
    "timeoutMs": 5000,
    "degradedMs": 800,
    "intervalSeconds": 30
  },
  {
    "name": "Checkout",
    "group": "Billing",
    "url": "https://shop.example.com/health",
    "expectedStatus": "200,204"
  }
]
```

Useful per-component knobs:

- **Expected status:** `200`, `200-299`, or a list such as `200,204,301-308`.
- **Interval:** 60 seconds is fine for a marketing site; 30 seconds is reasonable for a checkout health check. A floor (for example 10 seconds) stops someone from checking every second and becoming the outage.
- **Timeout:** an 8 second default is plenty. A check that hangs is a failure.
- **Slow above:** a healthy response slower than this is "Degraded performance." Set it from real timings, not from hope.
- **Enabled:** paused components should not be checked and should not appear on the public page.

Only publish what a customer would recognize. Internal workers, staging, and the admin panel can still be monitored privately. They do not belong on the public list.

The User-Agent you send should identify the checker, and you should rate-limit the public API, badge, and feed endpoints so a scrape cannot become an incident of its own.

## Incidents are a timeline, not a title

When something is wrong, post an incident from a password-protected admin page. Pick the affected components and a severity (`degraded`, `partial_outage`, or `major_outage`). Then write updates the way you would want to read them at 1 a.m.:

- **Investigating.** What users see, and that you are looking. "Some users cannot log in. We are investigating."
- **Identified.** What you know. "A database migration is causing the errors. We are rolling it back."
- **Monitoring.** The fix is live, and you are watching.
- **Resolved.** What happened, and that it is over.

During a long incident, post every 30 to 60 minutes even if the news is "no change." Silence is how people decide you are hiding. Scheduled maintenance should be a first-class window with a start and end, not an incident you pretend is a surprise.

After it is over, leave the incident on a history page with the full timeline. That history is how a status page earns trust on the quiet days.

An optional webhook (Slack and Discord incoming webhooks accept a `text` or `content` field) should fire when a visible component status changes, when an incident is posted or updated, and when maintenance is scheduled. Delivery can be best-effort. The status page itself is the record; chat is a courtesy.

## Badges, widgets, and feeds

Once the page is public, let other surfaces point at it:

- An SVG badge (`/badge.svg`) for a README or a docs header.
- A one-line JavaScript widget you can drop on your marketing site.
- A public JSON API for your own tooling.
- RSS and Atom for people who do not want another email list.

Set `PUBLIC_URL` to the real origin so those snippets and feeds do not advertise `localhost`. Allow CORS on the JSON API if you want other sites to read it, and keep a tight rate limit.

## Deploy it so the checker actually runs

This is the part most "free status page" tutorials skip, and it is the part that fails first.

The app is a single process that **serves the page and runs the checker**. If the host sleeps after 15 minutes idle, checks pause and your uptime graph becomes a fiction. If the filesystem is wiped on every deploy, you lose 90 days of history. So:

- Use a host that stays running (a small always-on VM, Fly with a volume, Railway with a volume, or a Render Blueprint on a plan with a persistent disk). The included Docker image is enough for any VPS: build, run, mount a volume at the data directory, set `ADMIN_PASSWORD`, `SESSION_SECRET`, `PUBLIC_URL`, and `TRUST_PROXY=true` behind HTTPS.
- Put the database on **persistent storage**. SQLite in a mounted volume is simple and honest. A JSON file works for a demo. An in-memory store is for tests.
- Back up the data directory.
- Set a long, random admin password and a stable `SESSION_SECRET` so a restart does not log everyone out.
- Point a custom domain at it (`status.yourdomain.com`) and serve HTTPS. Render, Fly, and Railway will terminate TLS for you.

A two-minute local demo should exist and require no accounts. Seeded sample components, a "Demo mode" banner, and simulated checks are the right way to learn the UI. Production is the opposite: real URLs, a real password, a real public URL, and no demo banner.

Before you share the link, do a short drill. Force a component into a manual outage, confirm the banner and the badge change, post an incident, resolve it, and confirm the history page keeps the timeline. Then put the component back on automatic checks. If you cannot complete that drill, users will not get a usable update during a real outage either.

A status page is not a marketing site. It is a promise that when something breaks, there is a place that stays up, tells the truth, and still has yesterday's history. Host it like you mean that.
