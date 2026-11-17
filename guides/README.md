# Richest Country Guides

English how-to guides served at [https://richest-country.onrender.com/guides/](https://richest-country.onrender.com/guides/) by the existing game site (`server.js` → `public/`). The generator lives in this folder. Built HTML and images are committed under `public/guides/` so Render does not need a Python build step.

```bash
python3 -m pip install -r guides/requirements.txt   # once, for Pillow
python3 guides/build.py
npm start
```

Open http://127.0.0.1:3000/guides/.

Add one new guide at a time. The full process — query selection, template, internal links, sitemap, and deploy — is in [PLAYBOOK.md](PLAYBOOK.md).

Short version:

1. Add `guides/src/guides/<slug>.md` (and a `products` entry in `guides/site.json` if the guide needs a new kit).
2. Run `python3 guides/build.py` from the repo root.
3. Commit the generator and the built files (`public/guides/`, `public/sitemap.xml`, `public/robots.txt`) and push `main`.
