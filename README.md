[![Website](https://img.shields.io/website?down_color=red&down_message=offline&label=Demo-site&up_color=green&up_message=online&url=https%3A%2F%2Fdemo.web-syncplay.de)](https://demo.web-syncplay.de)
[![Codacy Badge](https://app.codacy.com/project/badge/Grade/35f7884623744a5c8ad64e184f6f5dcf)](https://www.codacy.com/gh/Web-SyncPlay/Web-SyncPlay/dashboard?utm_source=github.com&amp;utm_medium=referral&amp;utm_content=Web-SyncPlay/Web-SyncPlay&amp;utm_campaign=Badge_Grade)
[![CodeFactor](https://www.codefactor.io/repository/github/web-syncplay/web-syncplay/badge)](https://www.codefactor.io/repository/github/web-syncplay/web-syncplay)
[![Docker Image Size (tag)](https://img.shields.io/docker/image-size/websyncplay/websyncplay/latest?logo=docker)](https://hub.docker.com/r/websyncplay/websyncplay)

# Web-SyncPlay

Watch videos, listen to music or tune in for a live stream and all that with your friends. Web-SyncPlay is a software
that lets you synchronise your playback with all your friends with a clean modern Web-UI written
in [React](https://reactjs.org/), designed using [Bootstrap 4](https://getbootstrap.com/) and build on top
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

## Known limitations

I would have loved to keep the original Player-UIs for ease of use, but they are usually being embedded as an iframe, as
such the software would be limited to the included API of the vendors. This is sadly not an option if you want to make
sure that everyone stays synchronised and there is no feedback loop of commands.

The owner of a room (first participant) should have the tab of the website focused, as the browsers tighten resources
for such background tabs, resulting in unwanted desyncs and stutters due to missing updates of the playback state to the
server.

## Getting started

To run this software on your own hardware, you will need to have [Docker](https://www.docker.com/) or any other
container engine installed and simply run:

```bash
docker run -d -p 8081:8081 websyncplay/websyncplay
```

Now open your browser and visit http://localhost:8081 or however you address the server. It is ***strongly***
recommended putting a reverse proxy using TLS/SSL in front of this service.

## Adding synchronised playback to your website

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
<iframe allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
        style="border:none;"
        width="100%"
        height="100%"
        src="<YOUR_ENDPOINT>/embed/player/<ROOM_ID>?url=<YOUR_MEDIA_URL>">
</iframe>
```

If you want to sync playback across a playlist, you need to adjust the embed

- `<START_INDEX>`: index of the `queue` array, indicates from which point playback should start

- `<ITEM_1>`, `<ITEM_2>` ... `<ITEM_N>`: playlist item, the same as `<YOUR_MEDIA_URL>`, they need to be passed in the
  order you want them to be ordered

```html
<iframe allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
        style="border:none;"
        width="100%"
        height="100%"
        src="<YOUR_ENDPOINT>/embed/player/<ROOM_ID>?queueIndex=<START_INDEX>&queue=<ITEM_1>&queue=<ITEM_2>...&queue=<ITEM_N>">
</iframe>
```

## Future developments

It is planned to create an api to communicate with the player and be able to use your own custom player to control
playback.

You can already disable the player UI by adding `&controlsHidden=true` to the src link of the embed.

It is also possible to disable the syncing handler by adding `&showRootPlayer=true`. This is not recommended as this
will break the sync-process of the playback.
