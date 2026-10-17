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
- **Nothing found**: the mic still opens, saying so, with a **Search manually**
  button.
- **Karaoke fill** (synced lyrics): white sweeps across the current line over its
  duration, pausing with the song. **Break dots**: three dots fill up during
  instrumental gaps (and long intros).
- **Translation**: a translated line under each lyric, using Chrome's built-in,
  on-device translator (Chrome downloads a language model the first time; you
  click to allow it). **Romanization**: Japanese (romaji from NetEase), Korean,
  Cyrillic and Greek.
- **Share a line**: right-click a lyric → copy or save it as an image (the line
  over the blurred cover, with the song and artist).
- **Keyboard**: `L` opens/closes lyrics (ours, or Spotify's own when it has them),
  `F` toggles full screen, `Esc` closes. Ignored while you type anywhere (Spotify's
  search box, the picker, settings) or hold Ctrl/Alt/Cmd.

### Ambient light

- A YouTube-style glow behind large covers and videos (Canvas, music videos, video
  podcasts), in the sidebar and the expanded Now Playing view.
- Behind lyrics, ours and Spotify's own: the cover, blurred and slowly turning,
  pulsing as each new line starts.
- Effects are blurred at a tiny size and scaled up, so they stay cheap to draw.

### Settings

The gear icon in the lyrics view (or on the sidebar card), and the toolbar popup,
show the same settings: text size, alignment, karaoke, break dots, translation and
its language, romanization, background (moving cover or flat), ambient light (around
media / on Spotify's lyrics), glow strength, pulse, preferred source (best match,
LRCLIB, Genius or NetEase) and keyboard shortcuts.

### Which lyrics win

All three sources are asked at once. The first that applies wins:

1. LRCLIB synced lyrics whose recording length is within 3 s of Spotify's
2. NetEase synced lyrics, same rule
3. Genius (plain)
4. Anything else, with the timing removed if it belongs to another recording

As soon as rule 1 is met, the extension stops waiting for the others, so most
songs load in about 0.1–0.3 s. With a preferred source set, that source wins
whenever it has the song.

## Toolbar popup

Click the extension's icon:

- every setting, plus how many songs are saved (and picked by you), and clearing them
- **Troubleshooting**: detailed logging, and **Copy debug log** (the last 300
  events: lookups with a step-by-step trace, errors, warnings)

## Debugging

- Lines starting with a green **[SGL]** in the Spotify tab's DevTools console come
  from the extension. Each song gets one line saying what was found and where.
- To print the background log in that console, run:
  `postMessage({ type: "SGL_DUMP_LOG", last: 40 }, "*")`
- After loading, the extension logs a warning if any Spotify page element it relies
  on is still missing after three checks. That's the first sign Spotify changed its page.
- Developer reload (unpacked installs only): run
  `postMessage({ type: "SGL_DEV_RELOAD" }, "*")` in the Spotify tab's console, then
  reload the page.

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
| `content/sync.js` | Following the song's position (pauses, seeks) |
| `content/ambient.js` | Ambient light around media and behind Spotify's lyrics |
| `content/share.js` | "Share this line" image cards |
| `content/lang.js` | Language detection, romanization, Chrome's translator |
| `content/settings.js` | The settings list and its controls (page panel and popup) |
| `content/core.js` | Shared helpers, logging, dev hooks |
| `content.css`, `settings.css` | Page styles; settings controls |
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
