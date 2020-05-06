let videoSrc, player, playerLoaded = false, isPlaying = false;

function isYoutube(url) {
    return url && url.match(/^https?:\/\/((w{3}.)?youtube.com\/watch\?v=|youtu.be\/)[\D\w]+/);
}

let preventTimer, prevent = false;

function preventNextEvent() {
    prevent = true;
    preventTimer = setTimeout(() => removePreventEvent(), 40);
}

function removePreventEvent() {
    if (preventTimer) {
        clearTimeout(preventTimer);
    }
    prevent = false;
}

function isAtTime(time) {
    let t = player.currentTime();
    return t + 2 > time && time + 2 > t;
}

function playError(e) {
    removePreventEvent();
    socket.emit('play failed', {
        "type": 'playbackError',
        "roomId": roomId,
        "name": name,
        "iconId": userIcon,
        "error": e.message
    });
}

function play(time = -1) {
    console.log("Play-Command at ", time);
    if (time !== -1 && !isAtTime(time)) {
        console.log("Not at time, seeking");
        seek(time);
    }
    if (isPlaying) {
        console.log("Already playing");
        return;
    }

    setTimeout(() => {
        preventNextEvent();
        player.play()
    }, 20);
}

function pause(time = -1) {
    console.log("Pause-Command at ", time);
    if (time !== -1 && !isAtTime(time)) {
        console.log("Not at time, seeking");
        seek(time);
    }
    if (!isPlaying) {
        console.log("Already paused");
        return;
    }

    setTimeout(() => {
        preventNextEvent();
        player.pause()
    }, 20);
}

function seek(time) {
    console.log("Seek-Command to ", time);
    player.currentTime(time);
}

let changeVideoTimer, preventChangeVideoTimeout = false;

function changeVideoTimeout() {
    preventChangeVideoTimeout = true;
    changeVideoTimer = setTimeout(removeChangeVideoTimeout, 600);
}

function removeChangeVideoTimeout() {
    if (changeVideoTimer) {
        clearTimeout(changeVideoTimer);
    }
    preventChangeVideoTimeout = false;
}

function changeVideo(url, time = 0) {
    console.log("Change video to " + url + " at time: ", time);
    if (url === videoSrc && isAtTime(time)) {
        console.log("Already correct video and time");
        return;
    }

    if (playerLoaded) {
        if (url === videoSrc) {
            seek(time);
            return;
        }

        changeVideoTimeout();
        if (isYoutube(url)) {
            if (!isYoutube(videoSrc)) {
                player.controlBar.hide();
                //player.bigPlayButton.hide();
            }
            player.src({type: "video/youtube", src: url});
        } else {
            if (isYoutube(videoSrc)) {
                player.controlBar.show();
                //player.bigPlayButton.show();
            }
            player.src({src: url});
        }
        videoSrc = url;
    } else {
        console.log("Player is not ready, retry");
        setTimeout(this(url, time), 10);
    }
}


async function getTopMusicListByCountry(countryCode) {
    return await gapi.client.youtube.videos.list({
        "part": "id",
        "chart": "mostPopular",
        "maxResults": 10,
        "regionCode": countryCode,
        "videoCategoryId": "10"
    }).then(
        res => res.result.items.map(item => item.id),
        err => {
            console.error("Error fetching youtube...", err);
            return [];
        }
    );
}

async function getRandomTopMusicByCountry(countryCode) {
    const result = await getTopMusicListByCountry(countryCode);
    return "https://youtu.be/" + result[getRandomIndex(result)];
}


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
                alert("Wiedergabe bei '" + msg.name + "' fehlgeschlagen. Es kam zu folgendem Fehler:\n" + msg.error);
            })
            .on('pause', pause)
            .on('change video', function (msg) {
                changeVideo(msg.src);
                chat(msg);
            })
            .on('join', function (msg) {
                socket.emit('status', {
                    "src": videoSrc,
                    "time": player.currentTime(),
                    "history": chatHistory
                });
                chat(msg);
            })
            .on('getStatus', function (id, answer) {
                console.log("Server requested current status");
                answer({
                    "name": name,
                    "src": videoSrc,
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
            })
            .on('quit', function (msg) {
                console.log("User disconnected", msg);
                // TODO: userlist
                chat(msg);
            });
        socket.emit('join', {
            "type": 'join',
            "name": name,
            "iconId": userIcon
        });

        setTimeout(() => {
            if (gotStatus) {
                return;
            }
            getRandomTopMusicByCountry("JP").then(video => {
                if (!gotStatus) {
                    console.log("Fallback to default");
                    gotStatus = true;
                    socket.removeAllListeners('status');
                    document.querySelector("#chat").style = "";
                    document.querySelector("#player").style = "";
                    document.querySelector("#join-loader").remove();
                    chat({
                        "type": 'join',
                        "iconId": userIcon,
                        "name": name
                    });
                    changeVideo(video);
                }
            }).catch((e) => {
                console.error("Failed to get random youtube video", e);
            });
        }, 2000);
    } else {
        console.log("still waiting for userIcon, retry to join");
        setTimeout(join, 50);
    }
}

let socket = io(), gotStatus = false;

window.onload = () => {
    document.querySelector("#nameModal input").value = defaultNameList[getRandomIndex(defaultNameList)];
    $("#nameModal").modal({
        keyboard: false,
        backdrop: 'static'
    });

    socket.once('status', (msg) => {
        console.log("Recieved status from remote", msg);
        msg.history.forEach(item => {
            chat(item);
        });
        changeVideo(msg.src, msg.time);

        if (!gotStatus) {
            gotStatus = true;
            document.querySelector("#player").style.display = "block";
            document.querySelector("#chat").style.display = "block";
            document.querySelector("#join-loader").remove();
            chat({
                "type": 'join',
                "iconId": userIcon,
                "name": name
            });
        }
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
            socket.emit('timeupdate', {
                "time": player.currentTime()
            });
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
                socket.emit('play', {
                    "time": player.currentTime()
                });
            } else if (prevent) {
                removePreventEvent();
            }
        });
        player.on('pause', () => {
            console.log("paused at ", player.currentTime());
            if (!prevent && !preventChangeVideoTimeout) {
                socket.emit('pause', {
                    "time": player.currentTime()
                });
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