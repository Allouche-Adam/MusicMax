// content/spotify.js readTrack() when Spotify's player bar can't be read: it falls back to
// the browser's media info, which holds every artist in one string.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function readTrackWithMediaInfo(metadata) {
  const ctx = {
    SGL: {},
    document: { querySelector: () => null, querySelectorAll: () => [] }, // player bar not found
    navigator: { mediaSession: { metadata } },
  };
  ctx.globalThis = ctx;
  vm.runInNewContext(readFileSync(new URL("../content/spotify.js", import.meta.url), "utf8"), ctx);
  return ctx.SGL.spotify.readTrack();
}

test("spotify: media-info fallback keeps a comma inside an artist's name", () => {
  const t = readTrackWithMediaInfo({ title: "EARFQUAKE", artist: "Tyler, The Creator", artwork: [] });
  // Split on commas, LRCLIB was searched for an artist "Tyler", whose first hit is another song.
  assert.deepEqual([...t.artists], ["Tyler, The Creator"]);
});

test("spotify: media-info fallback with several artists keeps them as one name", () => {
  const t = readTrackWithMediaInfo({ title: "Señorita", artist: "Shawn Mendes, Camila Cabello", artwork: [] });
  assert.deepEqual([...t.artists], ["Shawn Mendes, Camila Cabello"]);
});

test("spotify: no media info and no player bar → no track", () => {
  assert.equal(readTrackWithMediaInfo(null), null);
});
