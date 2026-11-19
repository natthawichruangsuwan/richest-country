#!/usr/bin/env python3
"""Build Richest Country Guides into the game site's public/guides/.

Output (never the game homepage or other game files):
  public/guides/index.html
  public/guides/<slug>/index.html
  public/guides/assets/*
  public/sitemap.xml
  public/robots.txt
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import sys
from datetime import datetime, timezone
from html import escape
from pathlib import Path
from zoneinfo import ZoneInfo

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
GUIDES_DIR = SRC / "guides"
# Game site static root. The builder only writes public/guides/ plus sitemap and robots.
SITE_PUBLIC = ROOT.parent / "public"
OUT = SITE_PUBLIC / "guides"
PREFIX = "/guides"
# Existing game files this builder must never create, replace, or delete.
PROTECTED_NAMES = {
    "index.html",
    "privacy.html",
    "terms.html",
    "refund.html",
    "game.js",
    "gacha.js",
    "gacha.css",
}
PT = ZoneInfo("America/Los_Angeles")
TODAY = datetime.now(PT)

SITE = json.loads((ROOT / "site.json").read_text())


def site_url() -> str:
    return SITE["site_url"].rstrip("/")


def abs_url(path: str) -> str:
    if path.startswith("http"):
        return path
    return site_url() + (path if path.startswith("/") else "/" + path)


def prefixed(path: str) -> str:
    """Site path under /guides/. Idempotent for paths that already have the prefix."""
    if path.startswith(("http://", "https://", "mailto:")):
        return path
    if not path.startswith("/"):
        path = "/" + path
    if path == PREFIX or path.startswith(PREFIX + "/"):
        return path
    return PREFIX + path


def fmt_money(amount: float) -> str:
    if abs(amount - round(amount)) < 1e-9:
        return f"${amount:.0f}"
    return f"${amount:.2f}"


def active_discounts(now: datetime | None = None):
    now = now or TODAY
    out = []
    for d in SITE.get("discounts", []):
        exp = datetime.fromisoformat(d["expires"])
        if exp >= now:
            out.append(d)
    return out


# ── tiny Markdown subset ────────────────────────────────────────────────────

HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
FENCE_RE = re.compile(r"^```([\w+-]*)\s*$")
LI_RE = re.compile(r"^(\s*)([-*]|\d+\.)\s+(.*)$")


def inline(text: str) -> str:
    parts: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        if text.startswith("`", i):
            j = text.find("`", i + 1)
            if j != -1:
                parts.append("<code>" + escape(text[i + 1 : j]) + "</code>")
                i = j + 1
                continue
        if text.startswith("**", i):
            j = text.find("**", i + 2)
            if j != -1:
                parts.append("<strong>" + inline(text[i + 2 : j]) + "</strong>")
                i = j + 2
                continue
        if text.startswith("[", i):
            m = re.match(r"\[([^\]]+)\]\(([^)]+)\)", text[i:])
            if m:
                label, href = m.group(1), m.group(2)
                rel = ' rel="noopener"' if href.startswith("http") else ""
                parts.append(f'<a href="{escape(href, quote=True)}"{rel}>{inline(label)}</a>')
                i += m.end()
                continue
        if text.startswith("*", i) and not text.startswith("**", i):
            j = text.find("*", i + 1)
            if j != -1:
                parts.append("<em>" + inline(text[i + 1 : j]) + "</em>")
                i = j + 1
                continue
        parts.append(escape(text[i]))
        i += 1
    return "".join(parts)


def is_table_sep(line: str) -> bool:
    s = line.strip()
    return bool(s) and set(s) <= set("|:- ") and "-" in s and "|" in s


def parse_row(line: str) -> list[str]:
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    return [c.strip() for c in s.split("|")]


def render_table(rows: list[str]) -> str:
    header = parse_row(rows[0])
    body = [parse_row(r) for r in rows[2:]]
    th = "".join(f"<th>{inline(c)}</th>" for c in header)
    trs = []
    for row in body:
        tds = "".join(f"<td>{inline(c)}</td>" for c in row)
        trs.append(f"<tr>{tds}</tr>")
    return f"<table><thead><tr>{th}</tr></thead><tbody>{''.join(trs)}</tbody></table>"


def slugify_heading(text: str) -> str:
    s = re.sub(r"<[^>]+>", "", text)
    s = re.sub(r"[^a-zA-Z0-9\s-]", "", s).strip().lower()
    s = re.sub(r"[\s]+", "-", s)
    return s or "section"


def markdown_to_html(md: str) -> tuple[str, list[tuple[str, str, int]]]:
    """Return (html, toc as list of (id, text, level))."""
    lines = md.replace("\r\n", "\n").split("\n")
    html: list[str] = []
    toc: list[tuple[str, str, int]] = []
    i = 0
    used_ids: dict[str, int] = {}

    def unique_id(raw: str) -> str:
        base = slugify_heading(raw)
        n = used_ids.get(base, 0) + 1
        used_ids[base] = n
        return base if n == 1 else f"{base}-{n}"

    while i < len(lines):
        line = lines[i]
        if FENCE_RE.match(line):
            lang = FENCE_RE.match(line).group(1)
            i += 1
            buf = []
            while i < len(lines) and not lines[i].startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1  # closing fence
            cls = f' class="language-{escape(lang)}"' if lang else ""
            html.append(f"<pre><code{cls}>{escape(chr(10).join(buf))}</code></pre>")
            continue
        if line.strip().startswith("|") and i + 1 < len(lines) and is_table_sep(lines[i + 1]):
            rows = [line, lines[i + 1]]
            i += 2
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(lines[i])
                i += 1
            html.append(render_table(rows))
            continue
        m = HEADING_RE.match(line)
        if m:
            level = len(m.group(1))
            raw = m.group(2).strip()
            text = inline(raw)
            hid = unique_id(raw)
            if 2 <= level <= 3:
                plain = re.sub(r"`([^`]*)`", r"\1", raw)
                plain = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", plain)
                plain = plain.replace("**", "").replace("*", "")
                toc.append((hid, plain, level))
            html.append(f'<h{level} id="{hid}">{text}</h{level}>')
            i += 1
            continue
        if line.strip() in ("---", "***"):
            html.append("<hr>")
            i += 1
            continue
        if line.startswith("> "):
            buf = [line[2:]]
            i += 1
            while i < len(lines) and lines[i].startswith("> "):
                buf.append(lines[i][2:])
                i += 1
            html.append("<blockquote><p>" + inline(" ".join(buf)) + "</p></blockquote>")
            continue
        m = LI_RE.match(line)
        if m:
            ordered = m.group(2).endswith(".")
            tag = "ol" if ordered else "ul"
            items = []
            while i < len(lines) and LI_RE.match(lines[i]):
                items.append("<li>" + inline(LI_RE.match(lines[i]).group(3)) + "</li>")
                i += 1
            html.append(f"<{tag}>{''.join(items)}</{tag}>")
            continue
        if not line.strip():
            i += 1
            continue
        buf = [line]
        i += 1
        while i < len(lines) and lines[i].strip() and not HEADING_RE.match(lines[i]) and not FENCE_RE.match(lines[i]) and not LI_RE.match(lines[i]) and not lines[i].startswith("> ") and not (lines[i].strip().startswith("|") and i + 1 < len(lines) and is_table_sep(lines[i + 1])) and lines[i].strip() not in ("---", "***"):
            buf.append(lines[i])
            i += 1
        html.append("<p>" + inline(" ".join(buf)) + "</p>")
    return "\n".join(html), toc


def split_frontmatter(text: str) -> tuple[dict, str]:
    if not text.startswith("---\n"):
        return {}, text
    end = text.find("\n---\n", 4)
    if end == -1:
        return {}, text
    raw = text[4:end]
    body = text[end + 5 :]
    meta: dict = {}
    key = None
    for line in raw.splitlines():
        if key and (line.startswith("  - ") or line.startswith("    - ")):
            meta.setdefault(key, []).append(line.split("- ", 1)[1].strip().strip('"'))
            continue
        if ":" in line and not line.startswith(" "):
            key, val = line.split(":", 1)
            key = key.strip()
            val = val.strip()
            if val == "":
                meta[key] = []
            else:
                meta[key] = val.strip('"')
    return meta, body


def word_count(md: str) -> int:
    # Strip fences, then count words
    text = re.sub(r"```[\s\S]*?```", " ", md)
    text = re.sub(r"`[^`]+`", " ", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"[#*_>-]", " ", text)
    words = re.findall(r"[A-Za-z0-9']+", text)
    return len(words)


# ── layout ──────────────────────────────────────────────────────────────────

def layout(
    *,
    title: str,
    description: str,
    canonical: str,
    body: str,
    og_image: str | None = None,
    json_ld: dict | None = None,
    type_: str = "website",
) -> str:
    og = prefixed(og_image or "/assets/og-home.png")
    json_ld_html = ""
    if json_ld:
        json_ld_html = (
            '<script type="application/ld+json">'
            + json.dumps(json_ld, ensure_ascii=False)
            + "</script>"
        )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{escape(title)}</title>
  <meta name="description" content="{escape(description)}">
  <link rel="canonical" href="{escape(canonical)}">
  <meta property="og:type" content="{escape(type_)}">
  <meta property="og:site_name" content="{escape(SITE['name'])}">
  <meta property="og:title" content="{escape(title)}">
  <meta property="og:description" content="{escape(description)}">
  <meta property="og:url" content="{escape(canonical)}">
  <meta property="og:image" content="{escape(abs_url(og))}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{escape(title)}">
  <meta name="twitter:description" content="{escape(description)}">
  <meta name="twitter:image" content="{escape(abs_url(og))}">
  <link rel="icon" href="{escape(prefixed('/assets/favicon.svg'))}" type="image/svg+xml">
  <link rel="stylesheet" href="{escape(prefixed('/assets/styles.css'))}">
  {json_ld_html}
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <header class="topbar">
    <div class="topbar-inner">
      <a class="brand" href="{escape(PREFIX + '/')}">{escape(SITE['short_name'])} <small>Guides</small></a>
      <nav class="nav" aria-label="Primary">
        <a href="{escape(PREFIX + '/')}">Guides</a>
        <a href="/">Leaderboard</a>
        <a href="{escape(SITE['store_url'])}">Store</a>
      </nav>
    </div>
  </header>
  <main id="main">
{body}
  </main>
  <footer class="foot">
    <div class="foot-inner">
      <div>© {TODAY.year} {escape(SITE['author'])}. Practical guides for shipping small web products.</div>
      <div><a href="/">Leaderboard</a> · <a href="{escape(SITE['store_url'])}">Gumroad store</a> · <a href="{escape(PREFIX + '/')}">All guides</a></div>
    </div>
  </footer>
</body>
</html>
"""


def cta_box(product_key: str) -> str:
    product = SITE["products"][product_key]
    codes = active_discounts()
    price = product["price"]
    code_html = ""
    if codes:
        bits = []
        for d in codes:
            exp = datetime.fromisoformat(d["expires"]).astimezone(PT)
            label = exp.strftime("%B %-d, %Y at %-I:%M %p") + " Pacific Time"
            bits.append(
                f'<strong>{escape(d["label"])}</strong> with code <code>{escape(d["code"])}</code> '
                f"(through {escape(label)})"
            )
        sale = []
        # Show the best (highest) current discount against list price.
        best = max(codes, key=lambda d: int("".join(ch for ch in d["label"] if ch.isdigit()) or "0"))
        pct = int("".join(ch for ch in best["label"] if ch.isdigit()) or "0")
        if pct:
            sale_price = price * (100 - pct) / 100
            sale.append(
                f'List price <span class="price">{fmt_money(price)}</span>. '
                f'With <code>{escape(best["code"])}</code> it is '
                f'<span class="price">{fmt_money(sale_price)}</span>.'
            )
        code_html = "<p class=\"codes\">" + " · ".join(bits) + ("<br>" + " ".join(sale) if sale else "") + "</p>"
    else:
        code_html = f'<p class="codes">The kit is <span class="price">{fmt_money(price)}</span>.</p>'
    lite_url = str(product.get("lite_url") or "").strip()
    lite_line = ""
    if lite_url:
        lite_line = (
            f'\n  <p class="lite"><a href="{escape(lite_url)}">Try the free Lite first</a></p>'
        )
    return f"""
<aside class="cta" id="get-the-kit">
  <h2>Get this running without starting from a blank repo</h2>
  <p>{escape(product["blurb"])} The <strong>{escape(product["name"])}</strong> is the production code this guide is based on — config, anti-abuse rules, and a deploy blueprint included.</p>
  {code_html}{lite_line}
  <a class="btn" href="{escape(product["url"])}">Get the {escape(product["name"])} →</a>
</aside>
"""


# ── OG images ───────────────────────────────────────────────────────────────

FONT_SERIF = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
FONT_SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def wrap_text(draw: ImageDraw.ImageDraw, text: str, font, width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    cur = ""
    for w in words:
        trial = (cur + " " + w).strip()
        if draw.textlength(trial, font=font) <= width:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def make_og(title: str, dest: Path, kicker: str = "Richest Country Guides") -> None:
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), "#1c1710")
    draw = ImageDraw.Draw(img)
    # gold rule and warm panel
    draw.rectangle([0, 0, 18, H], fill="#c9a227")
    draw.rectangle([18, 0, W, H], fill="#241d16")
    draw.rectangle([18, 0, W, 8], fill="#c9a227")
    kfont = ImageFont.truetype(FONT_SANS, 28)
    tfont = ImageFont.truetype(FONT_SERIF, 64)
    ffont = ImageFont.truetype(FONT_SANS, 26)
    draw.text((80, 80), kicker.upper(), font=kfont, fill="#c9a227")
    lines = wrap_text(draw, title, tfont, W - 160)
    y = 160
    for line in lines[:5]:
        draw.text((80, y), line, font=tfont, fill="#f6f1e8")
        y += 78
    draw.text((80, H - 90), "richestcountry.gumroad.com", font=ffont, fill="#9a8f7a")
    dest.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest, "PNG", optimize=True)


def write_favicon(dest: Path) -> None:
    dest.write_text(
        """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="4" fill="#1c1710"/>
  <rect x="0" y="0" width="32" height="4" fill="#c9a227"/>
  <text x="16" y="23" text-anchor="middle" font-family="Georgia, serif" font-size="16" fill="#f6f1e8">RC</text>
</svg>
""",
        encoding="utf-8",
    )


# ── load guides ─────────────────────────────────────────────────────────────

def load_guides() -> list[dict]:
    guides = []
    for path in sorted(GUIDES_DIR.glob("*.md")):
        meta, body = split_frontmatter(path.read_text(encoding="utf-8"))
        slug = meta.get("slug") or path.stem
        title = meta["title"]
        description = meta["description"]
        date = meta.get("date") or TODAY.date().isoformat()
        product = meta["product"]
        query = meta.get("query", "")
        queries = meta.get("queries") or []
        related = meta.get("related") or []
        html, toc = markdown_to_html(body)
        wc = word_count(body)
        guides.append(
            {
                "slug": slug,
                "title": title,
                "description": description,
                "date": date,
                "product": product,
                "query": query,
                "queries": queries if isinstance(queries, list) else [queries],
                "related": related if isinstance(related, list) else [related],
                "html": html,
                "toc": toc,
                "word_count": wc,
                "path": f"/guides/{slug}/",
                "src": path,
            }
        )
    # newest first on indexes
    guides.sort(key=lambda g: g["date"], reverse=True)
    return guides


def render_guide(g: dict, by_slug: dict[str, dict]) -> str:
    toc_items = "".join(
        f'<li><a href="#{escape(i)}">{escape(t)}</a></li>' for i, t, level in g["toc"] if level == 2
    )
    toc = f'<nav class="toc" aria-label="On this page"><strong>In this guide</strong><ol>{toc_items}</ol></nav>'
    related = []
    for slug in g["related"]:
        other = by_slug.get(slug)
        if other:
            related.append(f'<li><a href="{escape(other["path"])}">{escape(other["title"])}</a></li>')
    related_html = ""
    if related:
        related_html = "<section class=\"related\"><h2>Keep going</h2><ul>" + "".join(related) + "</ul></section>"
    date_label = datetime.strptime(g["date"], "%Y-%m-%d").strftime("%B %-d, %Y")
    body = f"""
    <article class="guide-wrap guide">
      <p class="kicker">{escape(SITE["products"][g["product"]]["name"])}</p>
      <h1>{escape(g["title"])}</h1>
      <p class="meta">Published {escape(date_label)} · {g["word_count"]:,} words · {escape(SITE["author"])}</p>
      {toc}
      {g["html"]}
      {cta_box(g["product"])}
      {related_html}
    </article>
    """
    return body


def article_ld(g: dict) -> dict:
    return {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": g["title"],
        "description": g["description"],
        "datePublished": g["date"],
        "dateModified": g["date"],
        "inLanguage": "en",
        "mainEntityOfPage": abs_url(g["path"]),
        "image": abs_url(prefixed(f"/assets/og-{g['slug']}.png")),
        "author": {"@type": "Organization", "name": SITE["author"], "url": site_url() + "/"},
        "publisher": {
            "@type": "Organization",
            "name": SITE["author"],
            "url": SITE["store_url"],
        },
        "keywords": ", ".join([g["query"], *g["queries"]]) if g["query"] else ", ".join(g["queries"]),
    }


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def build_home(guides: list[dict]) -> str:
    cards = []
    for g in guides:
        cards.append(
            f"""<a class="card" href="{escape(g['path'])}">
  <p class="meta">{escape(datetime.strptime(g['date'], '%Y-%m-%d').strftime('%B %-d, %Y'))} · {escape(SITE['products'][g['product']]['name'])}</p>
  <h3>{escape(g['title'])}</h3>
  <p>{escape(g['description'])}</p>
</a>"""
        )
    return f"""
    <section class="hero">
      <div class="hero-inner">
        <p class="kicker">Richest Country Guides</p>
        <h1>How-to guides for shipping small web products</h1>
        <p class="lede">{escape(SITE["tagline"])} Each guide answers a real search question, uses working code, and ends with a kit you can deploy.</p>
      </div>
    </section>
    <section class="section">
      <div class="wrap">
        <h2>Latest guides</h2>
        <div class="cards">
          {''.join(cards)}
        </div>
      </div>
    </section>
    """


def build_index(guides: list[dict]) -> str:
    cards = []
    for g in guides:
        date_label = datetime.strptime(g["date"], "%Y-%m-%d").strftime("%B %-d, %Y")
        cards.append(
            f"""<a class="card" href="{escape(g['path'])}">
  <p class="meta">{escape(date_label)} · {escape(SITE['products'][g['product']]['name'])}</p>
  <h3>{escape(g['title'])}</h3>
  <p>{escape(g['description'])}</p>
</a>"""
        )
    return f"""
    <section class="hero">
      <div class="hero-inner">
        <p class="kicker">All guides</p>
        <h1>The library</h1>
        <p class="lede">One solid guide at a time. New posts are added daily, each aimed at a specific how-to query.</p>
      </div>
    </section>
    <section class="section">
      <div class="wrap">
        <div class="cards">
          {''.join(cards)}
        </div>
      </div>
    </section>
    """


def sitemap(guides: list[dict]) -> str:
    urls = [
        ("/", "1.0", "weekly"),
        ("/guides/", "0.8", "daily"),
    ]
    for g in guides:
        urls.append((g["path"], "0.9", "monthly"))
    today = TODAY.date().isoformat()
    items = []
    for path, prio, freq in urls:
        items.append(
            f"""  <url>
    <loc>{escape(abs_url(path))}</loc>
    <lastmod>{today}</lastmod>
    <changefreq>{freq}</changefreq>
    <priority>{prio}</priority>
  </url>"""
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(items)
        + "\n</urlset>\n"
    )


def robots() -> str:
    return f"""User-agent: *
Allow: /

Sitemap: {abs_url('/sitemap.xml')}
"""


def assert_output_scope() -> None:
    if not SITE_PUBLIC.is_dir():
        raise SystemExit(f"refusing to build: {SITE_PUBLIC} is not a directory")
    if OUT.name != "guides" or OUT.parent.resolve() != SITE_PUBLIC.resolve():
        raise SystemExit(f"refusing to build: output {OUT} is not public/guides")
    if OUT.resolve() == SITE_PUBLIC.resolve():
        raise SystemExit("refusing to build: would wipe the game public/ directory")


def snapshot_game_files() -> dict[str, str]:
    """Hash every public file the guides build is not allowed to change."""
    found: dict[str, str] = {}
    for path in SITE_PUBLIC.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(SITE_PUBLIC).as_posix()
        if rel in {"sitemap.xml", "robots.txt"} or rel.startswith("guides/"):
            continue
        found[rel] = hashlib.sha256(path.read_bytes()).hexdigest()
    return found


def copy_root_static() -> None:
    """Copy src/static into the site root for files that must live at /.

    Search Console HTML verification is the intended use. Never overwrite the
    game homepage, legal pages, game scripts, or an existing file.
    """
    static = SRC / "static"
    if not static.exists():
        return
    for src in static.iterdir():
        if not src.is_file() or src.name.startswith("."):
            continue
        if src.name in PROTECTED_NAMES or src.name in {"sitemap.xml", "robots.txt"}:
            print(f"skip protected static file {src.name}")
            continue
        dest = SITE_PUBLIC / src.name
        if dest.exists():
            print(f"skip existing public/{src.name}")
            continue
        shutil.copy2(src, dest)


def build() -> list[dict]:
    assert_output_scope()
    before = snapshot_game_files()
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "assets").mkdir(parents=True)
    assets = SRC / "assets"
    if assets.exists():
        for f in assets.iterdir():
            if f.is_file() and not f.name.startswith("."):
                shutil.copy2(f, OUT / "assets" / f.name)
    copy_root_static()
    write_favicon(OUT / "assets" / "favicon.svg")

    guides = load_guides()
    by_slug = {g["slug"]: g for g in guides}

    make_og("How-to guides for shipping small web products", OUT / "assets" / "og-home.png")

    index_ld = {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "name": SITE["name"],
        "url": abs_url(PREFIX + "/"),
        "description": SITE["description"],
        "publisher": {"@type": "Organization", "name": SITE["author"], "url": SITE["store_url"]},
    }
    write(
        OUT / "index.html",
        layout(
            title=f"{SITE['name']} — {SITE['tagline']}",
            description=SITE["description"],
            canonical=abs_url(PREFIX + "/"),
            body=build_home(guides),
            og_image="/assets/og-home.png",
            json_ld=index_ld,
        ),
    )

    for g in guides:
        og_rel = f"/assets/og-{g['slug']}.png"
        make_og(g["title"], OUT / "assets" / f"og-{g['slug']}.png")
        write(
            OUT / g["slug"] / "index.html",
            layout(
                title=f"{g['title']} — {SITE['name']}",
                description=g["description"],
                canonical=abs_url(g["path"]),
                body=render_guide(g, by_slug),
                og_image=og_rel,
                json_ld=article_ld(g),
                type_="article",
            ),
        )

    write(SITE_PUBLIC / "sitemap.xml", sitemap(guides))
    write(SITE_PUBLIC / "robots.txt", robots())
    write(
        OUT / "404.html",
        layout(
            title=f"Page not found — {SITE['name']}",
            description="That guide is not here.",
            canonical=abs_url(PREFIX + "/404.html"),
            body='<section class="hero"><div class="hero-inner"><h1>Page not found</h1><p class="lede">That URL is not in the library. <a href="/guides/">Browse all guides</a>.</p></div></section>',
        ),
    )
    after = snapshot_game_files()
    changed = []
    for rel, digest in before.items():
        if rel not in after:
            changed.append(f"deleted {rel}")
        elif after[rel] != digest:
            changed.append(f"modified {rel}")
    if changed:
        raise SystemExit("refusing to finish: guides build changed game files: " + ", ".join(changed))
    return guides


def report(guides: list[dict]) -> int:
    print(f"Built {len(guides)} guide(s) → {OUT}")
    print(f"Site URL: {site_url()}")
    codes = active_discounts()
    print("Active discount codes:", ", ".join(d["code"] for d in codes) or "(none)")
    bad = 0
    for g in guides:
        flag = ""
        if not (1200 <= g["word_count"] <= 2000):
            flag = "  ** WORD COUNT OUT OF RANGE **"
            bad += 1
        print(f"  - {g['path']}  {g['word_count']} words  query={g['query']!r}{flag}")
        for slug in g["related"]:
            if slug not in {x["slug"] for x in guides}:
                print(f"    missing related slug: {slug}")
                bad += 1
    return bad


if __name__ == "__main__":
    guides = build()
    status = report(guides)
    if status:
        sys.exit(1)
