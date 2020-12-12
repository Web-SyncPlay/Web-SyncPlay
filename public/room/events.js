function updateStatus(data) {
    if (playerReady && (gapiReady || gapiFailed)) {
        if (data.users.length === 1 && data.src === "") {
            console.log("First user, fetching random video");
            getRandomTopMusicByCountry("JP").then(function (video) {
                console.log("Playing random yt-video", video);
                changeVideo(video);
                socket.emit('change video', video);
            }).catch(function (e) {
                console.error("Failed to get random youtube video:", e);
            });
        } else {
            removeClickedEvent();
            if (room.playing !== data.playing || player.playing !== room.playing) {
                console.log("playing changed to ", data.playing);
                if (data.playing) {
                    play(data.lastSeek);
                    socket.emit('userUpdate', {
                        playing: true,
                        time: player.currentTime
                    });
                } else {
                    pause(data.lastSeek);
                    socket.emit('userUpdate', {
                        playing: false,
                        time: player.currentTime
                    });
                }
            }
            if (room.rate !== data.rate) {
                console.log("rate changed to ", data.rate);
                player.speed = data.rate;
            }
            if (room.src !== data.src && data.src !== "") {
                console.log("video changed to ", data.src);
                changeVideo(data.src);
            }
            if (room.lastSeek !== data.lastSeek) {
                console.log("last seek changed to ", data.lastSeek);
                if (!isAtTime(data.lastSeek)) {
                    seek(data.lastSeek);
                }
            }
        }
        room = data;
        updateUserTab();
    } else {
        console.log("Player or gapi not ready yet, waiting 100ms");
        setTimeout(() => updateStatus(data), 100);
    }
}

let gapiReady = false, gapiFailed = false;
gapi.load("client", function () {
    gapi.client.init({
        apiKey: "AIzaSyDU6J3cOuf2HecO99nguAXl41cd4hxYJUs"
    });
    return gapi.client.load(
        "https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest"
    ).then(
        function () {
            gapiReady = true;
            console.log("GAPI client loaded for API")
        },
        function (err) {
            gapiFailed = true;
            gapiReady = true;
            console.error("Error loading GAPI client for API", err);
            alert("Die YouTube-API konnte nicht geladen werden. Die Random-Funktion wird deaktiviert");
            document.getElementById("randomGroup").remove();
        }
    );
});

let playerReady = false, countryCodes;
(function () {
    const player = new Plyr('#video-player', {
        muted: true,
        debug: true,
        keyboard: {
          focused: true,
          global: true
        }
    });
    window.player = player;
    player.once('ready', function () {
        if (!player.muted) {
            player.muted = true;
        }
        playerReady = true;
        document.querySelector("div.plyr").addEventListener("mousedown", clickedEvent, true);
        document.querySelector("div.plyr").addEventListener("touchstart", clickedEvent, true);
        document.querySelector("div.plyr").addEventListener("mouseup", clickedEndedEvent, true);
        document.querySelector("div.plyr").addEventListener("touchend", clickedEndedEvent, true);
    });
    player.on('ready', function () {
        if (player.source) {
            if (room.playing !== player.playing) {
                let time = firstTimeInteracted ? room.users[0].time : room.lastSeek;
                if (room.playing) {
                    play(time);
                    socket.emit('userUpdate', {
                        playing: true,
                        time: time
                    });
                } else {
                    pause(time);
                    socket.emit('userUpdate', {
                        playing: false,
                        time: time
                    });
                }
            }
        }
    });
    player.on('play', function () {
        console.log("event played at ", player.currentTime);
        if (clicked) {
            removeClickedEvent();
            console.log("Emitting event played at ", player.currentTime);
            socket.emit('play', player.currentTime);
        }
    });
    player.on('pause', function () {
        console.log("event paused at ", player.currentTime);
        if (clicked) {
            removeClickedEvent();
            window.pausedForSeek = true;
            setTimeout(() => {
                if (window.pausedForSeek) {
                    console.log("Emitting event paused at ", player.currentTime);
                    socket.emit('pause', player.currentTime);
                    window.pausedForSeek = false;
                }
            }, 20);
        }
    });
    player.on('seeking', function () {
        console.log("event seeking to ", player.currentTime);
        if (clicked || window.pausedForSeek) {
            if (window.pausedForSeek) {
                window.pausedForSeek = false;
            }
            if (clicked) {
                removeClickedEvent();
            }
            seekDrag = true;
        }
    });
    player.on('ratechange', function () {
        console.log('event ratechange', player.speed);
        if (clicked) {
            removeClickedEvent();
            console.log("Emitting event ratechange", player.speed);
            socket.emit('ratechange', player.speed);
        }
    });
    player.on('timeupdate', () => socket.emit('timeupdate', player.currentTime));
    player.on('error', playError);


    const socket = io();
    window.socket = socket;
    socket
        .on('status', function (data) {
          console.debug("status-update recieved", data);
          updateStatus(data);
        })
        .on('userStatus', function (users) {
            room.users = users;
            updateUserTab();
        })
        .on('getStatus', function (answer) {
            console.log("Server requested current status");
            answer(room);
        });

    fetch("/iso-3166.json").then(function (data) {
        return data.json();
    }).then(function (data) {
        countryCodes = data;
        updateCountryCode("JP");
    });
    document.querySelector("#controls").style = "";
    document.querySelector("#join-loader").remove();
})();