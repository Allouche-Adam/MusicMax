import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanTitle, norm, scoreMatch, rank, trackKey, MIN_SCORE } from "../background/match.js";

test("cleanTitle strips version suffixes and features", () => {
  const cases = {
    "Something About Us - Remastered 2011": "Something About Us",
    "Song (feat. Drake)": "Song",
    "Song [with Future]": "Song",
    "Bohemian Rhapsody - Live Aid": "Bohemian Rhapsody",
    "Hey Jude - 2015 Mix": "Hey Jude",
    "Bloods Always Thicker - Radio Edit": "Bloods Always Thicker",
    "Track (Acoustic Version)": "Track",
    "Mr. Brightside": "Mr. Brightside",
    "Love - The Song": "Love - The Song", // a real title with a dash stays
  };
  for (const [input, want] of Object.entries(cases)) assert.equal(cleanTitle(input), want, input);
});

test("cleanTitle survives junk input", () => {
  assert.equal(cleanTitle(undefined), "");
  assert.equal(cleanTitle(null), "");
  assert.equal(cleanTitle(""), "");
  assert.equal(cleanTitle("((("), "(((");
});

test("norm ignores case, accents, punctuation and keeps non-Latin text", () => {
  assert.equal(norm("Beyoncé"), "beyonce");
  assert.equal(norm("Tyler, The Creator"), "tylerthecreator");
  assert.equal(norm("Simon & Garfunkel"), norm("Simon and Garfunkel"));
  assert.equal(norm("방탄소년단"), "방탄소년단");
  assert.equal(norm("ＢＴＳ"), "bts"); // full-width letters
  assert.equal(norm(undefined), "");
});

test("trackKey is stable across formatting", () => {
  assert.equal(trackKey({ title: "Song!", artists: ["Beyoncé"] }), trackKey({ title: "song", artists: ["BEYONCE"] }));
  assert.notEqual(trackKey({ title: "A", artists: ["X"] }), trackKey({ title: "B", artists: ["X"] }));
});

const want = { title: "Rino Hercules", artists: ["Summrs", "PlaqueBoyMax"], duration: 190 };

test("scoreMatch: right song scores high", () => {
  assert.ok(scoreMatch({ title: "Rino Hercules", artist: "Summrs & PlaqueBoyMax", duration: 190 }, want) >= 5);
});

test("scoreMatch: wrong artist or wrong song stays below the bar", () => {
  assert.ok(scoreMatch({ title: "Hercules", artist: "Lelo" }, want) < MIN_SCORE);
  assert.ok(scoreMatch({ title: "Catch a Kill", artist: "Summrs" }, want) < MIN_SCORE);
});

test("scoreMatch: Genius translation pages and karaoke versions are pushed down", () => {
  const real = scoreMatch({ title: "Rino Hercules", artist: "Summrs" }, want);
  assert.ok(scoreMatch({ title: "Summrs - Rino Hercules (Traducción)", artist: "Genius Traducciones al Español" }, want) < real);
  assert.ok(scoreMatch({ title: "Rino Hercules (Karaoke)", artist: "Summrs" }, want) < real);
});

test("scoreMatch: a live version ranks below the studio one", () => {
  const studio = { title: "Dynamite", artist: "BTS" };
  const live = { title: "Dynamite (Live At SBS 2020/12/25)", artist: "BTS" };
  const want = { title: "Dynamite", artists: ["BTS"] };
  assert.ok(scoreMatch(live, want) < scoreMatch(studio, want));
  // ...unless the playing song is the live one
  assert.equal(scoreMatch(live, { ...want, title: "Dynamite - Live" }), scoreMatch(studio, { ...want, title: "Dynamite - Live" }) - 0);
});

test("scoreMatch: duration far off costs a point, close gains one", () => {
  const base = { title: "Rino Hercules", artist: "Summrs" };
  assert.ok(scoreMatch({ ...base, duration: 191 }, want) > scoreMatch({ ...base, duration: 300 }, want));
});

test("scoreMatch handles missing fields without throwing", () => {
  assert.equal(typeof scoreMatch({}, { title: "", artists: [] }), "number");
  assert.equal(typeof scoreMatch({ title: null, artist: undefined }, { title: undefined }), "number");
});

test("rank sorts best first", () => {
  const r = rank(
    [
      { title: "Hercules", artist: "Lelo" },
      { title: "Rino Hercules", artist: "Summrs" },
    ],
    want
  );
  assert.equal(r[0].artist, "Summrs");
});
