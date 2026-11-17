# Daily guide playbook

Add **one** new English how-to guide at a time. Each piece should answer a real Google query, stay accurate to a kit we actually sell, link to older guides, and end on a clear buy path.

The generator is `guides/` inside the game repo. It writes into `public/guides/` and rewrites `public/sitemap.xml` and `public/robots.txt`. The existing Render web service (`render.yaml`, `npm install`, `npm start`) serves those files. Do not add a Python build step, and do not create a second Render site.

All commands below are run from the repository root.

## Add a new guide

1. Create `guides/src/guides/<slug>.md`.
2. If the guide needs a product that is not already in `guides/site.json`, add a `products` entry (`name`, `price`, `url`, `blurb`) and set the guide's `product:` key to it.
3. From the repo root, run:

   ```bash
   python3 guides/build.py
   ```

4. Commit the Markdown (and `site.json`, if it changed) plus the built output: `public/guides/`, `public/sitemap.xml`, and `public/robots.txt`.
5. Push to `main`. Render autodeploys the existing web service. No `render.yaml` change.

`guides/deploy.sh` does steps 3–5 when you are already on `main`. It only stages `guides/`, `public/guides/`, `public/sitemap.xml`, and `public/robots.txt`.

The game homepage footer already links to `/guides/`. Leave that link in place. The builder refuses to modify `public/index.html`, the privacy, terms, and refund pages, or the game scripts.

## 0. Build and preview

Pillow is required for the Open Graph images:

```bash
python3 -m pip install -r guides/requirements.txt
python3 guides/build.py
npm start
```

Open http://127.0.0.1:3000/guides/. The build fails if a guide is outside 1,200–2,000 words (code fences are excluded from the count) or if a `related:` slug does not exist.

`guides/site.json` holds the public site URL (`https://richest-country.onrender.com`), product links, and discount codes. Codes are included in every CTA only while their `expires` timestamp is still in the future (America/Los_Angeles). When a code ends, leave it in `site.json` — the builder will stop showing it automatically. Rebuild after any change to `site.json`.

Built URLs:

| Page | Path |
|---|---|
| Guides index | `/guides/` |
| A guide | `/guides/<slug>/` |
| CSS, favicon, OG images | `/guides/assets/` |
| Sitemap | `/sitemap.xml` (home, `/guides/`, and each guide) |
| Robots | `/robots.txt` |

`/guides` without a slash redirects to `/guides/`. The same is true for each guide directory. Do not write a second homepage over `public/index.html`.

## 1. Pick the next query

Work through this list in order. Stop at the first query that is a genuine how-to a kit can answer honestly.

1. **Search Console (preferred, once connected).** In Performance, look at queries from the last 28 days that already show impressions but a weak CTR, or that sit on page two. Write the guide that query is asking for.
2. **Google Autocomplete.** Fetch suggestions (no API key):

   ```bash
   curl -s "https://suggestqueries.google.com/complete/search?client=firefox&q=how+to+create+a+waitlist+landing"
   ```

   Prefer a suggestion that is already a full how-to, not a truncated prefix. Try a few phrasings (`how to make…`, `how to create…`, `how to build…`).
3. **People Also Ask / related searches.** Web-search the candidate query and read the PAA questions and similar guides. Steal the question, not the wording of someone else's article.
4. **Kit coverage map.** Each guide should map to one product in `site.json`. Do not write a second guide for a kit that already has one until every current product has at least one guide, unless Search Console clearly says a new angle is already getting impressions.

Good queries are long-tail and specific (`how to create a waitlist landing page`, `how to make a donation leaderboard`, `how to create a service status page`). Bad queries are brand-empty head terms (`waitlist`, `status page`) or questions the kit cannot actually fulfill.

Suggested backlog (only if Search Console and autocomplete do not give you something better):

| Query | Product key | Notes |
|---|---|---|
| how to add a feature voting board | feature-voting (add to `site.json` first) | Feature Voting Board Kit |
| how to make a testimonial wall | testimonials | Testimonial Wall Kit |
| how to build a link in bio page | link-in-bio | Link-in-Bio Pro Kit |
| how to make a tip jar for a website | tip-jar | Tip Jar & Supporter Wall Kit |
| how to create a countdown giveaway page | countdown | Countdown Giveaway Kit |
| how to make a form backend | formbox | Formbox Kit |
| how to build a booking page | booking | Booking Page Kit |
| how to make a URL shortener | short-link | Short Link Kit |
| how to add simple analytics to a site | analytics | Pulse Analytics Kit |

When you add a product, put it in `guides/site.json` under `products` with `name`, `price`, `url`, and `blurb`.

## 2. Open the kit and take real notes

Read the kit before writing. Copy only short, accurate excerpts (a function, a config block, a SQL CTE). Clean up minified lines for readability if needed, but do not change the behavior. Do not paste entire files, and do not invent APIs that are not in the kit.

## 3. Write the Markdown file

Create `guides/src/guides/<slug>.md`. The public URL is `/guides/<slug>/`.

```markdown
---
title: How to Create a Waitlist Landing Page
description: One or two sentences, under 160 characters, that match the query.
date: 2026-11-17
slug: how-to-create-a-waitlist-landing-page
product: waitlist
query: how to create a waitlist landing page
queries:
  - how to create a waitlist page
  - how to build a waitlist
related:
  - how-to-make-a-status-page
  - how-to-make-a-donation-leaderboard-with-stripe
---

Opening paragraph that answers the query in plain English…

## First H2
```

Rules:

- English only. Brand voice is **Richest Country**. Never use a personal name or any other personal handle anywhere in site content.
- 1,200–2,000 words of prose (fences excluded). Practical, specific, no filler.
- Target one primary `query`. Put close variants in `queries` (they become schema keywords).
- Use `##` headings that a skimmer can follow. The builder turns H2s into the on-page table of contents.
- Link to at least two older guides in the body, not only in `related:`. Use root-relative paths with trailing slashes: `/guides/how-to-make-a-status-page/`.
- Do not add a CTA heading at the bottom. The builder appends a buy box for `product`, including any still-valid discount codes and the discounted price.
- Do not mention GitHub usernames, payout settings, or unpublished products.

Title formula that works: start with the query, in title case (`How to Make a Status Page`). The `<title>` tag becomes `Title — Richest Country Guides`. The meta description is the `description:` field.

## 4. Rebuild, then check the page

```bash
python3 guides/build.py
npm start
```

Confirm, at a minimum:

- Word count printed by the builder is in range.
- `http://127.0.0.1:3000/guides/<slug>/` opens, with the intended `<title>`, meta description, canonical, Open Graph image, and Article JSON-LD.
- `/guides/<slug>` (no slash) redirects to the trailing-slash URL.
- Internal links and `/guides/assets/` files resolve.
- The CTA points at the right Gumroad URL and hides expired codes.
- `public/sitemap.xml` lists `https://richest-country.onrender.com/`, `/guides/`, and the new guide. The builder rewrites the sitemap and `robots.txt` every run — you do not edit them by hand.
- `public/index.html` is unchanged except for the existing Guides footer link.

## 5. Deploy

```bash
git add guides public/guides public/sitemap.xml public/robots.txt
git commit -m "Add guide: <slug>"
git push origin main
```

Or, on `main`, `./guides/deploy.sh "Add guide: <slug>"`.

Render autodeploys on push to `main`. After the deploy finishes (a free instance may cold-start), check that these return HTTP 200:

- `https://richest-country.onrender.com/`
- `https://richest-country.onrender.com/guides/`
- `https://richest-country.onrender.com/guides/<slug>/`
- `https://richest-country.onrender.com/sitemap.xml`
- `https://richest-country.onrender.com/robots.txt`

`site_url` in `guides/site.json` is `https://richest-country.onrender.com`. If that public URL ever changes, update it, rebuild, and push again so canonical tags and the sitemap stay correct.

## Hosting

Guides are static files under `public/guides/`. Express `express.static` serves `public/guides/index.html` at `/guides/` and each `public/guides/<slug>/index.html` at `/guides/<slug>/`. Assets are at `/guides/assets/`.

Do not point a second Render static site at this folder. Do not change the `render.yaml` build command for a guide publish. Do not publish this repo if that would put a personal name in a public URL.

## Google Search Console

1. Use the URL prefix property `https://richest-country.onrender.com/`.
2. Verify with an HTML file or a meta tag. If Search Console gives a file that must sit at the site root (for example `googleXXXX.html`), put it in `guides/src/static/`. The builder copies new files from that folder into `public/`, and skips anything that would overwrite `index.html`, `privacy.html`, `terms.html`, `refund.html`, `game.js`, `gacha.js`, `gacha.css`, or a file that is already there. Then commit and push.
3. Submit `https://richest-country.onrender.com/sitemap.xml`.
4. From then on, pick the next guide from Performance → Queries.

## What not to do

- Do not publish more than one guide a day just to fill a quota. If the day's piece is thin, improve an existing guide instead (update `date` only if the article meaningfully changed, then rebuild and deploy).
- Do not stuff keywords, add fake testimonials, or invent traffic or revenue numbers.
- Do not like, follow, or comment on social posts, and do not post the guide to social from this playbook.
- Do not touch payout, bank, tax, payments, secrets, or Render environment variables.
- Do not let the builder overwrite the game. `guides/build.py` deletes and rewrites only `public/guides/`, then replaces `public/sitemap.xml` and `public/robots.txt`.
