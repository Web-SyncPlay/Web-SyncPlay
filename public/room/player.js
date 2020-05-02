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
                player.bigPlayButton.hide();
            }
            player.src({type: "video/youtube", src: url});
        } else {
            if (isYoutube(videoSrc)) {
                player.controlBar.show();
                player.bigPlayButton.show();
            }
            player.src({src: url});
        }
        videoSrc = url;
    } else {
        console.log("Player is not ready, retry");
        setTimeout(this(url, time), 10);
    }
}

let chatHistory = [];

function chat(msg) {
    console.log("New Chat-message", msg);
    chatHistory.push(msg);
    switch (msg.type) {
        case 'join':
            if (!msg.color) {
                msg.color = "bg-warning";
            }
            if (!msg.message) {
                msg.message = "Trat dem Raum bei";
            }
            break;
        case "playbackError":
            if (!msg.color) {
                msg.color = "bg-danger";
            }
            if (!msg.message) {
                msg.message = "Failed to play video: " + msg.error;
            }
            break;
        case "changeVideo":
            if (!msg.color) {
                msg.color = "bg-success";
            }
            msg.message = 'Played: <a href="' + msg.src + '" target="_blank">' + msg.src + '</a>';
            break;
        default:
            if (!msg.color) {
                msg.color = "bg-light";
            }
            break;
    }
    let tmp = document.querySelector('#messages');
    tmp.innerHTML += `
        <li class="media ` + msg.color + ` mb-2 rounded">
            <div class="rounded bg-light p-1 m-1 mr-0">
                ` + icon(msg.iconId) + `
            </div>
            <div class="media-body">
              <h5 class="mt-0 mb-1"><small class="text-muted">` + msg.name + `</small></h5>
              ` + msg.message + `
            </div>
        </li>
    `;
    tmp.scrollTop = tmp.scrollHeight;
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
                if (isPlaying) {
                    pause();
                }
                socket.emit('status', {
                    "roomId": roomId,
                    "src": videoSrc,
                    "time": player.currentTime(),
                    "history": chatHistory
                });
                chat(msg);
            });
        socket.emit('join', {
            "type": 'join',
            "name": name,
            "iconId": userIcon,
            "roomId": roomId
        });

        setTimeout(() => {
            fetch("../default.json").then((result) => {
                return result.json();
            }).then((data) => {
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
                    changeVideo(data.video);
                }
            }).catch((e) => {
                console.log("Failed to get default settings", e);
            });
        }, 2000);
    } else {
        console.log("still waiting for userIcon, retry to join");
        setTimeout(join, 50);
    }
}

let socket = io(), gotStatus = false;

window.onload = () => {
    document.querySelector("#nameModal input").value = defaultNameList[Math.round(Math.random() * (defaultNameList.length - 1))];
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
        youtube: {
            ytControls: 2
        }
    }, () => {
        /*
        player.on('timeupdate', (event) => {
            console.log('timeupdate', event);
        });
        */
        player.on('ratechange', (event) => {
            console.log('ratechange', event);
        });
        player.on('play', () => {
            console.log("played at ", player.currentTime());
            if (!prevent && !preventChangeVideoTimeout) {
                socket.emit('play', {
                    "roomId": roomId,
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
                    "roomId": roomId,
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
}