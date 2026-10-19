# Mintr — Getting Started

Mintr is a **local Windows desktop** CAD app from **PeakHorologyLLC** (1.0.8). The installer and Windows apps entry are named **Mintr3d**. There is no hosted, browser-SaaS, or LAN edition. See [docs/BETA-LIMITATIONS.md](docs/BETA-LIMITATIONS.md) for known limits.

## Use Mintr (the app)

```powershell
cd path\to\peakcad
npm install
npm run package:desktop
```

This creates files in the `dist-release/` folder:

- `PeakCAD-Setup-1.0.8.exe` — Mintr3d installer (Start Menu and Desktop shortcuts are named Mintr3d; version matches `package.json`)
- `PeakCAD-1.0.8-portable.exe` — portable build (no install needed; not an upgrader)

Close any running Mintr window before packaging. Run the Setup or portable exe. The wizard, shortcuts, and Windows apps entry are named Mintr3d. The program file is Mintr.exe. Existing projects and settings stay where they are.

### Upgrade an existing install

You do **not** need to uninstall first. The Setup installer upgrades in place and keeps your projects and settings.

1. Bump `"version"` in `package.json` (for example `1.0.7` → `1.0.8`)
2. Close Mintr
3. Run `npm run package:desktop`
4. Run the new `PeakCAD-Setup-*.exe` from `dist-release/`
5. Finish the installer — Mintr relaunches on the upgraded build

If a pinned taskbar icon looks wrong after an upgrade, unpin it and pin the Start Menu/Desktop shortcut again (Windows caches icons aggressively).

The portable `.exe` is a separate copy you can run side-by-side; it does not upgrade an installed Mintr.

## Build from source (developers)

For UI work in Cursor, you can preview the same editor on this machine only:

```powershell
cd path\to\peakcad
npm run dev
```

Open **http://127.0.0.1:3000** on this computer. Leave the terminal open. Press `Ctrl+C` when you are done. Nothing is served to the network as a Mintr product.

## Branding

- App name in the installer, shortcuts, and Windows apps list: **Mintr3d**
- Program file: **Mintr.exe**
- Developer: **PeakHorologyLLC**
- Installer and Windows icon: the Mintr cube, `apps/web/public/assets/mintr/mintr-square.png`, via `npm run prepare:desktop-icon`
- Color palette defined in `apps/web/src/app/globals.css` (`:root` variables)

## How to make changes (with AI help)

Describe what you want in Cursor, for example:

- "Change the sidebar to forest green"
- "Add a welcome message on the home screen"
- "Rename Box to Cube in the shape picker"

Good files to customize:

| File | What it controls |
|------|------------------|
| `apps/web/src/app/page.tsx` | Home screen, project list |
| `apps/web/src/app/globals.css` | Colors and styling |
| `apps/web/src/lib/shapeCatalog.ts` | Available shapes |

## Quality checks

```powershell
npm run ci
```

Runs typecheck, unit tests, and STEP e2e (OpenCascade).

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `node` or `npm` not recognized | Close and reopen your terminal |
| Port 3000 already in use | Stop other local dev servers |
| Preview page won't load | Make sure `npm run dev` is still running |
| Desktop app won't start | Close every Mintr window and run the new Setup exe |
