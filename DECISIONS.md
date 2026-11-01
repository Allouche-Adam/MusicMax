# Decisions

Newest first. Read before changing behavior. Format: what, why, rejected, affects.

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

## Blur inside tiny canvases
Why: CSS blur on enlarged elements re-renders at full size (it caused the lag).

## Answer `pointerup` on the disabled mic
Why: React owns the button, and disabled buttons never fire `click`.

## Poll Spotify's current line
Why: Spotify moves the highlight without any page change a MutationObserver can see.

## Plain JavaScript, no build step
Why: small, and store reviewers read the exact code.
