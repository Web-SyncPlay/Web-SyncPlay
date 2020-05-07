
function join() {
    if (userIcon) {
        console.log("Trying to join Room", roomId);
        socket
            .on('chat message', chat)
            .on('play', play)
            .on('play failed', function (msg) {
                if (isPlaying) {
                    pause();
                }
                chat(msg);
            })
            .on('pause', pause)
            .on('change video', function (msg) {
                changeVideo(msg.src);
            })
            .on('getStatus', (id, answer) => {
                console.log("Server requested current status");
                answer({
                    "name": name,
                    "src": videoSrc,
                    "playing": isPlaying,
                    "time": player.currentTime(),
                    "iconId": userIcon,
                    "history": chatHistory,
                    "rate": player.playbackRate()
                });
            })
            .on('ratechange', (data) => {
                console.log('Changing playback rate', data);
                preventNextEvent();
                player.playbackRate(data.rate);
            });

        socket.emit('join', {
            name: name,
            iconId: userIcon
        }, (data) => {
            console.log("Recieved status from remote", data);
            if (data.src) {
                changeVideo(data.src, data.time);
            } else {
                getRandomTopMusicByCountry("JP").then(video => {
                    if (!videoSrc) {
                        console.log("Playing random yt-video", video);
                        changeVideo(video);
                        socket.emit('change video', {
                            "name": name,
                            "iconId": userIcon,
                            "src": video
                        });
                    }
                }).catch((e) => {
                    console.error("Failed to get random youtube video", e);
                });
            }
            data.history.forEach(item => {
                chat(item);
            });
            document.querySelector("#chat").style = "";
            document.querySelector("#player").style = "";
            document.querySelector("#controls").style = "";
            document.querySelector("#join-loader").remove();
            if (!data.playing && !isPlaying) {
                pause();
            }
        });
    } else {
        console.log("still waiting for userIcon, retry to join");
        setTimeout(join, 50);
    }
}

let socket = io();

window.onload = () => {
    document.querySelector("#nameModal input").value = defaultNameList[getRandomIndex(defaultNameList)];
    $("#nameModal").modal({
        keyboard: false,
        backdrop: 'static'
    });

    player = videojs('video-player', {
        controls: true,
        fill: true,
        autoplay: true,
        muted: true,
        youtube: {
            ytControls: 2
        }
    }, () => {
        player.on('timeupdate', (event) => {
            socket.emit('timeupdate', player.currentTime());
        });
        player.on('ratechange', (event) => {
            if (!prevent && !preventChangeVideoTimeout) {
                socket.emit('ratechange', {
                    "rate": player.playbackRate()
                });
            } else if (prevent) {
                removePreventEvent();
            }
            console.log('ratechange', event);
        });
        player.on('play', () => {
            console.log("played at ", player.currentTime());
            if (!prevent && !preventChangeVideoTimeout) {
                socket.emit('play', player.currentTime());
            } else if (prevent) {
                removePreventEvent();
            }
        });
        player.on('pause', () => {
            console.log("paused at ", player.currentTime());
            if (!prevent && !preventChangeVideoTimeout) {
                socket.emit('pause', player.currentTime());
            } else if (prevent) {
                removePreventEvent();
            }
        });
        player.on('error', playError);
        player.on(['waiting', 'pause'], function () {
            isPlaying = false;
        });

        player.on('playing', function () {
            isPlaying = true;
        });

        playerLoaded = true;
        console.log("Video-player is ready");
    });

    gapi.load("client", function () {
        gapi.client.init({
            apiKey: "AIzaSyDU6J3cOuf2HecO99nguAXl41cd4hxYJUs"
        });
        return gapi.client.load(
            "https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest"
        ).then(
            () => console.log("GAPI client loaded for API"),
            err => console.error("Error loading GAPI client for API", err)
        );
    });
}