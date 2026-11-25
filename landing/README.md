# TrueDown landing page

Plain HTML and CSS. There's no build step and no JavaScript. `.github/workflows/landing-pages.yml` publishes this folder to GitHub Pages on every push to `master` that changes it.

## First-time setup

GitHub repo → **Settings → Pages → Build and deployment → Source: GitHub Actions**. The site will be at `https://wilspi.github.io/truedown/`.

## Preview locally

Open `index.html` directly in a browser. All asset paths are relative, so nothing else is needed.

## Moving to a zeroes.dev subdomain

For example, `truedown.zeroes.dev`:

1. DNS: add a `CNAME` record from `truedown` to `wilspi.github.io`. If zeroes.dev is on Cloudflare, set it to **DNS only** (grey cloud) until GitHub issues the certificate.
2. Repo → Settings → Pages → Custom domain: `truedown.zeroes.dev`, then tick **Enforce HTTPS**.
3. Replace `https://wilspi.github.io/truedown/` with `https://truedown.zeroes.dev/` in `index.html` (canonical, `og:url`, `og:image`, JSON-LD), `robots.txt` and `sitemap.xml`.

With the Actions workflow, you set the custom domain in Settings. A `CNAME` file in this folder isn't used.

## Files

- `og.png`: 1200×630 social preview. Regenerate it if the headline changes.
- `sitemap.xml`: update `lastmod` when the content changes materially.
