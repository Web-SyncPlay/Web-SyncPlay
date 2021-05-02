[![Website](https://img.shields.io/website?down_color=red&down_message=offline&label=Studi-Watch&up_color=green&up_message=online&url=https%3A%2F%2Fwatch.agent77326.de)](https://watch.agent77326.de)
[![Codacy Badge](https://app.codacy.com/project/badge/Grade/42301623d1514d0dba3264d9b0f48583)](https://www.codacy.com/gh/Yasamato/Studi-Watch/dashboard?utm_source=github.com&amp;utm_medium=referral&amp;utm_content=Yasamato/Studi-Watch&amp;utm_campaign=Badge_Grade)
[![CodeFactor](https://www.codefactor.io/repository/github/yasamato/studi-watch/badge)](https://www.codefactor.io/repository/github/yasamato/studi-watch)
[![Docker Image Size (tag)](https://img.shields.io/docker/image-size/yasamato/studi-watch/latest?logo=docker)](https://hub.docker.com/r/yasamato/studi-watch)

# Studi-Watch

Watch videos, listen to music or tune in for a live stream and all that with your friends. Studi-Watch is a software
that let's you synchronise your playback with all your friends with a clean modern Web-UI written
in [React](https://reactjs.org/) and designed using [Bootstrap 4](https://getbootstrap.com/).

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

I would have loved to keep the original Player-UIs for ease of use, but they are usually being embeded as an iframe, as
such the software would be limited to the included API of the vendors. This is sadly not an option if you want to make
sure that everyone stays synchronised and there is no feedback loop of commands.

Participants should have the tab with the website focused, as the browsers tend to slow down playback and tighten ressources for such background tabs, resulting in unwanted desyncs and stutters.

## Getting started

To run this software on your own hardware, you will need to have [Docker](https://www.docker.com/) or any other
container engine installed and simply run:

```bash
docker run -d -p 8081:8081 yasamato/studi-watch
```
