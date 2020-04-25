function isYoutube(url) {
    return url.match(/^https?:\/\/((w{3}.)?youtube.com\/watch\?v=|youtu.be\/)[\D\w]+/);
}

function getYoutubeID(url) {
    if (url.match(/(\?|&)v=([^&#]+)/)) {
        return url.match(/(\?|&)v=([^&#]+)/).pop();
    } else if (url.match(/(\.be\/)+([^\/]+)/)) {
        return url.match(/(\.be\/)+([^\/]+)/).pop();
    } else if (url.match(/(\embed\/)+([^\/]+)/)) {
        return url.match(/(\embed\/)+([^\/]+)/).pop().replace('?rel=0', '');
    } else {
        return url.replace(/^https?:\/\/((w{3}.)?youtube.com\/watch\?v=|youtu.be\/)/, "");
    }
}

let videoSrc = "";
let player = null;

function isAtTime(time) {
    let t = getTime();
    return t + 2 > time && time + 2 > t;
}

let preventTimer;

function preventNextEvent() {
    prevent = true;
    preventTimer = setTimeout(() => removePreventEvent(), 100);
}

function removePreventEvent() {
    if (preventTimer) {
        clearTimeout(preventTimer);
    }
    prevent = false;
}

function playError(event) {
    if (isYoutube(videoSrc)) {

    } else {
        removePreventEvent();
        socket.emit('play failed', {
            type: 'playbackError',
            roomId: roomId,
            name: name,
            iconId: userIcon,
            error: e.message
        });
    }
}

function play(time = -1) {
    console.log("Play-Command at ", time);
    if (time !== -1 && !isAtTime(time)) {
        console.log("Not at time, seeking");
        seek(time);
    }
    if (isPlaying()) {
        console.log("Already playing");
        return;
    }
    setTimeout(() => {
        if (isYoutube(videoSrc)) {
            if (youtubeStarted) {
                player.playVideo();
            } else {
                console.log("YT-player not initialised");
            }
        } else {
            preventNextEvent();
            $('#video video')[0].play().catch(e => playError(e));
        }
    }, 20);
}

function isPlaying() {
    if (isYoutube(videoSrc)) {
        return player.getPlayerState() === YT.PlayerState.PLAYING;
    } else {
        return !$('#video video')[0].paused;
    }
}

function pause(time = -1) {
    console.log("Pause-Command at ", time);
    if (time !== -1 && !isAtTime(time)) {
        console.log("Not at time, seeking");
        seek(time);
    }
    if (isPaused()) {
        console.log("Already paused");
        return;
    }

    setTimeout(() => {
        if (isYoutube(videoSrc)) {
            if (youtubeStarted) {
                player.pauseVideo();
            } else {
                console.log("YT-player not initialised");
            }
        } else {
            preventNextEvent();
            $('#video video')[0].pause();
        }
    }, 20);
}

function isPaused() {
    if (isYoutube(videoSrc)) {
        return player.getPlayerState() === YT.PlayerState.PAUSED;
    } else {
        return $('#video video')[0].paused;
    }
}

function seek(time) {
    console.log("Seek-Command to ", time);
    if (isYoutube(videoSrc)) {
        if (youtubeStarted) {
            player.seekTo(time, true);
        } else {
            console.log("YT-player not initialised");
        }
    } else {
        preventNextEvent();
        playVideo(videoSrc, time);
    }
}

function getTime() {
    if (isYoutube(videoSrc)) {
        return player.getCurrentTime();
    } else {
        return $('#video video')[0].currentTime;
    }
}

function playVideo(url, time = 0) {
    console.log("Change video to " + url + " at time: ", time);
    if (url === videoSrc && isAtTime(time)) {
        console.log("Already correct video and time");
        return;
    }
    pause();
    setTimeout(() => {
        if (isYoutube(url)) {
            $("#video").hide();
            $("#yt-create").show();
            if (youtubeStarted) {
                try {
                    player.cueVideoById({
                        'videoId': getYoutubeID(url),
                        'startSeconds': time
                    });
                } catch (e) {
                    alert(e);
                }
            } else {
                setTimeout(() => playVideo(url, time), 200);
                return;
            }
        } else {
            $("#yt-create").hide();
            $("#video").show();
            preventNextEvent();
            $('#video video').attr('src', url + "#t=" + time);
        }
        videoSrc = url;
    }, 20);
}

let youtubeStarted = false;

function onYouTubeIframeAPIReady() {
    console.log("YT-API callback");
    player = new YT.Player('yt-create', {
        videoId: getYoutubeID(videoSrc),
        events: {
            'onReady': () => {
                console.log("Player is ready");
                youtubeStarted = true;
            },
            'onError': playError,
            'onStateChange': stateChangeListener
        }
    });
    console.log("player created");
}

function stateChangeListener(event) {
    console.log("YT-Statechange", event);
    switch (event.data) {
        case YT.PlayerState.PLAYING:
            console.log("Started to play at ", getTime());
            socket.emit('play', {
                "roomId": roomId,
                "time": getTime()
            });
            break;
        case YT.PlayerState.PAUSED:
            console.log("Paused at ", getTime());
            socket.emit('pause', {
                "roomId": roomId,
                "time": getTime()
            })
            break;
        default:
            break;
    }
}

// 2. This code loads the IFrame Player API code asynchronously.
let tag = document.createElement('script');

tag.src = "https://www.youtube.com/iframe_api";
let firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

let prevent = false;
let socket = io();

let gotStatus = false;

function join() {
    if (userIcon) {
        console.log("Trying to join Room", roomId);
        socket
            .on('chat message', chat)
            .on('play', play)
            .on('play failed', function (msg) {
                if (!isPaused()) {
                    pause();
                }
                chat(msg);
                alert("Wiedergabe bei '" + msg.name + "' fehlgeschlagen. Es kam zu folgendem Fehler:\n" + msg.error);
            })
            .on('pause', pause)
            .on('seek', function (time) {
                if (!isAtTime(time)) {
                    seek(time);
                }
            })
            .on('change video', function (msg) {
                playVideo(msg.src);
                chat(msg);
            })
            .on('join', function (msg) {
                if (!isPaused()) {
                    pause();
                }
                socket.emit('status', {
                    roomId: roomId,
                    src: videoSrc,
                    time: getTime(),
                    history: chatHistory
                });
                chat(msg);
            });
        socket.emit('join', {
            type: 'join',
            name: name,
            iconId: userIcon,
            roomId: roomId
        });

        setTimeout(() => {
            fetch("../default.json").then((result) => {
                return result.json();
            }).then((data) => {
                if (!gotStatus) {
                    console.log("Fallback to default");
                    gotStatus = true;
                    socket.removeAllListeners('status');
                    $("#chat").show();
                    $("#join-loader").remove();
                    chat({
                        type: 'join',
                        iconId: userIcon,
                        name: name
                    });
                    playVideo(data.video);
                }
            }).catch((e) => {
                console.log("Failed to get default settings");
            });
        }, 2000);
    } else {
        console.log("still waiting for userIcon, retry to join in 100");
        setTimeout(join, 100);
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
    let tmp = $('#messages');
    let text = `
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
    tmp.append($(text));
    tmp.scrollTop(tmp[0].scrollHeight);
}

$(document).ready(function () {
    socket.once('status', function (msg) {
        console.log("Recieved status from remote", msg);
        msg.history.forEach(item => {
            chat(item);
        });
        playVideo(msg.src, msg.time);

        if (!gotStatus) {
            gotStatus = true;
            $("#chat").show();
            $("#join-loader").remove();
            chat({
                type: 'join',
                iconId: userIcon,
                name: name
            });
        }
    });

    $('#chat form').submit(function (e) {
        e.preventDefault(); // prevents page reloading
        let tmp = $('#message');
        if (tmp.val() !== "") {
            socket.emit('chat message', {
                name: name,
                iconId: userIcon,
                roomId: roomId,
                message: tmp.val()
            });
        }
        tmp.val('');
        return false;
    });

    $('#nameModal form').submit(function (e) {
        e.preventDefault(); // prevents page reloading
        let tmp = $('#nameModal input').val();
        if (tmp !== "") {
            name = tmp;
            join();
            $("#nameModal").modal('hide');
        } else {
            alert("Sei doch etwas kreativer....");
        }
        return false;
    });

    $('#video video').on('pause', function (e) {
        console.log("paused at ", e.target.currentTime);
        if (!prevent) {
            socket.emit('pause', {
                "roomId": roomId,
                "time": e.target.currentTime
            });
        } else {
            removePreventEvent();
        }
    }).on('play', function (e) {
        console.log("played at ", e.target.currentTime);
        if (!prevent) {
            socket.emit('play', {
                "roomId": roomId,
                "time": e.target.currentTime
            });
        } else {
            removePreventEvent();
        }
    }).on('seeked', function (e) {
        console.log("seeked to ", e.target.currentTime);
        if (!prevent) {
            socket.emit('seek', {
                "roomId": roomId,
                "time": e.target.currentTime
            });
        } else {
            removePreventEvent();
        }
    });

    $("#yt-create").hide();
    $("#video").hide();
    $("#chat").hide();
    $("#nameModal input").val(defaultNameList[Math.round(Math.random() * (defaultNameList.length - 1))]);
    $("#nameModal").modal({
        keyboard: false,
        backdrop: 'static'
    });
});