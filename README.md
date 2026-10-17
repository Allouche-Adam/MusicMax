# Spotify Lyrics Fallback

A Chrome / Edge / Brave extension for the Spotify web player (open.spotify.com).
When Spotify has no lyrics for a song, it finds them on **LRCLIB**, **Genius** or
**NetEase** and shows them through Spotify's own lyrics controls, synced to the song
when possible.

## Install (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this `spotify-lyrics-fallback` folder.
4. Open or reload https://open.spotify.com and play something.

After changing any file, click the reload icon on the extension in
`chrome://extensions`, then reload the Spotify tab.

## What it does

When Spotify's mic button is greyed out and lyrics are found elsewhere:

- **Mic button**: becomes clickable and opens a full lyrics view over the main area,
  like Spotify's cinema mode. It turns green while open; click again to close.
- **Expanded Now Playing view**: its greyed-out lyrics tab works too and shows the
  lyrics inside that view.
- **Now Playing sidebar**: a **Lyrics** card with **Show more / Show less**, full
  screen, and a button to open the big view.
- **Synced lyrics**: when timed lyrics exist (LRCLIB or NetEase) and fit the
  recording, the current line is white, upcoming lines use the cover's tint, and past
  lines fade. The view scrolls along, and clicking a line jumps the song there.
  Otherwise every line is shown in one color.
- **Colors**: the background is taken from the cover art, like Spotify's.
- **Wrong lyrics?**: a link under the lyrics searches all three sources. The song
  you pick is remembered for good; "Go back to the automatic match" undoes it.
- **Saved lyrics**: up to 500 songs are remembered so replays load instantly.
  Songs not played for 90 days are forgotten, the least recently played go first
  when full, "not found" is retried after 3 days, and hand-picked lyrics are kept.

### Which lyrics win

All three sources are asked at once. The first that applies wins:

1. LRCLIB synced lyrics whose recording length is within 3 s of Spotify's
2. NetEase synced lyrics, same rule
3. Genius (plain)
4. Anything else, with the timing removed if it belongs to another recording

As soon as rule 1 is met, the extension stops waiting for the others, so most
songs load in about 0.1–0.3 s.

## Toolbar popup

Click the extension's icon:

- see how many songs are saved, and clear them
- turn on **Detailed logging**
- **Copy debug log**: the last 300 events (lookups with a step-by-step trace,
  errors, warnings), ready to paste into a bug report

## Debugging

- Lines starting with a green **[SGL]** in the Spotify tab's DevTools console come
  from the extension. Each song gets one line saying what was found and where.
- To print the background log in that console, run:
  `postMessage({ type: "SGL_DUMP_LOG", last: 40 }, "*")`
- Six seconds after loading, the extension logs a warning if any Spotify page
  element it relies on is missing. That's the first sign Spotify changed its page.

## Tests

```
npm test            # unit + break-it tests (no network), Node 20+
npm run test:live   # real lookups against LRCLIB, Genius and NetEase
```

## Layout

| Path | Purpose |
| --- | --- |
| `manifest.json` | Extension manifest (MV3) |
| `background/index.js` | Service worker: message handlers, wiring |
| `background/lookup.js` | Asks the sources, picks the winner, writes the trace |
| `background/sources/*.js` | Genius, LRCLIB, NetEase |
| `background/match.js` | Title cleanup and match scoring |
| `background/lrc.js` | Parsing timed (LRC) and plain lyrics |
| `background/cache.js` | Saved lyrics (LRU, expiry, hand-picked) |
| `background/color.js` | Colors from the cover art |
| `background/log.js`, `http.js` | Debug log; fetch with timeout and retry |
| `content/spotify.js` | **Everything that reads Spotify's page**: the file to fix when Spotify changes |
| `content/main.js` | Main loop: track changes, loading, the mic and tab clicks |
| `content/view.js`, `card.js`, `picker.js`, `lyrics.js` | The big view, sidebar card, "Wrong lyrics?" panel, lyric lines |
| `content/sync.js` | Following the song's position |
| `content/core.js` | Shared helpers and logging |
| `content.css` | All page styles |
| `popup/` | Toolbar popup |
| `tests/` | Node tests |

## If it stops working

Spotify changes its page from time to time. The extension relies on these
`data-testid` attributes: `now-playing-widget`, `context-item-info-title`,
`context-item-info-artist`, `lyrics-button`, `playback-position`,
`playback-duration`, `progress-bar`, `global-nav-bar` and `now-playing-bar`.
It also relies on the expanded view's tab group (`[role="radiogroup"]`) and on the
right-hand `<aside>` holding a column of `<section>` cards. All of them live in
`content/spotify.js`.
