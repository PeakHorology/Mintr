<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/assets/mintr/mintr-wordmark-on-dark.png">
    <img src="apps/web/public/assets/mintr/mintr-wordmark.png" alt="Mintr" width="420">
  </picture>
  <p>Free CAD for makers that starts simple and grows with you. Built for 3D printing and laser cutting.</p>
  <p>
    <a href="LICENSE"><img alt="GPL-3.0-or-later" src="https://img.shields.io/badge/license-GPL--3.0--or--later-2aa77e"></a>
    <img alt="Version 1.4.2" src="https://img.shields.io/badge/version-1.4.2-655447">
    <img alt="Windows and browser" src="https://img.shields.io/badge/platform-Windows%20%7C%20browser-655447">
  </p>
  <p>
    <a href="https://github.com/PeakHorology/Mintr/releases/download/v1.4.2/PeakCAD-Setup-1.4.2.exe"><strong>Download Mintr 1.4.2 for Windows</strong></a>
    ·
    <a href="https://app.mintr3d.com/"><strong>Open Mintr in your browser</strong></a>
  </p>
  <p>Close Mintr, then run <code>PeakCAD-Setup-1.4.2.exe</code>. Setup upgrades in place and keeps your projects. Mintr also updates itself from Settings → Updates.</p>
</div>

Mintr needs no account and no subscription. On Windows, your files stay on your computer. In the browser, designs are kept in the browser's storage, and Save as… keeps a copy on your computer. Find out more at [mintr3d.com](https://mintr3d.com).

The installer, shortcuts and Windows apps entry are named **Mintr3d**. The program file is `Mintr.exe`. Designs save as `.mintr`, and older `.peakcad` files still open.

## New in 1.4.2

- Dice is a new shape with 4, 6, 8, 10, 12 or 20 sides. It sits flat on a face, so it prints without supports.
- Picture Keychain turns a drawing or logo into a keychain, a plaque or just the drawing.
- Mirror makes a mirrored copy on the side you pick, touching the original.
- Tinkercad designs now bring over Text, Stars, Hearts, Paraboloids and Icosahedrons too.
- Toolbox Label is now Name Plate, and can be a plain sign or a plate shaped round the words.
- Name Plates and keychains build much faster.
- Fonts you add keep every hole in their letters, like the top of a B.

Every version's notes are in Settings → Updates inside Mintr, and on the [releases page](https://github.com/PeakHorology/Mintr/releases).

[Portable build](https://github.com/PeakHorology/Mintr/releases/download/v1.4.2/PeakCAD-1.4.2-portable.exe): a separate copy that doesn't install updates.

## Build from source

```bash
npm install
npm run dev
```

`npm run dev` opens the editor at `http://localhost:3000` on this computer. `npm run package:desktop` builds the Windows installer into `dist-release/`. `npm run ci` runs the type check and the tests. See [GETTING-STARTED.md](GETTING-STARTED.md) for more.

## License

[GPL-3.0-or-later](LICENSE) · © PeakHorologyLLC
