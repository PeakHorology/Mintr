# Mintr

Mintr (installer name Mintr3d, older name PeakCAD) is a CAD app for makers. It's built for both 3D printing and laser cutting, and it's made by PeakHorologyLLC. It runs as a Windows desktop app (Electron) and in the browser at app.mintr3d.com.

## Layout

- `apps/web` holds the Next.js app, in TypeScript. Both the desktop and web versions use it.
  - `src/components/SketchForgeEditor.tsx` is the main editor. Most features are wired up there.
  - `src/components/workplane/` holds the panels, the inspector, the Parts tree (`ShapeSidebar.tsx`) and dialogs.
  - `src/lib/` holds the geometry and features. Parametric shapes store a spec on the shape and are rebuilt from it; `toolboxLabel.ts` (Name Plate) and `pictureKeychain.ts` work this way.
  - `src/workers/` runs CAD jobs in the browser (OpenCascade through brepjs, and Manifold).
  - `src/lib/releaseNotes.ts` holds the in-app update notes. New items go in `UNRELEASED_NOTES`.
- `electron/` is the desktop shell, update checker and project files.
- `native/mintr-kernel/` is the C++ engine (MintrKernel.exe). The desktop app uses it for fillet, chamfer, booleans, hollow, threads and push/pull.
- `tests/unit` holds the Vitest tests. `tests/e2e` holds the end-to-end tests.

## Commands (run from the repo root)

- `npm run dev` starts the app. Open http://localhost:3000 in Chrome to test it. Test the clipboard in Chrome, not in an editor's preview.
- `npm run typecheck`
- `npm run test` runs all unit tests. For one file: `npx vitest run --config tests/vitest.config.ts tests/unit/<name>.test.ts`
- `npm run build:kernel` rebuilds the native C++ engine after C++ changes.

## Rules

- **Commit only when asked.** Stage files by name, never with `git add -A`, because the repo folder holds untracked files that aren't part of Mintr.
- **No routine desktop rebuilds.** Don't run `npm run export` or `package:desktop`, and don't give electron:start instructions, unless it's a release.
- **Geometry fixes go in both engines.** The browser path (`src/workers`, `src/lib`) is the reference. If a fix touches something the desktop sends to `native/mintr-kernel`, make the same change in the C++, run `npm run build:kernel`, and cover it in `tests/unit/nativeKernelCoverage.test.ts`.
- **Plain English in the UI.** Write short, friendly copy for beginners and avoid CAD jargon. Each "What's new" item is one or two short sentences, saying what the user can now do. Fixes go in one line each.
- **Basic designs must not change.** `tests/unit/basicDesignsGolden.test.ts` builds a set of ordinary designs and checks their volume, size and export quality against stored numbers. If it fails, find out why before accepting new numbers with `npx vitest run -u`. It needs the WebAssembly engine (`npm run build:kernel:wasm`), which is not in git, so it only fully runs on this computer, not in GitHub CI.
- **Pro is free.** Pro only hides advanced tools from beginners. Never treat it as a paid tier.
- **Sage**, the in-app guide, is a brontosaurus with no gender. Never use he or she for Sage.
- Prefer invisible improvements over new UI, and don't copy competitors' features.
- **Ask before anything public:** publishing a GitHub release, `npm run deploy:web`, or posting anywhere.

## Releasing

1. Bump `version` in `package.json` and run `npm install` to update the lock file. Move `UNRELEASED_NOTES` into a new `RELEASE_NOTES` entry. That's what Settings → Updates shows. `docs/CHANGELOG.md` stopped at 1.1.6, so ignore it.
2. Run typecheck and the tests.
3. **Commit first, then build.** `npm run package:desktop` runs the static export, which moves `apps/web/src/app/api/slicer` aside while it runs. Staging files during a build once deleted that file from a commit. After the build, check that `git status` doesn't show it as deleted.
4. The installer lands in `dist-release/` as `PeakCAD-Setup-<version>.exe`, along with its `.blockmap` and `latest.yml`. Keep the PeakCAD file name, because `scripts/package-desktop.mjs` guards it and installed copies look for it.
5. After the user says yes, publish a GitHub release `v<version>` on **PeakHorology/Mintr** with those three files. Installed apps check that repo for updates. Never create or reuse a repo named `peakcad`.
6. After the user says yes, update the web version with `npm run export` then `npm run deploy:web`. The user handles the Cloudflare login.
7. Every release, update `README.md` and `GETTING-STARTED.md`: the version, the download links on PeakHorology/Mintr, and the "New in" list. Do this in step 1, so it's part of the release commit.
8. Every release, bring the Squarespace site at mintr3d.com up to date with Mintr's features: the version banner, "What's new" and any new tools. Show the user the changes and get a yes before saving them, since the site is public. The user handles the Squarespace sign-in.

## Working with the owner

The owner isn't technical. They guide the look, the features and testing, and they say when to bump the version and post an update. Everything under the hood is ours, including builds, code signing and GitHub releases. Explain things in plain English and make the technical calls yourself. User feedback comes in through the Formspree form inside Mintr and through GitHub issues on PeakHorology/Mintr.

Keep `dist-release` and the other `dist-*` folders. They hold every past release, and the user wants to keep them.
