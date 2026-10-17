# Privacy practices tab: purpose and permissions

Paste into Developer Dashboard → your item → **Privacy practices**.

## Single purpose

```
MusicMax shows lyrics in the Spotify web player (open.spotify.com) for songs that Spotify has no lyrics for, and lets the user customize how lyrics are displayed (synced highlighting, translation, ambient light).
```

## Permission justifications

### storage

```
Saves the user's settings and up to 500 previously found lyrics locally, so songs that were already looked up load instantly without another network request. Nothing stored leaves the browser.
```

### Host permission: https://lrclib.net/*

```
LRCLIB is the open lyrics database the extension uses to find lyrics. The extension sends the playing song's title, artist and length to LRCLIB's public API and receives the lyrics. This is the extension's core function.
```

### Host permission: https://i.scdn.co/*

```
This is Spotify's album-art server. The extension downloads the cover of the playing song (the image already shown on the page) to compute background colors for the lyrics view and to draw the cover into the "share this line" image. Only the image URL already present on the page is requested.
```

### Content script on https://open.spotify.com/*

If the dashboard asks (it's usually covered by the host permission field):

```
The extension runs on the Spotify web player only: it reads the playing song's title, artist and position from the page and shows lyrics inside Spotify's own lyrics controls.
```

### Optional host permissions: https://genius.com/* and https://music.163.com/*

```
Optional, off by default, requested only when the user turns on "Also search Genius & NetEase" in settings. When granted, the user's manual "Wrong lyrics?" searches also query these sites, and Japanese songs can show romanized (romaji) lyrics from NetEase. Turning the setting off removes the permission.
```

## Remote code

Answer **No, I am not using remote code.**

```
The extension does not execute remote code. All scripts are bundled in the package; network responses are parsed as data (JSON, lyrics text, images) and never evaluated.
```

## Data usage

See `data-use.md`.
