<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/assets/mintr/mintr-wordmark-on-dark.png">
    <img src="apps/web/public/assets/mintr/mintr-wordmark.png" alt="Mintr" width="420">
  </picture>
  <p>Local Windows CAD. Your files stay on this computer.</p>
  <p>
    <a href="LICENSE"><img alt="GPL-3.0-or-later" src="https://img.shields.io/badge/license-GPL--3.0--or--later-2aa77e"></a>
    <img alt="Version 1.1.4" src="https://img.shields.io/badge/version-1.1.4-655447">
    <img alt="Windows" src="https://img.shields.io/badge/platform-Windows-655447">
  </p>
  <p>
    <a href="https://github.com/PeakHorology/peakcad/releases/download/v1.1.4/PeakCAD-Setup-1.1.4.exe"><strong>Download Mintr 1.1.4</strong></a>
  </p>
  <p>Close Mintr, then run <code>PeakCAD-Setup-1.1.4.exe</code>. Setup upgrades in place and keeps your projects.</p>
</div>

Installer, shortcuts, and the Windows apps entry are named **Mintr3d**. The program file is `Mintr.exe`. New projects save as `.mintr`. Older `.peakcad` files still open.

## 1.1.4

- Face: add material or cut a pocket on one or more flat faces
- Join through opens neighboring pockets. Leave column keeps the bar between them
- The created part matches the preview. Open Gridfinity plates split with dovetails

## 1.1.3

- Gridfinity bins and baseplates, including a split that fits the printer bed
- Concave fillet, with the groove running through the corner
- Polygon edges, X-ray, and a Light / Dark start page

## 1.1.2

- Push Pull: drag a flat face on a CAD-ready shape
- Face outlines and the drag preview match the real shape, including moved Groups
- Projects home, Drop, sketch, and Group hole/solid fixes

[Portable build](https://github.com/PeakHorology/peakcad/releases/download/v1.1.4/PeakCAD-1.1.4-portable.exe) — separate copy, does not install updates.

[All releases](https://github.com/PeakHorology/peakcad/releases)

## Build from source

```bash
npm install
npm run package:desktop
```

That writes `dist-release/PeakCAD-Setup-1.1.4.exe`. `npm run dev` previews `http://127.0.0.1:3000` on this machine only.

## License

[GPL-3.0-or-later](LICENSE) · © PeakHorologyLLC
