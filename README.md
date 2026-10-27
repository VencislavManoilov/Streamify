<div align="center">

# Streamify

**A self-hosted streaming service for movies and series, with your own server, your own users and no subscription.**

Streamify finds a torrent for whatever you pick, streams it straight into the browser while it downloads,<br/>
converts what the browser can't play on the fly, and remembers where every viewer stopped.

<br/>

![Vue 3](https://img.shields.io/badge/Vue_3-35495E?style=for-the-badge&logo=vuedotjs&logoColor=4FC08D)
![Node.js](https://img.shields.io/badge/Node.js_24-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![WebTorrent](https://img.shields.io/badge/WebTorrent-1A8FE3?style=for-the-badge&logo=webtorrent&logoColor=white)
![FFmpeg](https://img.shields.io/badge/FFmpeg-007808?style=for-the-badge&logo=ffmpeg&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)

[Features](#features) · [Screenshots](#screenshots) · [How it works](#how-it-works) · [Getting started](#getting-started) · [Configuration](#configuration)

<br/>

<img src="./screenshots/home.jpg" alt="Streamify home page with Trending and New Movies rows" width="100%" />

</div>

<br/>

## Features

### 🎬 Watch

- **Movies and series in one place.** A Movies/Series switch on the home page, each with its own rows (Trending, New, Popular, Top Rated and a row per genre). The rows refresh every week on a fixed slot.
- **Instant streaming from torrents.** Playback starts while the torrent downloads, and seeking jumps straight to the right piece. Movie torrents come from YTS; episodes are found through Stremio add-ons (Torrentio by default, or any other add-on you configure).
- **Plays any format.** Episodes the browser can't decode (MKV with Dolby or DTS sound, HEVC/x265) are converted to HLS on the fly with ffmpeg. Files that already play are streamed as they are.
- **Smart source picking.** Every episode source is ranked for *your* browser by quality, codecs, size and seeders, then checked live. A slow or dead source gets flagged or swapped for a better one, and you can open the list and pick another yourself.
- **Binge mode.** Next/previous episode buttons, a "Next episode in 10" countdown over the credits, and the next episode loads in the background so it starts right away.
- **Resume anywhere.** Every movie and episode remembers its position. Open a series and it goes straight to the episode you should watch next.

### 🗨️ Subtitles and player

- **Subtitles in several languages**, pulled from the torrent itself, from tracks inside the video file, or from OpenSubtitles when the release has none.
- **Subtitle sync** in 100 ms or 1 s steps, plus size, background and color settings with a live preview.
- **Playback speed** from 0.5× to 2×, and an **audio track** picker for episodes with several languages.
- **Keyboard shortcuts** for everything (see [below](#keyboard-shortcuts)), a pointer that hides with the controls, and recovery when the network drops or changes mid-movie.

### 🔍 Discover

- **Search** across movies and series, with All/Movies/Series tabs, genre filters (with counts) and sorting by relevance, rating, year or length.
- **Rich details**: cast with photos, director, writers, music, studios, budget and box office, a trailer button and a link to IMDb.
- **Watchlist** with a bookmark button on every title. Saved titles stay until you've watched them.
- **Profile** with your watch history, progress bars, and stats for movies, episodes and total time watched.

### 🛡️ Invite only, with an admin panel

- **No open sign-up.** Visitors can request an account from the welcome page, and the admin invites them by email or with an invitation link.
- **Admin panel** with live stats, user management, access requests, category and torrent control, health checks for every service the server depends on, and server logs streamed live over WebSockets.

### 📱 Works on phones

Every page is built for touch as well: swipeable rows, a draggable details sheet and a native player on small screens.

<br/>

## Screenshots

### Browse

<table>
  <tr>
    <td width="50%"><img src="./screenshots/series-home.jpg" alt="Series home page with New episode badges" /></td>
    <td width="50%"><img src="./screenshots/details.jpg" alt="Movie details popup with cast and crew" /></td>
  </tr>
  <tr>
    <td align="center"><sub><b>Series home</b>: new episodes are badged</sub></td>
    <td align="center"><sub><b>Details popup</b>: play, save, trailer, IMDb, cast</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="./screenshots/search.jpg" alt="Search results for star with genre filters" /></td>
    <td width="50%"><img src="./screenshots/profile.jpg" alt="Profile page with stats and watchlist" /></td>
  </tr>
  <tr>
    <td align="center"><sub><b>Search</b> with type tabs, genre filters and sorting</sub></td>
    <td align="center"><sub><b>Profile</b> with stats, watchlist and history</sub></td>
  </tr>
</table>

### Watch a movie

<img src="./screenshots/player.jpg" alt="Interstellar playing with English subtitles" width="100%" />

<table>
  <tr>
    <td width="50%"><img src="./screenshots/player-settings.jpg" alt="Player settings: speed, subtitle language and sync" /></td>
    <td width="50%"><img src="./screenshots/movie-resume.jpg" alt="Resume from 51:57 prompt" /></td>
  </tr>
  <tr>
    <td align="center"><sub><b>Player settings</b>: speed, subtitle language, sync and style</sub></td>
    <td align="center"><sub><b>Resume</b> where you stopped, or start over</sub></td>
  </tr>
</table>

<img src="./screenshots/movie-info.jpg" alt="Movie page with crew, cast and details" width="100%" />

### Watch a series

<img src="./screenshots/series.jpg" alt="Breaking Bad S1 E2 on the series page" width="100%" />

<table>
  <tr>
    <td width="50%"><img src="./screenshots/series-episodes.jpg" alt="Episode grid with watched marks and the playing episode" /></td>
    <td width="50%"><img src="./screenshots/series-sources.jpg" alt="Source list ranked for the browser" /></td>
  </tr>
  <tr>
    <td align="center"><sub><b>Episodes</b> by season, with watched marks and progress</sub></td>
    <td align="center"><sub><b>Sources</b> ranked for your browser, checked live</sub></td>
  </tr>
  <tr>
    <td colspan="2"><img src="./screenshots/series-up-next.jpg" alt="Next episode countdown over the credits" /></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><sub><b>Up next</b>: the countdown shows over the credits, and the next episode is already loaded</sub></td>
  </tr>
</table>

### On your phone

<img src="./screenshots/mobile.jpg" alt="Streamify on a phone: home, details, series and profile" width="100%" />

### Admin panel

<img src="./screenshots/admin-overview.jpg" alt="Admin overview with stats, recently watched and most watched" width="100%" />

<table>
  <tr>
    <td width="50%"><img src="./screenshots/admin-users.jpg" alt="Users tab" /></td>
    <td width="50%"><img src="./screenshots/admin-requests.jpg" alt="Access requests tab" /></td>
  </tr>
  <tr>
    <td align="center"><sub><b>Users</b>: activity per user, roles and invitations</sub></td>
    <td align="center"><sub><b>Access requests</b>: invite or dismiss with one click</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="./screenshots/admin-content.jpg" alt="Content tab with categories" /></td>
    <td width="50%"><img src="./screenshots/admin-system.jpg" alt="System tab with mail server and service health" /></td>
  </tr>
  <tr>
    <td align="center"><sub><b>Content</b>: categories, refresh countdown and loaded torrents</sub></td>
    <td align="center"><sub><b>System</b>: mail server and service health checks</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="./screenshots/admin-logs.jpg" alt="Live server logs" /></td>
    <td width="50%"><img src="./screenshots/request-access.jpg" alt="Request account access dialog" /></td>
  </tr>
  <tr>
    <td align="center"><sub><b>Logs</b>, live over WebSockets, with filters and search</sub></td>
    <td align="center"><sub><b>Request access</b> from the welcome page</sub></td>
  </tr>
</table>

<br/>

## How it works

```mermaid
flowchart LR
    subgraph Browser
        UI["Vue 3 app<br/>Plyr + hls.js"]
    end

    subgraph Server["Node.js server"]
        API["Express API<br/>JWT auth"]
        TM["Torrent manager<br/>WebTorrent"]
        HLS["ffmpeg<br/>HLS conversion"]
        WS["WebSocket<br/>live logs"]
    end

    DB[("PostgreSQL")]

    subgraph Sources["Outside services"]
        TMDB["TMDB<br/>posters, cast, rows"]
        YTS["YTS<br/>movie torrents"]
        ADD["Stremio add-ons<br/>Torrentio, Cinemeta"]
        OS["OpenSubtitles"]
        OMDB["OMDb<br/>search"]
    end

    UI -- "REST" --> API
    UI -- "video ranges / HLS" --> TM
    UI <-. "admin logs" .-> WS
    API --> DB
    API --> TMDB & YTS & ADD & OS & OMDB
    TM --> HLS
```

1. **Catalog.** Once a week the server builds the home page rows from TMDB and matches every movie to its YTS torrents. Series rows come from TMDB too, and their episodes come from Cinemeta.
2. **Pick a title.** For a movie, the server loads the best torrent from YTS. For an episode, it asks the configured Stremio add-ons for torrents, reads each release name (quality, codecs, audio, season pack) and ranks them for the browser that asked.
3. **Stream.** WebTorrent downloads the file and the server answers the player's range requests from it, fetching the needed pieces first. If the browser can't decode the video or audio, ffmpeg remuxes or transcodes it into HLS segments instead.
4. **Clean up.** Torrents nobody is watching are dropped after an idle timeout, and the number of loaded torrents is capped, so the disk doesn't fill up.

<br/>

## Tech stack

| Layer | What it uses |
| --- | --- |
| **Client** | Vue 3, Vue Router, Plyr, hls.js, Axios, Archivo variable font |
| **Server** | Node.js 24, Express, Knex, WebTorrent, ffmpeg/ffprobe, ws, Nodemailer, JWT + bcrypt |
| **Database** | PostgreSQL (the schema is created and migrated automatically on start) |
| **Data sources** | TMDB, YTS, OMDb, OpenSubtitles, Stremio add-ons (Torrentio) and Cinemeta |
| **Deployment** | Docker Compose: the client served by nginx, the server with ffmpeg built in |

<br/>

## Getting started

### With Docker (recommended)

You need Docker with Compose, a [TMDB API key](https://www.themoviedb.org/settings/api), an [OMDb API key](https://www.omdbapi.com/apikey.aspx) and, for subtitles, an [OpenSubtitles](https://www.opensubtitles.com/en/consumers) account with an API key.

```bash
git clone https://github.com/VencislavManoilov/Streamify.git
cd Streamify

# Compose file with your keys (see Configuration below for every variable)
cp docker-compose.example.yml docker-compose.yml

# Where the client finds the API
cp client/.env.example client/.env

docker compose up -d --build
```

Then open **http://localhost:3000/admin/auth** and create the first account, which becomes the admin. On the first start the server fetches the movie and series rows, which takes a minute or two.

### Without Docker

You need Node.js 20 or newer, PostgreSQL and ffmpeg on the `PATH`.

```bash
# API on :8080
cd server
cp .env.example .env    # fill in the database and API keys
npm install
npm start

# Client on :3000 (in a second terminal)
cd client
cp .env.example .env    # VUE_APP_BACKEND_URL=http://localhost:8080
npm install
npm run serve -- --port 3000
```

<br/>

## Configuration

The server reads its settings from environment variables (`server/.env`, or `environment:` in Compose). `server/.env.example` lists all of them with comments.

<details>
<summary><b>Required</b></summary>

| Variable | What it's for |
| --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | PostgreSQL connection |
| `JWT_SECRET` | Signs login sessions and invitation links |
| `TMDB_API_KEY` | Posters, cast, home page rows, series |
| `OMDB_API_KEY` | Search |
| `FRONTEND_URL` | Used in invitation emails |
| `CORS_ORIGIN` | JSON list of client origins, e.g. `["http://localhost:3000"]` |

</details>

<details>
<summary><b>Email and subtitles</b></summary>

| Variable | What it's for |
| --- | --- |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_SECURE`, `MAIL_TLS_REJECT_UNAUTHORIZED` | SMTP server for invitations and access requests |
| `EMAIL_USER`, `EMAIL_PASS` | SMTP login |
| `MAIL_CHECK_MINUTES` | How often the admin panel checks the mail server (`0` turns it off) |
| `OPENSUBS_API_KEY`, `OPENSUBS_USERNAME`, `OPENSUBS_PASSWORD` | OpenSubtitles account for subtitles |

Without a mail server Streamify still works: the admin panel shows the invitation link to send yourself.

</details>

<details>
<summary><b>Torrents and streaming</b></summary>

| Variable | Default | What it's for |
| --- | --- | --- |
| `YTS_API_URL` | `https://movies-api.accel.li/api/v2` | YTS API, change it when YTS moves |
| `TORRENT_DOWNLOAD_PATH` | temp folder | Where torrents are downloaded (cleared on start) |
| `TORRENT_IDLE_MINUTES` | `10` | Minutes before an unwatched torrent is removed |
| `TORRENT_MAX_ACTIVE` | `4` | Torrents loaded at the same time (the ones being watched are never removed) |
| `TORRENT_MAX_CONNECTIONS` | `150` | Peer connections per torrent |
| `STREAM_ADDONS` | `https://torrentio.strem.fun` | Stremio add-ons for episodes, comma separated. Any add-on's configuration URL or `manifest.json` works |

</details>

<details>
<summary><b>Video conversion</b></summary>

| Variable | Default | What it's for |
| --- | --- | --- |
| `HLS_CACHE_PATH` | temp folder | Where converted episodes are kept while watched |
| `TRANSCODE_VIDEO` | `1` | Re-encode video the browser can't decode (HEVC in Chrome) as H.264. `0` turns it off |
| `TRANSCODE_MAX_HEIGHT` | `1080` | Height the re-encoded video is scaled down to |
| `TRANSCODE_PRESET`, `TRANSCODE_CRF` | `veryfast`, `21` | x264 speed and quality |
| `HLS_MAX_JOBS` | `6` | ffmpeg runs at the same time |
| `FFMPEG_PATH`, `FFPROBE_PATH` | from `PATH` | Only if ffmpeg isn't on the `PATH` |

</details>

<br/>

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| <kbd>/</kbd> | Jump to the search bar from anywhere |
| <kbd>Space</kbd> or <kbd>K</kbd> | Play / pause |
| <kbd>←</kbd> <kbd>→</kbd> | Back / forward 10 seconds |
| <kbd>↑</kbd> <kbd>↓</kbd> | Volume |
| <kbd>F</kbd> | Fullscreen |
| <kbd>M</kbd> | Mute |
| <kbd>C</kbd> | Subtitles on / off |
| <kbd>Esc</kbd> | Close the details popup, settings or source list |

<br/>

## Project structure

```
Streamify/
├── client/                 Vue 3 app
│   └── src/
│       ├── components/     pages, player, pickers, admin panel
│       ├── playback.js     stream recovery and progress saving
│       ├── subtitles.js    subtitle loading, sync and style
│       └── seriesData.js   episodes, sources and next-episode logic
├── server/                 Express API
│   ├── routes/             auth, movies, series, history, watchlist, admin
│   ├── utils/
│   │   ├── torrentManager.js   WebTorrent with idle cleanup and limits
│   │   ├── streamSources.js    Stremio add-ons and source ranking
│   │   ├── hls.js              on-the-fly ffmpeg conversion
│   │   ├── releaseInfo.js      reads quality and codecs from release names
│   │   └── embeddedSubtitles.js subtitles from inside MKV files
│   ├── schema.js           creates and migrates the database
│   └── server.js           streaming, subtitles, search, categories
├── screenshots/
└── docker-compose.example.yml
```

<br/>

## Disclaimer

Streamify is a personal project made for learning. It doesn't host any video: it streams torrents found by public services. Check what the laws in your country allow, and only watch what you have the right to.

## Contact

Want to try Streamify or have a question? Email me at **vencislav@manoilov.email**.
