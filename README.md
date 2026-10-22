<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/assets/mintr/mintr-wordmark-on-dark.png">
    <img src="apps/web/public/assets/mintr/mintr-wordmark.png" alt="Mintr" width="420">
  </picture>
  <p>Local Windows CAD. Your files stay on this computer.</p>
  <p>
    <a href="LICENSE"><img alt="GPL-3.0-or-later" src="https://img.shields.io/badge/license-GPL--3.0--or--later-2aa77e"></a>
    <img alt="Version 1.1.0" src="https://img.shields.io/badge/version-1.1.0-655447">
    <img alt="Windows" src="https://img.shields.io/badge/platform-Windows-655447">
  </p>
  <p>
    <a href="https://github.com/PeakHorology/peakcad/releases/download/v1.1.0/PeakCAD-Setup-1.1.0.exe"><strong>Download Mintr 1.1.0</strong></a>
  </p>
  <p>Close Mintr, then run <code>PeakCAD-Setup-1.1.0.exe</code>. Setup upgrades in place and keeps your projects.</p>
</div>

Installer, shortcuts, and the Windows apps entry are named **Mintr3d**. The program file is `Mintr.exe`. New projects save as `.mintr`. Older `.peakcad` files still open.

## 1.1.0

- Desktop CAD engine for Group, fillet, chamfer, hollow, and thread
- Sketch extrude, sweep, and STEP import/export use that same engine
- Group keeps imported and shared `.mintr` parts in place

[Portable build](https://github.com/PeakHorology/peakcad/releases/download/v1.1.0/PeakCAD-1.1.0-portable.exe) — separate copy, does not install updates.

[All releases](https://github.com/PeakHorology/peakcad/releases)

## Build from source

```bash
npm install
npm run package:desktop
```

That writes `dist-release/PeakCAD-Setup-1.1.0.exe`. `npm run dev` previews `http://127.0.0.1:3000` on this machine only.

## License

[GPL-3.0-or-later](LICENSE) · © PeakHorologyLLC
