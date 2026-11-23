# Changelog

Newest first. Versions 3.6.1 to 3.6.3 shipped together as 3.6.3.

## 3.7.0 (in progress)
- No lyrics found: "Search Genius & NetEase" is now the main button (in the big view and the pop-out), with a line on why; "Search manually" moves to second place. Only while those sources are off.
- Welcome page: a recommended switch for Genius & NetEase (asks the browser right there), a "Pop the lyrics out" section with a picture, and P in the shortcuts.
- The Genius & NetEase setting says it finds more songs.
- "How to use" link at the top of the popup reopens the welcome page.
- Welcome page opens with "Nothing to set up", and a chevron at the bottom shows there's more below until you scroll.
- Clearer current line: upcoming lines now fade too (on pale covers they were almost as white as the current line). New setting "Fade other lines": Light (the old look), Medium (default), Strong.

## 3.6.5
- Fixed: when the player bar can't be read, artists from the browser's media info stay one name instead of being split at commas ("Tyler, The Creator" was searched as "Tyler" and could get another song's lyrics). The startup check now also reports a missing title or artist.
- Fixed: opening the big lyrics view from the sidebar card showed Spotify's cover (and its Credits and queue) for up to a second before the lyrics. The lyrics now go in as Spotify builds the view, and Spotify's flying-cover animation is skipped when the view opens for MusicMax's lyrics.
- Fixed: the player bar's song info wasn't found since Spotify renamed it ("now-playing-widget-v2"), so the title and artists came only from the browser's media info, which splits a name like "Tyler, The Creator" into two artists. Both the old and new names are now recognized.
- Dev: `npm run e2e:play -- <track>` plays a song in Brave with the unpacked extension and prints a text timeline of MusicMax's state and `[SGL]` console lines; `--clear-cache` clears saved lyrics first. `npm run e2e:login` signs in once. Its `view=` column shows whether the lyrics view is open. Not in the store zip.

## 3.6.4
- Clicking Spotify's lines in the pop-out jumps the song to that line.

## 3.6.3
- What's new: dot on the toolbar icon, dismissible card and "See what's new" link in the popup.
- Pop-out shows Spotify's lines, following its highlight, when those are the better lyrics and are on the page.
- Always-use: Spotify's lyrics stay over plain (untimed) lyrics, with a note saying why.
- Light on Spotify's lyrics now follows what's on screen; its setting is no longer greyed out.
- One automatic retry for brief connection failures.
- Fixed: view flickering on lookup retries with Always-use on.

## 3.6.2
- Text size setting applies to Spotify's own lyrics.
- Always-use: Spotify's lyrics hidden from the start of a song; "Loading lyrics…" shows right away.
- With Genius & NetEase on, plain LRCLIB lyrics also check those sources for a synced version.
- Note when Always-use falls back to Spotify's lyrics.

## 3.6.1
- Every translation outcome shows a message, in the big view, sidebar card and pop-out.
- Stalled translator downloads stop after 30 s and offer "Try again".
- 25 translation languages (added 11, checked against real Chrome). Detection for Indonesian, Vietnamese, Bengali, Tamil, Telugu.
- Translation size setting.

## 3.6.0 (tag v3.6.0)
- Pop-out lyrics window, with its button next to the mic and the P shortcut.
- Mic opens lyrics inside Spotify's Now Playing view; closing returns to where you were.
- Sync button, styled like Spotify's.
- New popup look; rate, feedback and uninstall forms.
- No glow on videos. Lyrics looked up sooner after a song change.

## 3.5.x (tags v3.5.0 to v3.5.3)
- Karaoke fill follows each song's own pace.
- Genius & NetEase as automatic fallback when turned on.
- Secret section, welcome page. Full screen stays up across songs.
- Always-use: view stays up between songs; closing MusicMax closes Spotify's lyrics too.

## 3.0 to 3.4 (tags v3.0.0 to v3.4.0)
- Native lyrics through the mic, lyrics tab and sidebar card; LRCLIB, Genius and NetEase; cache.
- Synced lyrics, ambient light, karaoke, translation, romanization, sharing a line, settings panel.
