import { test } from "node:test";
import assert from "node:assert/strict";
import { extractGeniusLyrics } from "../background/sources/genius.js";

// Same structure as a real Genius page (made-up words).
const PAGE = `
<html><body>
<div id="lyrics-root">
  <div data-lyrics-container="true" class="Lyrics__Container">
    <div data-exclude-from-selection="true" class="LyricsHeader">
      <button><span>75 Contributors</span></button>
      <div class="Dropdown"><span>Translations</span><div>Español</div></div>
      <h2>Test Song Lyrics</h2>
    </div>
    [Verse 1]<br/>First line &amp; more<br><a href="/x"><span>Annotated line</span></a><br/>Don&#x27;t stop<br/>
  </div>
  <div class="Ad">ignore me</div>
  <div data-lyrics-container="true">[Chorus]<br>Second <i>block</i> &quot;quoted&quot;<br>Caf&#233;</div>
</div>
</body></html>`;

test("extracts text from every lyrics container, minus the header block", () => {
  const text = extractGeniusLyrics(PAGE);
  assert.match(text, /First line & more/);
  assert.match(text, /Annotated line/);
  assert.match(text, /Don't stop/);
  assert.match(text, /Second block "quoted"/);
  assert.match(text, /Café/);
  assert.doesNotMatch(text, /Contributors|Translations|Español|Test Song Lyrics|ignore me/);
});

test("returns empty text when there are no lyrics containers", () => {
  assert.equal(extractGeniusLyrics("<html><body><p>Lyrics for this song have yet to be released</p></body></html>"), "");
  assert.equal(extractGeniusLyrics(""), "");
});

test("does not hang or throw on broken HTML", () => {
  assert.doesNotThrow(() => extractGeniusLyrics('<div data-lyrics-container="true">never closed <div><div>'));
  assert.doesNotThrow(() => extractGeniusLyrics("<div".repeat(20000)));
});
