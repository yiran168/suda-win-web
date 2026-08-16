# SuDa · Qrint Studio

[简体中文](README.md) | **English**

A **desktop client + web app** for the Qring / BeePrt BY-series 58mm Bluetooth thermal printers (a.k.a. 错题小印), also compatible with generic ESC/POS thermal printers.

Written from scratch in React + TypeScript, packaged as a Windows installer with Electron.

## Download

Don't want to build it yourself? Grab it from [Releases](../../releases/latest):

- **SuDa-Setup-v1.0.0.exe** — Windows installer (recommended)
- **SuDa-Portable-v1.0.0.zip** — portable build, unzip and run, no registry writes

## Usage

**Desktop app**: install and launch SuDa → pair the printer in Windows Bluetooth settings first (an "outgoing" COM port will be created) → click "Connect" on the home page and pick that COM port → start creating.

**Web app** (no installation, print straight from the browser):

1. Clone the repo, then `npm install && npm run dev` (or deploy to any HTTPS static host, e.g. GitHub Pages)
2. Open `http://localhost:7100` in **Chrome / Edge** (the Web Serial API is only available on localhost or HTTPS; Firefox / Safari are not supported)
3. Pair the printer in Windows Bluetooth settings first, same as above
4. Click "Connect" on the home page → pick the printer's port in the browser's serial-port chooser → grant access
5. Once connected, every feature works exactly like the desktop app (same codebase); previously authorized ports can reconnect directly next time

## What is this

The Qring / BeePrt BY-series is a 58mm Bluetooth thermal printer, mostly used for printing study notes, memos, and labels. The official app's servers are long gone; the upstream project open-sourced a mobile client, but there was never a decent desktop client — so SuDa was born.

It connects directly to the printer over classic Bluetooth (SPP virtual serial port), lays out text, images, barcodes and documents into a 384-dot-wide raster bitmap, and sends it straight to the printer. It supports a visual canvas editor, print preview, reusable templates, direct document printing, and print history.

The print data path uses only standard ESC/POS commands (`GS v 0` raster bitmap + `ESC J` paper feed), so **any generic serial ESC/POS 58mm thermal printer can print too**. The Qring proprietary commands are only used for status monitoring (battery / paper-out / overheat); on generic printers the status query simply times out and the app falls back to blind printing, without affecting output.

## Acknowledgements

**This project is ported and rewritten from [Thisko/QrintPrint](https://github.com/Thisko/QrintPrint).** QrintPrint is an open-source client for these printers: its author [@Thisko](https://github.com/Thisko) wrote a native HarmonyOS version from scratch in ArkTS and reconstructed the complete Qring proprietary protocol by analyzing the official app (com.zxxk.xiaoyin). SuDa would not exist without that work — huge thanks, and please consider giving the upstream project a Star ⭐

These community implementations were also consulted during development — thanks to all of them:

- [ZhaYi-Miao/QrintPrint-Web-Console](https://github.com/ZhaYi-Miao/QrintPrint-Web-Console) — web console and BLE channel exploration
- [Thisko/QringPrint-Web](https://github.com/Thisko/QringPrint-Web) — web implementation
- [snowboys/QrintPrint-Windows](https://github.com/snowboys/QrintPrint-Windows) — Windows USB approach reference
- [tanadiejiang/pocket_print](https://github.com/tanadiejiang/pocket_print) — pocket printer implementation

## Features

**Canvas editor**

- Nine element types: text / image / QR code (16 content presets) / barcode (19 symbologies) / shapes (24) / table / date-time / serial number / freehand drawing
- Rotation, multi-select group alignment and free-angle group rotation, magnetic snap guides, eight-way resize handles; selection boxes track content in real time
- Any element can be **inverted** (white on black); text supports 5 print-enhancement algorithms (compensating for models whose density command does nothing)
- **WYSIWYG**: the canvas renders the actual 1:1 print raster (203dpi pure black-and-white bitmap) — what you see is exactly what comes out of the printer

**Direct document printing**

- Import PDF / Word / PPT / Excel / TXT → tick pages, edit, and print in batches
- Word files go through a **self-built parsing & typesetting engine** (no Office or external software required): preserves multi-column sections, nested tables, text boxes, common equations (fractions / super- & subscripts / radicals / summations / matrices), real font sizes and list numbering
- Paper type / width / label size / narrow-paper loading position / trailing feed can still be changed after import — content is re-typeset and re-paginated automatically

**Templates & paper**

- 494 built-in industry templates in 12 categories; confirm paper width before applying, scaled proportionally; every part of a template stays editable
- Label paper / continuous paper / memo paper; the canvas scales proportionally with the paper; loading position adjustable for narrow paper (<55mm)

**Reliability**

- Pre-print health check: paper-out / cover-open / low-voltage / overheat interception, with overheat warnings both on the home page and mid-print
- Per-copy ACK confirmation, pacing gate for multi-copy jobs, cancel & **resume printing** (page-level + copy-level + automatic row-level resume after overheat)
- Auto-reconnect to the last device; full-chain runtime logs (connection / protocol traffic / rendering / printing), one-click .log export for troubleshooting

## Technical highlights

A few things worth mentioning:

**Qring proprietary protocol (not standard ESC/POS)**

No official SDK involved. Status queries, battery level, etc. use the printer's own `10 FF` command family; only paper feed (`ESC J`) and raster bitmap (`GS v 0`) come from ESC/POS. The protocol originates from the upstream project's analysis of the official app:

- A single status byte carries five bits: printing / cover open / paper out / low voltage / overheat
- Raster encoding: 48 bytes per row (384 dots / 8), MSB first, 1 = black
- Status polling is paused during printing so query bytes never mix into the print data stream
- The data path is pure ESC/POS: **generic 58mm serial thermal printers work with zero adaptation**, with proprietary status/health features skipped automatically

Key file: `src/protocol/qring.ts`

**1:1 raster canvas**

The canvas doesn't use ordinary DOM scaling — every element is rendered into the actual 203dpi print raster and composited back onto the screen. Thermal printers only print pure black and white, so no color ever appears on canvas; aliasing, dithering and inversion look exactly like the printed output. Editing clarity = printing clarity.

Key files: `src/render/` (rasterization, dithering & binarization, text enhancement)

**Self-built docx parsing & typesetting engine**

Libraries like mammoth flatten nested tables and drop columns, text boxes and equations — so we wrote our own:

- Parsing layer: namespace-URI matching, `w:cols` section columns, styles/numbering resolution, recursive tables via `tblGrid`, text boxes lifted from `w:txbxContent`, an OMML equation subset
- Typesetting layer: AST → column-band flow layout → per-page raster drawing
- The equation layout engine covers fractions, super/subscripts, radicals, summations and matrices — enough for K-12 problem-note scenarios

Key files: `src/docs/docxParser.ts` → `src/docs/flowTypeset.ts` → `src/docs/mathLayout.ts`

**Row-level resume after overheat**

Thermal-head overheating is a fact of life on these machines. When an overheat fault frame arrives mid-print (or an ACK times out with the overheat bit set), the job is *not* marked failed: the break row is **estimated** from the send rate and transfer time, rolled back 128 rows as an overlap zone, and printing resumes from that row once the head has cooled — even half-printed text or images continue without feeding paper, instead of reprinting the whole copy. Page-level and copy-level resume work the same way after cancellation.

Key file: `src/print/printJob.ts`

**Two transports, one interface**

- Desktop (Electron): `serialport` over the SPP virtual COM port (e.g. COM7)
- Web app (Chrome / Edge): Web Serial API straight to the same virtual COM port, no installation

Both transports implement the same `Transport` interface (write/close/onDrop); the protocol layer, print pipeline and auto-reconnect logic are completely unaware of the difference. The BLE passthrough module's buffer is too small and cannot carry raster data in practice (every upstream implementation on Android/HarmonyOS/Windows likewise only uses SPP), so only serial-class channels are kept.

Key files: `src/transport/`

## Project structure

```
src/
  model/       document model, paper, presets (elements/templates/memo backgrounds)
  editor/      canvas, session (selection/transform/undo), property panels
  render/      rasterization, dithering & binarization, text enhancement
  docs/        document import: self-built docx parsing (docxParser) → AST typesetting (flowTypeset) → equations (mathLayout)
  protocol/    Qring proprietary protocol + ESC/POS (status/ACK/raster)
  transport/   connection management (SPP / Web Serial, auto-reconnect)
  print/       print job pipeline (health check/per-copy/cancel/resume/overheat resume)
  pages/       home / editor / templates / settings / logs / history / user guide
electron/      desktop shell (main process, serial IPC, app:// protocol)
public/templates/  built-in template image assets
installer/     NSIS installer scripts
```

## Build

**Requirements**: Node.js 18+; Windows for desktop packaging; a Qring / 错题小印 series 58mm Bluetooth thermal printer.

```bash
npm install                     # install dependencies
npm run dev                     # web preview (default http://localhost:7100)
npm run electron                # build & launch the desktop app
node scripts/build-portable.mjs # assemble the portable build (release/qrint-portable + zip)
```

Windows installer: build with NSIS under `installer/` (run `makensis` on `qrint.nsi`; artifacts land in `release/`).

## FAQ

**Which printers are supported?** Qring / 错题小印 / BeePrt BY-series with full functionality (status monitoring, health-check interception, overheat resume); generic ESC/POS 58mm serial thermal printers print normally, with health checks and status display skipped automatically.

**Can't connect?** Pair the printer in Windows Bluetooth settings first, then pick the "SPP serial" channel and the matching COM port; the web app must be opened in Chrome / Edge. The device name usually carries a Qring prefix.

**Blurry or faint output?** The density command has no effect on these machines — enable one of the print-enhancement algorithms on text elements (5 options, ordered by clarity), or adjust the image threshold.

**Why no BLE?** The printer is SPP+BLE dual-mode, but the BLE passthrough module's buffer is too small — in testing the device drops the connection halfway through raster data (upstream Android/HarmonyOS/Windows implementations all use SPP only). BLE was therefore removed in favor of serial-class channels.

**Printing stopped midway due to overheat?** Do nothing — it resumes automatically from the break row once cooled; every resume is visible in the log page.

## Disclaimer

SuDa is a third-party client and is not affiliated with the official 错题小印 vendor. The printer communication protocol originates from the upstream open-source project's analysis of the official app and is **for learning and reference only; commercial use is strictly prohibited**. If you believe this implementation infringes your rights, please contact the author for removal.

## License

MIT License

---

Made with ❤️ by **yiran168 & Kimi K3** —— co-developed by yiran168 and Kimi K3.
