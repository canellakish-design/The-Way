// devices.js — which wearable the morning numbers come from, and since when.
// HRV is not comparable across devices (a WHOOP and a Garmin measure it differently),
// so the recovery band and the HRV baselines only use nights from the current watch.
// Set WEARABLE and WEARABLE_SINCE in Netlify when the watch changes again.
module.exports = {
  WEARABLE: process.env.WEARABLE || 'Garmin vívoactive 6',
  WEARABLE_SINCE: process.env.WEARABLE_SINCE || '2026-11-02',   // the first night on the Garmin; before it, the WHOOP
  PREVIOUS: process.env.WEARABLE_PREVIOUS || 'WHOOP'
};
