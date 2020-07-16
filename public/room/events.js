function updateStatus(data) {
    console.debug("status-update recieved", data);
    if (data.users.length === 1 && data.src === "") {
        console.log("First user, fetching random video");
        getRandomTopMusicByCountry("JP").then(video => {
            console.log("Playing random yt-video", video);
            changeVideo(video);
            socket.emit('change video', video);
        }).catch((e) => {
            console.error("Failed to get random youtube video", e);
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
}


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

let playerReady = false, countryCodes;
(function () {
    const player = new Plyr('#video-player', {
        muted: true,
        controls: [
            'play-large', // The large play button in the center
            'play', // Play/pause playback
            'progress', // The progress bar and scrubber for playback and buffering
            'current-time', // The current time of playback
            'mute', // Toggle mute
            'volume', // Volume control
            'captions', // Toggle captions
            'settings', // Settings menu
            'pip', // Picture-in-picture (currently Safari only)
            'airplay', // Airplay (currently Safari only)
            'download', // Show a download button with a link to either the current source or a custom URL you specify in your options
            'fullscreen', // Toggle fullscreen
        ]
    });
    window.player = player;
    player.once('ready', event => {
        if (!player.muted) {
            player.muted = true;
        }
        console.log("Player ready", event.detail.plyr);
        playerReady = true;
        document.querySelector("div.plyr").addEventListener("mousedown", clickedEvent, true);
        document.querySelector("div.plyr").addEventListener("touchstart", clickedEvent, true);
        document.querySelector("div.plyr").addEventListener("mouseup", clickedEndedEvent, true);
        document.querySelector("div.plyr").addEventListener("touchend", clickedEndedEvent, true);
    });
    player.on('ready', event => {
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
    player.on('play', () => {
        console.log("event played at ", player.currentTime);
        if (clicked) {
            removeClickedEvent();
            console.log("Emitting event played at ", player.currentTime);
            socket.emit('play', player.currentTime);
        }
    });
    player.on('pause', () => {
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
    player.on('seeking', (event) => {
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
    player.on('ratechange', () => {
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
        .on('status', updateStatus)
        .on('userStatus', (users) => {
            room.users = users;
            updateUserTab();
        })
        .on('getStatus', (answer) => {
            console.log("Server requested current status");
            answer(room);
        });

    fetch("/iso-3166.json").then(data => {
        return data.json();
    }).then(data => {
        countryCodes = data;
        updateCountryCode("JP");
    });
    document.querySelector("#controls").style = "";
    document.querySelector("#join-loader").remove();
})();
