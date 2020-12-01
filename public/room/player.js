function isYoutube(url) {
    return url && url.match(/^https?:\/\/((w{3}.)?youtube.com\/watch\?v=|youtu.be\/)[\D\w]+/);
}

let clickedTimer, clicked = false, seekDrag = false, firstTimeInteracted = true;

function removeClickedEvent() {
    if (clickedTimer) {
        clearTimeout(clickedTimer);
    }
    clicked = false;
}

function clickedEvent() {
    console.log("User-Interaction registered");
    clicked = true;
    if (firstTimeInteracted) {
        console.log("First-Time, disable mute");
        firstTimeInteracted = false;
        document.querySelector("#mute-info").remove();
        setTimeout(function () {
            if (player.muted) {
                player.muted = false;
            }
        }, 100);
    }
    clickedTimer = setTimeout(() => removeClickedEvent(), 200);
}

function clickedEndedEvent() {
    console.log("User-Interaction ended");
    if (seekDrag) {
        seekDrag = false;
        console.log("Emitting event seeking to ", player.currentTime);
        socket.emit('seeking', player.currentTime);
    }
}

function isAtTime(time) {
    return Math.abs(player.currentTime - time) < 2;
}

function playError(e) {
    removeClickedEvent();
    console.error("Playback failed due to:", e);
    socket.emit('play failed', e.message);
}

function play(time = -1) {
    console.log("Play-Command at ", time);
    if (time !== -1 && !isAtTime(time)) {
        console.log("Not at time, seeking");
        seek(time);
    }

    if (player.playing) {
        console.log("Already playing");
    } else {
        player.play();
    }
}

function pause(time = -1) {
    console.log("Pause-Command at ", time);
    if (time !== -1 && !isAtTime(time)) {
        console.log("Not at time, seeking");
        seek(time);
    }

    if (player.paused) {
        console.log("Already paused");
    } else {
        player.pause();
    }
}

function seek(time) {
    console.log("Seek-Command to ", time);
    player.currentTime = time;
}

function getFileExtension(url) {
    return url.slice((url.lastIndexOf(".") - 1 >>> 0) + 2);
}

function changeVideo(url) {
    console.log("Change video to " + url);
    if (playerReady) {
        let newSource;
        if (isYoutube(url)) {
            console.log("New vid is YT");
            newSource = {
                type: 'video',
                sources: [{
                    provider: "youtube",
                    src: url
                }]
            };
        } else {
            let extension = getFileExtension(url);
            console.log("new vid is not YT, extension: ", extension);
            newSource = {
                type: "video",
                sources: [{
                    src: url
                }]
            };
        }
        if (newSource === player.source) {
            console.log("Already correct video");
        } else {
            try {
                player.source = newSource;
            } catch(e) {
                console.error("Failed to change video to ", url, " due to:", e);
            }
        }
    } else {
        setTimeout(() => changeVideo(url), 50);
    }
}


async function getTopMusicListByCountry(countryCode) {
    console.log("GAPI is ready:", gapiReady);
    if (!gapiReady) {
        throw "gapi not yet ready";
    }
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
    try {
        const result = await getTopMusicListByCountry(countryCode);
        let url;
        do {
            url = "https://youtu.be/" + result[getRandomIndex(result)];
        } while(room.src === url);
        return url;
    } catch (e) {
        throw e;
    }
}