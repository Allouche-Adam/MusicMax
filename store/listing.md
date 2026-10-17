# Store listing: SpotiPlus 3.3.0

Paste these into the Chrome Web Store Developer Dashboard → your item → **Store listing**.

## Name

SpotiPlus

(Comes from `manifest.json`; the dashboard shows it but you can't edit it there.
See the trademark note in `CHECKLIST.md`.)

## Short description (summary, max 132 characters)

Comes from the manifest `description` (125 characters):

> Lyrics for songs that have none on the Spotify web player, synced when possible, with karaoke, translation and ambient light.

## Category

Entertainment

## Language

English

## Detailed description

```
SpotiPlus fills the gaps in the Spotify web player (open.spotify.com): when a song has no lyrics, it finds them and shows them right where Spotify's own lyrics would be.

LYRICS WHERE THEY BELONG
• The greyed-out mic button works again and opens a full lyrics view, like Spotify's own.
• The lyrics tab in the expanded Now Playing view works too.
• A Lyrics card in the Now Playing sidebar, with full screen.
• Colors taken from the album cover.

SYNCED WHEN POSSIBLE
• Timed lyrics follow the song: the current line lights up, past lines fade, and clicking a line jumps there.
• Karaoke fill sweeps across the current line; dots fill up during instrumental breaks.

MORE THAN LYRICS
• Translation under each line, done on your computer by Chrome's built-in translator: nothing is sent anywhere.
• Romanization for Korean, Cyrillic and Greek (and Japanese, with the optional sources).
• Share a line: right-click it to copy or save it as an image card.
• Ambient light: a soft glow around covers and videos, and behind lyrics, Spotify's own included.
• Keyboard shortcuts: L for lyrics, F for full screen.

WRONG LYRICS?
A "Wrong lyrics?" link lets you search and pick the right song. Your choice is remembered.

WHERE LYRICS COME FROM
Songs are looked up on LRCLIB, an open lyrics database with a public API. You can turn on Genius and NetEase as extra sources for the manual search; it's off by default, and Chrome asks for your permission first.

PRIVATE BY DESIGN
No account, no tracking, no analytics. Only the song's title, artist and length are sent to the lyrics service to find the lyrics. Settings and saved lyrics stay in your browser.

SpotiPlus is an independent project. It is not affiliated with, endorsed by or sponsored by Spotify. Spotify is a trademark of Spotify AB.
```

## Graphics (you make these)

| Asset | Size | Required |
| --- | --- | --- |
| Store icon | 128×128 PNG | yes: use `icons/icon128.png` |
| Screenshots | 1280×800 (or 640×400) PNG/JPEG, 1 to 5 | yes, at least 1 |
| Small promo tile | 440×280 PNG/JPEG | optional, needed to be featured |
| Marquee promo tile | 1400×560 | optional |

Screenshot ideas: the full lyrics view with synced lines and karaoke fill; the
sidebar card; the settings popup; a shared line image; ambient light around a video.
Blur or crop anything personal (your Spotify name/avatar, playlists).
