# Mintr in the browser (app.mintr3d.com)

The web version is the same build the desktop app loads: `npm run export` writes it to
`apps/web/.next-export`. It is served from Cloudflare Pages at **app.mintr3d.com**. The
Squarespace site at mintr3d.com links to it, because Squarespace cannot host the app's engine
files or send the headers below.

## What is different on the web

- **Designs live in the browser's own storage.** Mintr asks the browser to keep that storage,
  and the first visit shows a note that Save as… keeps a copy on the computer. Clearing the
  browser's site data removes designs that were never saved as files.
- **Files are downloaded rather than written to folders.** That covers Save as… and exports.
- **No slicer hand-off, auto-update or file associations.** The site is always the latest
  release.
- **The desktop app's native engine is faster** on big designs. The browser runs the same
  engine as WebAssembly.

## Headers

`apps/web/public/_headers` is copied into the build. It sends the same isolation headers that
the desktop app sends itself (`electron/desktopMain.cjs`). It also lets the hashed files under
`/_next/static` stay cached, and makes browsers check for a new engine (`*.wasm`) on each visit.

## One-time setup

1. Create a free Cloudflare account and sign in on this computer with `npx wrangler login`.
2. Publish once with `npm run export`, then `npm run deploy:web`. This creates the Pages project
   `mintr-app` and prints a `mintr-app.pages.dev` address. Check that the app works there.
3. In Cloudflare, go to **Workers & Pages → mintr-app → Custom domains**. Add
   `app.mintr3d.com`. Cloudflare then shows a **CNAME** record to add.
4. In Squarespace, go to **Settings → Domains → mintr3d.com → DNS** and add that record:
   type `CNAME`, host `app`, value `mintr-app.pages.dev`. It is usually live within an hour,
   and Cloudflare adds HTTPS by itself.
5. On the Squarespace site, add an "Open Mintr in your browser" button linking to
   `https://app.mintr3d.com/`.

## Each release

After the desktop release is built and tagged:

```
npm run export
npm run deploy:web
```

`deploy:web` refuses to publish if the build is missing or if any file is over Cloudflare's
25 MiB limit. The engines are about 22 MB today.

`deploy:web` deliberately uses Wrangler 3. Wrangler 4 turns a first Pages deploy into a Workers
set-up: it adds itself to package.json, installs packages, and tries to convert the Next.js app.
A Workers site also can't use app.mintr3d.com while the domain's DNS stays at Squarespace.
Don't run `wrangler` from the repository root.

To try a build locally exactly as it will be served, run `npm run preview:web` and open
http://localhost:4173/.
