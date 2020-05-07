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
