<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/assets/mintr/mintr-wordmark-on-dark.png">
    <img src="apps/web/public/assets/mintr/mintr-wordmark.png" alt="Mintr" width="420">
  </picture>
  <p>Free CAD for makers that starts simple and grows with you. Built for 3D printing and laser cutting.</p>
  <p>
    <a href="LICENSE"><img alt="GPL-3.0-or-later" src="https://img.shields.io/badge/license-GPL--3.0--or--later-2aa77e"></a>
    <img alt="Version 1.4.1" src="https://img.shields.io/badge/version-1.4.1-655447">
    <img alt="Windows and browser" src="https://img.shields.io/badge/platform-Windows%20%7C%20browser-655447">
  </p>
  <p>
    <a href="https://github.com/PeakHorology/Mintr/releases/download/v1.4.1/PeakCAD-Setup-1.4.1.exe"><strong>Download Mintr 1.4.1 for Windows</strong></a>
    ·
    <a href="https://app.mintr3d.com/"><strong>Open Mintr in your browser</strong></a>
  </p>
  <p>Close Mintr, then run <code>PeakCAD-Setup-1.4.1.exe</code>. Setup upgrades in place and keeps your projects. Mintr also updates itself from Settings → Updates.</p>
</div>

Mintr needs no account and no subscription. On Windows, your files stay on your computer. In the browser, designs are kept in the browser's storage, and Save as… keeps a copy on your computer. Find out more at [mintr3d.com](https://mintr3d.com).

The installer, shortcuts and Windows apps entry are named **Mintr3d**. The program file is `Mintr.exe`. Designs save as `.mintr`, and older `.peakcad` files still open.

## New in 1.4.1

- The Parts tab is a tree of your whole design. It shows every part, the steps used to make it, and the parts inside each group. Double-click a step to reopen it with the values it was made with.
- Fillet and Chamfer fill inside corners smoothly, for example where a box meets a cylinder.
- Send to laser brings a 3D print design into a laser design as an outline, stacked layers or slotted slices.
- Toolbox Label makes magnetic drawer labels with raised letters, a whole set at once.
- Circular pattern goes evenly around any shape, and both patterns can turn.
- Groups with up to 40 parts stay CAD ready in the browser, and groups with tori are much faster.
- Size boxes take units and sums such as `2in` or `(10+2)mm`.
- Sage, the in-app guide, is now a friendly brontosaurus.

Every version's notes are in Settings → Updates inside Mintr, and on the [releases page](https://github.com/PeakHorology/Mintr/releases).

[Portable build](https://github.com/PeakHorology/Mintr/releases/download/v1.4.1/PeakCAD-1.4.1-portable.exe): a separate copy that doesn't install updates.

## Build from source

```bash
npm install
npm run dev
```

`npm run dev` opens the editor at `http://localhost:3000` on this computer. `npm run package:desktop` builds the Windows installer into `dist-release/`. `npm run ci` runs the type check and the tests. See [GETTING-STARTED.md](GETTING-STARTED.md) for more.

## License

[GPL-3.0-or-later](LICENSE) · © PeakHorologyLLC
