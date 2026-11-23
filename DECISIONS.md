# Decisions

Newest first. Read before changing behavior. Format: what, why, rejected, affects.

## Upcoming lines fade; "Fade other lines" has three presets
Upcoming lines are the cover tint at 60% (Medium, default), past lines 45%. Light = the look before 3.7 (100% / 50%), Strong = 45% / 30%.
Why: the tint comes from the cover; on pale covers it's nearly white, so the white current line didn't stand out (user feedback). Medium keeps upcoming lines at about 4:1 contrast and past lines at about 3:1 on light and dark covers.
Rejected: a free slider (people can't tell what value they want, as with karaoke speed); darker tint math per cover (more code, same result).
Affects: `FADES` in `content/lyrics.js`, `--sgl-next-opacity` / `--sgl-past-opacity` in `content.css`; synced lyrics only.

## Opening Spotify's big view for our lyrics: watch the page, skip the cover flight
`openView()` waits for the big view with a MutationObserver (runs before the browser paints), and while it opens, `html.sgl-opening` hides Spotify's cover animation (view transition `cinema-npv-media`) for 1 s.
Why: Spotify builds the view on its cover tab; a 40 ms timer let the cover, Credits and queue show for up to a second, and the flying cover is drawn above the whole page, over our lyrics.
Rejected: hiding Spotify's view for a fixed 2 s (too short when Spotify is slow, an empty view when we have nothing).
Affects: only views MusicMax opens (card's expand, mic, L). Spotify's own expand button is untouched. The transition name is Spotify's: if the cover flashes again, check that name first.

## Renamed Spotify selectors keep the old name for a while
When Spotify renames an element, `content/spotify.js` lists the new and old selectors together (`new, old`) and notes when the old one can go.
Why: Spotify rolls layouts out gradually; some users keep the old page for weeks. The two names point at the same element, so matching either can't pick the wrong one.
Rejected: switching to the new name only (users still on the old layout would lose it).
Affects: `SEL.widget`, `SEL.title`, `SEL.artist` (November 2026).

## Live tests drive Brave over DevTools, no dependencies
`tests/e2e/spotify.mjs` talks the Chrome DevTools Protocol through Node's built-in WebSocket and prints text, not screenshots.
Why: Spotify needs Widevine, missing from Chrome for Testing and Playwright's Chromium; Google Chrome 137+ ignores `--load-extension`. Brave has both. No dependencies, like the zip script.
Rejected: Playwright / Puppeteer (a dependency; their default flags block Widevine and extensions); an MCP server (still many steps per test).
Affects: the test reads state inside MusicMax's content-script world, reusing `SGL.spotify`. Only the track page's play button selector lives in the test, since the extension never uses it.

## Light on Spotify's lyrics follows the screen
Why: "off with Always-use" left fallback songs flat once Spotify's lyrics could show there.
Rejected: keeping the light off with Always-use.
Affects: `lightSpotifyLyrics()`. Must stay off while MusicMax's view covers them (performance).

## Always-use: Spotify's lyrics beat plain lyrics
MusicMax replaces Spotify's only with synced or hand-picked lyrics.
Why: Spotify's are official and usually timed; Genius has no timing.
Rejected: always showing MusicMax's lyrics.
Affects: `beatsSpotify()`, hiding Spotify's lyrics, fallback notes, the light, the pop-out.

## Pop-out mirrors Spotify's lines from the page
Why: better than "No lyrics found" when Spotify has them.
Rejected: fetching them from Spotify's API (needs each user to log in).
Limit: they exist only while on the page; no timing, so no fill. Clicking a line presses the same line in Spotify's lyrics.

## Retries don't count as waiting
With Always-use, only the first lookup hides Spotify's lyrics.
Why: counting retries made the view flicker every 5 s, 30 s and 2 min.

## Translation stays on-device, no bundled languages
Why: an extension of about 90 KB can't ship models of tens of MB per pair; lyrics stay private. Firefox has no translator.
Rejected: bundling models; an online translator. Possible later: NetEase's Chinese translations (unverified).

## What's new is a dot and a card, never a tab
Why: tabs opening after background updates annoy people. Only announced releases show it.

## Lyrics view lives in Spotify's Now Playing view
Why: same header and icons as Spotify. The player bar button opens the narrow panel; its Expand button opens the big view.
Rejected: our own full-page overlay as the default (still the fallback).

## No glow on videos
Why: blurring a moving picture looked messy. Covers under a video get none either.

## Share menu doesn't block Spotify's right-click menu (reverted)
Spotify's menu opens in the browser's top layer, above ours. Stopping it was tried in 3.7 work and reverted on request; the issue is still open.

## Per-song karaoke pace
Fill time = syllables ÷ song pace, never past the next line. Pace is the 75th percentile of syllables per second.
Why: lines followed by a pause look slow; a fixed speed crawled on rap or raced on ballads.
Rejected: a speed slider (the right value differs per song); NetEase word timing (limited, unofficial).

## LRCLIB first; Genius & NetEase optional
Why: LRCLIB is open and has timing. The others need permission and are off by default.
Since 3.7 they're offered loudly instead: the main button when nothing is found, and the recommended switch on the welcome page.
Rejected (3.7): on by default as required permissions. Chrome disables an extension whose update adds required permissions until each user accepts, and every song would go to NetEase without opting in.

## Blur inside tiny canvases
Why: CSS blur on enlarged elements re-renders at full size (it caused the lag).

## Answer `pointerup` on the disabled mic
Why: React owns the button, and disabled buttons never fire `click`.

## Poll Spotify's current line
Why: Spotify moves the highlight without any page change a MutationObserver can see.

## Plain JavaScript, no build step
Why: small, and store reviewers read the exact code.
