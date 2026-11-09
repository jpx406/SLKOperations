// Sizes of the Elmar catalogue pictures (see diagramPictures.ts, which holds the image data for the PDF only, so the
// browser bundle stays small). pt: size on the catalogue page, one scale for every part; axis: where the string runs.
// Generated with diagramPictures.ts; regenerate rather than edit by hand.

export const PICTURE_SIZES = {
  stuffing_box: { pt: [33.0, 59.8], axis: 0.830 },
  tool_catcher: { pt: [13.6, 52.6], axis: 0.449 },
  lubricator: { pt: [11.0, 66.2], axis: 0.492 },
  lubricator_int: { pt: [11.0, 66.2], axis: 0.488 },
  tool_trap: { pt: [19.0, 50.8], axis: 0.425 },
  quick_test_sub: { pt: [17.4, 41.2], axis: 0.362 },
  bop_triple: { pt: [104.6, 69.6], axis: 0.499 },
  bop_dual: { pt: [104.6, 58.6], axis: 0.500 },
  bop_single: { pt: [104.4, 49.2], axis: 0.497 },
  pump_in_sub: { pt: [25.0, 32.0], axis: 0.274 },
  wellhead_adapter: { pt: [19.2, 15.4], axis: 0.490 },
  grease_head: { pt: [15.8, 141.8], axis: 0.415 },
  tree: { pt: [96.0, 102.2], axis: 0.500 },
} as const;

export type PictureKey = keyof typeof PICTURE_SIZES;
