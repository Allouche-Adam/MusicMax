# MusicMax

Browser extension (Chrome MV3, Firefox) that adds lyrics to the Spotify web player. Plain JavaScript, no build step.

- **Before changing behavior:** read `DECISIONS.md`. Most bugs here came from a new rule colliding with an old one.
- **After a change:** update `CHANGELOG.md`, and `DECISIONS.md` if a decision was made.
- `npm test` runs the tests. `npm run package` tests, then builds `dist/musicmax-<version>.zip` and `-firefox.zip`.
- Tests don't cover the on-page code in `content/`: test that live in the browser.
- `content/main.js` runs code at load: declare `let`/`const` state near the top of the file, or startup can crash (a function can run before a variable declared lower down exists).
- All knowledge of Spotify's page lives in `content/spotify.js`.
- Store uploads need a higher version number each time, even after a deleted upload.
- `popup/news.js`: change `id` and `items` to announce a release; bug-fix releases leave it alone.
