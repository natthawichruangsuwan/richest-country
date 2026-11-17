#!/usr/bin/env bash
# Rebuild guides into public/, commit, and push main so the existing Render
# web service autodeploys. Does not change render.yaml or create a new site.
set -euo pipefail
cd "$(dirname "$0")/.."

python3 guides/build.py

branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" != "main" ]]; then
  echo "Refusing to push: checkout main first (current branch is ${branch})."
  exit 1
fi

git add guides public/guides public/sitemap.xml public/robots.txt
if git diff --cached --quiet; then
  echo "Nothing to commit. Pushing main as-is."
else
  git commit -m "${1:-Publish guides}"
fi

git push origin main
echo "Pushed main. Render should autodeploy https://richest-country.onrender.com/guides/"
