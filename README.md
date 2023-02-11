[![Website](https://img.shields.io/website?down_color=red&down_message=offline&label=Website&up_color=green&up_message=online&url=https%3A%2F%2Fweb-syncplay.de)](https://demo.web-syncplay.de)
[![Codacy Badge](https://app.codacy.com/project/badge/Grade/35f7884623744a5c8ad64e184f6f5dcf)](https://www.codacy.com/gh/Web-SyncPlay/Web-SyncPlay/dashboard?utm_source=github.com&utm_medium=referral&utm_content=Web-SyncPlay/Web-SyncPlay&utm_campaign=Badge_Grade)
[![CodeFactor](https://www.codefactor.io/repository/github/web-syncplay/web-syncplay/badge)](https://www.codefactor.io/repository/github/web-syncplay/web-syncplay)
[![Docker Image Size (tag)](https://img.shields.io/docker/image-size/websyncplay/websyncplay/latest?logo=docker)](https://hub.docker.com/r/websyncplay/websyncplay)

# Web-SyncPlay

Watch videos, listen to music or tune in for a live stream and all that with your friends. Web-SyncPlay is a software
that lets you synchronise your playback with all your friends with a clean modern Web-UI written
in [React](https://reactjs.org/) for [Next.js](https://nextjs.org), designed
using [Tailwind CSS](https://tailwindcss.com/) and build on top
of [react-player](https://github.com/cookpete/react-player).

## Supported formats

- YouTube videos

- Facebook videos

- SoundCloud tracks

- Streamable videos

- Vimeo videos

- Wistia videos

- Twitch videos

- DailyMotion videos

- Vidyard videos

- Kaltura videos

- Files playable via `<video>` or `<audio>` element as well as:

  - HLS streams
  - DASH streams

- Everything that is extractable via [yt-dlp](https://github.com/yt-dlp/yt-dlp) and allowed
  via [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)

## Known limitations

I would have loved to keep the original Player-UIs for ease of use, but they are usually being embedded as an iframe, as
such the software would be limited to the included API of the vendors. This is sadly not an option if you want to make
sure that everyone stays synchronised and there is no feedback loop of commands.

## Getting started

To run this software on your own hardware, you will need to have [Docker](https://www.docker.com/) or any other
container engine installed.

### docker-compose

For ease of use there is an
example [docker-compose.yml](https://github.com/Web-SyncPlay/Web-SyncPlay/docker-compose.yml) file provided, which you
can copy and adjust to fit your deployment.

Simply create a `.env` file in the same directory and run `docker-compose config` to see if the docker-compose file is
correctly configured.

### docker

Otherwise, you could simply run the images separately via the `docker` command:

To start the temporary in memory database [redis](https://redis.io):

```bash
docker run -d -p 6379:6379 redis
```

Now run the actual service via:

```bash
docker run -d -p 8081:8081 -e REDIS_URL=redis://your-ip:6379 websyncplay/websyncplay
```

### Manual setup

To get started with running the project directly via node, clone the repository via:

```bash
git clone https://github.com/Web-SyncPlay/Web-SyncPlay
```

When you are trying to develop on the project simply run

```bash
yarn dev
```

You can now view the project under `http://localhost:3000` with hot reloads

To run an optimized deployment you need to run the following two commands:

```bash
yarn build && yarn start
```

### Environment variables

| Parameter       | Function                                       | Default                |
| --------------- | ---------------------------------------------- | ---------------------- |
| `SITE_NAME`     | The name of your site                          | `"The Anime Index"`    |
| `PUBLIC_DOMAIN` | Your domain or IP, remove trailing slash       | `"https://piracy.moe"` |
| `REDIS_URL`     | Connection string for the redis cache database | `"redis://redis:6379"` |

After deployment open your browser and visit http://localhost:8081 or however you address the server. It is
**_strongly_** recommended putting a reverse proxy using TLS/SSL in front of this service.

## Adding synchronised playback to your website

> **Warning**: currently not functional, if you want to keep using it use the v1.0 tag

A necessary prerequisite is to make your video files available to this service as e.g. HLS/DASH streams or as a simple
natively playable file via an endpoint publicly accessible via a URL. Make sure your CORS setting allow content to be
fetched from this service.

Having started the service on one of your servers you can then embed the included embed into your website. You don't
have to manually update the iframe when playing a playlist, as this is already handled automatically.

- `<YOUR_ENDPOINT>`: your endpoint from where this service will be accessible, e.g. `https://sync.example.com`

- `<ROOM_ID>`: the room ID in which participants will be kept in sync. It is recommended to handle the generation of new
  ID-string on your side, you don't have to do anything on the server side here, the room will be auto created.

- `<YOUR_MEDIA_URL>`: publicly accessible media url, from which you serve your video/audio

For playing only a single file the service can be embedded via

```html
<iframe
  allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
  style="border:none;"
  width="100%"
  height="100%"
  src="<YOUR_ENDPOINT>/embed/player/<ROOM_ID>?url=<YOUR_MEDIA_URL>"
>
</iframe>
```

If you want to sync playback across a playlist, you need to adjust the embed

- `<START_INDEX>`: index of the `queue` array, indicates from which point playback should start

- `<ITEM_1>`, `<ITEM_2>` ... `<ITEM_N>`: playlist item, the same as `<YOUR_MEDIA_URL>`, they need to be passed in the
  order you want them to be ordered

```html
<iframe
  allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
  style="border:none;"
  width="100%"
  height="100%"
  src="<YOUR_ENDPOINT>/embed/player/<ROOM_ID>?queueIndex=<START_INDEX>&queue=<ITEM_1>&queue=<ITEM_2>...&queue=<ITEM_N>"
>
</iframe>
```

You can already disable the player UI by adding `&controlsHidden=true` to the src link of the embed.

It is also possible to disable the syncing handler by adding `&showRootPlayer=true`. This is not recommended as this
will break the sync-process of the playback.

## Future developments

It is planned to create an api to communicate with the player and be able to use your own custom player to control
playback.
