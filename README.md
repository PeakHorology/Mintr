<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/assets/mintr/mintr-wordmark-on-dark.png">
    <img src="apps/web/public/assets/mintr/mintr-wordmark.png" alt="Mintr" width="420">
  </picture>
  <p><strong>Learn. Model. Mint.</strong><br>Your designs, your files.</p>
  <p>Local Windows CAD from Peak Horology.</p>
  <p>
    <a href="LICENSE"><img alt="GPL-3.0-or-later" src="https://img.shields.io/badge/license-GPL--3.0--or--later-2aa77e"></a>
    <img alt="Version 1.0.9" src="https://img.shields.io/badge/version-1.0.9-655447">
    <img alt="Windows" src="https://img.shields.io/badge/platform-Windows-655447">
  </p>
  <p>
    <a href="https://www.mintr3d.com">mintr3d.com</a>
    ·
    <a href="https://www.instagram.com/Mintr3D/">@Mintr3D</a>
  </p>
</div>

Mintr 1.0.9 is the local Windows CAD app from Peak Horology. The installer, shortcuts, and Windows apps entry are named **Mintr3d**. Projects stay on this computer. There is no account, no cloud, and no hosted edition.

The program file is `Mintr.exe`. New projects are saved as `.mintr`. A `.peakcad` file from PeakCAD still opens, and saving that design keeps the `.peakcad` name. The project data inside the file is unchanged.

## Features

- Shapes: box, cylinder, sphere, cone, pyramid, polygon, torus, tube, thread, text, and gears
- Gear size comes from tooth count and module, so two gears with the same module mesh
- Sketch on a face while looking at it in 3D, then extrude, cut, or revolve
- Type a length or an angle while drawing, and click a length or corner to change it
- Fillet and chamfer
- Construction lines, a stroked outline, and a sweep along a path
- Group, with an exact OpenCascade boolean when the solid supports it
- Import STL, STEP, 3MF, and SVG
- Export STL, OBJ, 3MF, and STEP (exact B-Rep when the solid allows it, faceted otherwise)

Known limits are listed in [docs/BETA-LIMITATIONS.md](docs/BETA-LIMITATIONS.md).

## Install

From a clone of this repository:

```bash
npm install
npm run package:desktop
```

The installer is written to `dist-release/PeakCAD-Setup-1.0.9.exe`. A portable build is written beside it. The setup wizard is named Mintr3d and uses the Mintr cube. Close any running Mintr window before you install. Setup upgrades an existing install in place and keeps your projects.

Developers can preview the editor locally:

```bash
npm install
npm run dev
```

That serves `http://127.0.0.1:3000` on this machine only. See [GETTING-STARTED.md](GETTING-STARTED.md).

## Checks

```bash
npm run typecheck
npm test
npm run test:e2e
npm run ci
```

`npm run test:e2e` runs the STEP round-trip against OpenCascade.

## License

[GPL-3.0-or-later](LICENSE) · © PeakHorologyLLC

Mintr is free software and comes with no warranty. In the app, open **Settings → About** or **Help → About Mintr** for the copyright notice, the license, and the written source offer.

Third-party components keep their own licenses. The OpenCascade kernel is LGPL-2.1 with the Open CASCADE exception and ships as a separate `occt-wasm.wasm` file. `npm run stage:legal` writes `THIRD-PARTY-NOTICES.txt` from the installed dependencies. The desktop build ships that file with `LICENSE.txt` and `SOURCE-OFFER.txt`.
