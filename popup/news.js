// The "What's new" card in the popup, and the dot on the toolbar icon that points to it.
// Announce a release by changing `id` and `items` (and `intro`, an optional first line). Bug-fix releases leave this file alone,
// so they stay silent. Used by the popup and the background worker.
globalThis.MUSICMAX_NEWS = {
  id: "3.7",
  intro: "It's even better now!",
  items: [
    "Song not found? One click adds Genius & NetEase",
    "The current line stands out more: see \"Fade other lines\"",
    "\"How to use\" is now at the top of this popup",
  ],
};
