// Deployment configuration. PRD.md §3, §9.

export const CONFIG = {
  // Published CSV endpoint for the master sheet.
  // NOTE: this is the "pub?...&output=csv" form, not the "pubhtml?" link you get
  // from the Share dialog. If the sheet is ever re-published, this URL changes.
  sheetCSV:
    'https://docs.google.com/spreadsheets/d/e/2PACX-1vQtzoKLQsRshikHltqLvDxYInnl0qyu-SyK00' +
    'eEaIQSl-xoDEwadn2TXIt3QT7niB2tKvOs-KGPye_g/pub?gid=1544705327&single=true&output=csv',

  // How long to wait for the live sheet before falling back to data/atlas.json.
  liveTimeoutMs: 6000,

  // How long to wait for a local asset (the baked snapshot, the map geometry)
  // before giving up. A dead or slow host should fail fast into a visible error
  // rather than hang for the full TCP timeout.
  localTimeoutMs: 8000,

  // A live parse yielding fewer than this many countries is treated as a
  // malformed / mid-edit sheet, and the baked snapshot is used instead.
  minCountries: 100,
};
