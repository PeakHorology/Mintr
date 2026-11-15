# Mintr: Getting Started

Mintr is a free CAD app for makers from **PeakHorologyLLC**, built for 3D printing and laser cutting. The current version is 1.4.2. It comes in two versions:

- **Windows desktop app.** The installer, shortcuts and Windows apps entry are named **Mintr3d**, and the program file is `Mintr.exe`. Files stay on your computer.
- **Browser version** at [app.mintr3d.com](https://app.mintr3d.com/). It's the same app and the same geometry engine, built as WebAssembly. Designs live in the browser's storage, and Save as… downloads a copy. See [docs/WEB-VERSION.md](docs/WEB-VERSION.md).

See [docs/BETA-LIMITATIONS.md](docs/BETA-LIMITATIONS.md) for known limits.

## Install Mintr

Download the installer from the [latest release](https://github.com/PeakHorology/Mintr/releases/latest) and run `PeakCAD-Setup-<version>.exe`. You don't need to uninstall first: Setup upgrades in place and keeps your projects and settings. Installed copies check for updates themselves (Settings → Updates).

`PeakCAD-<version>-portable.exe` is a separate copy you can run side by side. It doesn't install updates.

If a pinned taskbar icon looks wrong after an upgrade, unpin it and pin the Start Menu or Desktop shortcut again. Windows caches icons.

## Run it from source

```powershell
npm install
npm run dev
```

Open **http://localhost:3000** in Chrome on this computer. Press `Ctrl+C` in the terminal when you're done.

## Quality checks

```powershell
npm run ci
```

This runs the type check, the unit tests and the STEP end-to-end tests (OpenCascade).

## Releasing a new version

[CLAUDE.md](CLAUDE.md) has the full checklist. In short:

1. Bump `version` in `package.json` and run `npm install`. Move `UNRELEASED_NOTES` in `apps/web/src/lib/releaseNotes.ts` into a new `RELEASE_NOTES` entry.
2. Update this file and [README.md](README.md) to the new version.
3. Run the checks, commit, then `npm run package:desktop`. The installer, `.blockmap` and `latest.yml` land in `dist-release/`.
4. Publish a GitHub release `v<version>` on **PeakHorology/Mintr** with those files.
5. Update the web version with `npm run export`, then `npm run deploy:web`.
6. Bring mintr3d.com up to date with the new features.

## Branding

- Name in the installer, shortcuts and Windows apps list: **Mintr3d**
- Program file: **Mintr.exe**. Release files keep the old **PeakCAD** name, because installed copies look for it.
- Developer: **PeakHorologyLLC**
- Icon: the Mintr cube, `apps/web/public/assets/mintr/mintr-square.png`, made by `npm run prepare:desktop-icon`
- Colours: `apps/web/src/app/globals.css` (`:root` variables)

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `node` or `npm` not recognized | Close and reopen your terminal |
| Port 3000 already in use | Stop other local dev servers |
| Preview page won't load | Make sure `npm run dev` is still running |
| Desktop app won't start | Close every Mintr window and run the new Setup exe |
