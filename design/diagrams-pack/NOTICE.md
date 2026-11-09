# Notice

- **Elmar artwork.** The pressure control pictures in `assets/diagram-parts/` (all except `tree.png`) and their JPEG
  copies in `core/diagramPictures.ts` are cropped from the NOV Elmar WPCE product catalogue, page 174 "Typical Pressure
  Control Equipment String Rig-up", © 2014 National Oilwell Varco, and turned grey. NESR chose to use them internally.
  Check with NOV / Elmar before using them in another company's app or in documents given to third parties; otherwise
  delete them, and the parts fall back to the pack's own steel drawings (empty `PICTURE_SIZES` / `PICTURES` and make
  `pictureFor()` in `core/diagram.ts` return `null`).
- **X-mas tree picture** (`tree.png`): from NESR's QAF14009 Rig Up Diagram workbook.
- **NESR mark** (`core/brandLogo.ts`) and the form numbers QAF14009 / QAF14010 belong to NESR. Replace them for
  another company.
- **Standards cited by the checks**: NESR-8000-SOP-01 Slickline Operations (rev 4, March 2024) and
  NESR-7000-PressureStandard-01 (April 2023). The checks quote section numbers only.
