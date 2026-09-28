# SUKOON — Ambient Music Player

Node.js and npm app using Next.js 16 App Router and React 19. Node.js 20.9 or newer is required. There is no Python runtime or database requirement; `/api/health` is a simple Node route.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:8000`. For production:

```bash
npm run build
npm start
```

The Next.js home route hosts the existing player UI from `public/player.html`; its browser code is in `public/app.js`. Server-side metadata endpoints are implemented as Next.js route handlers:

- `GET /api/health`
- `GET /api/youtube/search?q=...&filter=music_songs`
- `GET /api/youtube/playlists/{playlistId}`
- `GET /api/youtube/playlists/{playlistId}/nextpage?nextpage=...`

No database is needed. Playlist/search metadata is fetched through public Piped instances in parallel with short timeouts. If a playlist listing is slow or empty, the server falls back to titles, IDs, and thumbnails from YouTube’s public playlist page. It does not fetch audio or stream URLs. Playlist metadata is cached in browser local storage for 24 hours; this is metadata only, not audio/offline caching.

## Playlists and playback

- The page shows 14 curated YouTube playlist cards. Titles and cards stay in this page; playback uses YouTube’s official IFrame Player API and may show ads.
- Hover a playlist card or song row to reveal **▶ PLAY**; on touch screens play buttons stay visible. Selecting a row plays that selection in the in-page player.
- Unavailable or embed-restricted tracks (YouTube errors 2, 5, 100, 101, or 150) are skipped automatically up to eight consecutive items. If playback still cannot continue, use **OPEN ↗** or **Next**. This does not override YouTube restrictions.
- Visitors can add named YouTube playlist links in **Your YouTube Playlists**; these are stored locally in that browser. The site-wide curated collection is configured in `curatedPlaylists` in `public/app.js`.
- Private playlists still require YouTube access. Local audio files and authorized, browser-playable direct audio URLs continue to use the bottom player.
