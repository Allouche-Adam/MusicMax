# Chrome Web Store submission checklist

Done for you:

- [x] Store package: `npm run package` → `dist/musicmax-3.3.0.zip` (runs the tests
      first; contains only manifest, background/, content/, popup/, icons/, *.css)
- [x] Icons 16/32/48/128 (`icons/`, redraw with `npm run icons`)
- [x] Automatic lookups use LRCLIB only; Genius/NetEase are opt-in optional permissions
- [x] Developer reload hook removed
- [x] Listing text (`listing.md`), permission justifications (`permissions.md`),
      data-use answers (`data-use.md`), privacy policy (`privacy-policy.md`)

Left for you:

1. **Check the name is free**: search the Chrome Web Store for "MusicMax". If another
   extension uses it, rename in `manifest.json` (`name`, `short_name`,
   `default_title`), the popup's `<title>`/`<h1>`, `popup.js` (log header), README
   and `store/`.
2. **Load the zip once as a real install check**: unzip `dist/musicmax-3.3.0.zip`
   to a folder, Load unpacked in `chrome://extensions`, play a song without lyrics,
   and try turning on "Also search Genius & NetEase" in the popup (Chrome should ask
   for permission). Not tested in a browser yet.
3. **Register as a developer**: https://chrome.google.com/webstore/devconsole, pay
   the one-time US$5 fee, and verify your contact email.
4. **Host the privacy policy**: put `privacy-policy.md` somewhere public (a GitHub
   repo's file or GitHub Pages, a Google Doc shared "anyone with the link", Notion…).
   (Contact email already filled in: buildunebuildune@gmail.com.)
5. **Screenshots**: at least one 1280×800 (or 640×400) PNG/JPEG, up to five. Set
   the browser window so the Spotify tab is 1280×800, or capture larger and resize.
   Hide your account name/avatar.
6. **Optional**: a 440×280 small promo tile (needed to be featured).
7. **Create the item**: Dashboard → New item → upload the zip.
8. **Store listing tab**: paste from `listing.md`; category Entertainment; language
   English; upload the icon and screenshots.
9. **Privacy practices tab**: paste from `permissions.md` and `data-use.md`; add the
   privacy policy URL.
10. **Distribution**: Public, all regions (or choose).
11. **Submit for review**. Expect a few days; host permissions add review time.

For each future update: bump `version` in `manifest.json` and `package.json`, run
`npm run package`, upload the new zip on the item's Package tab.

# Firefox Add-ons (AMO)

`npm run package` also builds `dist/musicmax-<version>-firefox.zip`: same files, with a
manifest rewritten by `firefoxManifest()` in `scripts/package.mjs` (background as an
event page, add-on id `musicmax@thock`, Firefox 140+, data collection = website
content). Translation shows a "Firefox has no built-in translator" note; everything
else is the same.

1. **Test it**: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → pick
   the zip. Play a song without lyrics; try the Genius & NetEase switch in the popup.
2. **Developer account**: https://addons.mozilla.org/developers/ (free).
3. **Submit a New Add-on** → "On this site" → upload the Firefox zip. The id can never
   change after the first upload, so change `GECKO_ID` before that if you want another.
4. **Source code**: not needed (the code isn't minified or bundled).
5. **Listing**: reuse `listing.md`, the screenshots and the privacy policy URL.
