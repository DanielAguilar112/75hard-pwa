# 75 Hard Tracker (PWA)

A daily checklist + progress photo tracker for the 75 Hard challenge. Installable on your
phone, works fully offline, data stored locally on-device (IndexedDB).

## Run locally

```bash
npm install
npm run dev
```

## Build for production

```bash
npm install
npm run build
```

This outputs a static site to `dist/`. Deploy that folder anywhere that serves static files
over HTTPS — installability requires HTTPS (or localhost).

## Deploy to your EC2 / nginx setup

Same pattern as your other projects on 3.14.146.94:

```bash
npm run build
scp -r dist/* your-ec2-user@3.14.146.94:/var/www/75hard/
```

Then add an nginx server block pointing at `/var/www/75hard`, or a location block under an
existing domain if you want it at a subpath like `danielaguilar.dev/75hard`. Make sure
`try_files $uri $uri/ /index.html;` is set so the SPA routes resolve. HTTPS via your existing
cert setup is required for the install prompt to show on Android and for service worker
registration to work at all.

## Installing on your phone

- **Android/Chrome**: visit the site, you'll get an in-app "Install" banner (or use the browser's
  "Add to Home Screen" from the menu).
- **iOS/Safari**: visit the site, tap Share, then "Add to Home Screen." iOS doesn't support the
  automatic install prompt, so the app shows a one-time banner with these instructions.

## Data & storage

All checklist state and photos are stored in IndexedDB on-device only — nothing is sent to a
server. Photos are auto-compressed to ~480px JPEGs on capture to keep storage lean (roughly
150 photos fit well within typical browser storage quotas). Clearing site data/cache in the
browser will wipe progress, so don't clear it mid-challenge.

## Stack

Vite + React + vite-plugin-pwa (Workbox under the hood) + idb-keyval + lucide-react icons.
