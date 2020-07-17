function getRoomId() {
    let tmp = window.location.href.match(/[\d\w]+/g);
    return tmp[tmp.length - 1];
}

function getRandomIndex(array) {
    return Math.round(Math.random() * (array.length - 1));
}

function isValidHttpUrl(string) {
    let url;

    try {
        url = new URL(string);
    } catch (_) {
        console.log("Given url is not valid!");
        return false;
    }
    console.log("Valid");
    return true;
}

let room = {
    id: "",
    users: [],
    playing: false,
    rate: 1,
    src: "",
    time: 0
};
room.id = getRoomId();
document.title = "Raum " + room.id;
document.querySelector("#invite-link").value = window.location.href;

function userPlayStatusHTML(user) {
    let s = Math.round(user.time + Number.EPSILON);
    let min = (s - s % 60) / 60;
    s = s % 60;
    return (user.playing ? "Spielt" : "Pausiert") + " bei " + min + ":" + (s < 10 ? "0" + s : s);
}

function updateUserTab() {
    let body = document.querySelector("#user-list");
    let removed = false;
    body.querySelectorAll(".media").forEach(function (item) {
        if (!room.users.some(function (user) {
            return "user-" + user.id === item.id;
        })) {
            item.remove();
            removed = true;
        }
    });
    let userCount = document.getElementById("user-count");
    if (userCount.innerHTML !== "" + room.users.length) {
        userCount.innerHTML = "" + room.users.length;
    }
    for (let i = 0; i < room.users.length; i++) {
        let user = document.getElementById("user-" + room.users[i].id);
        if (user) {
            if (removed && i === 0) {
                if (!user.querySelector(".media-body>img")) {
                    let crown = document.createElement("img");
                    crown.src = "https://img.icons8.com/ios-filled/24/000000/crown.png";
                    user.querySelector(".media-body").insertBefore(crown, user.querySelector(".media-body>small"));
                }
            }
            user.querySelector(".media-body>small").innerHTML = userPlayStatusHTML(room.users[i]);

            let icon = user.querySelector(".rounded>img");
            if (icon.getAttribute("data-icon") !== room.users[i].icon) {
                icon.src = "../icons/" + room.users[i].icon;
                icon.setAttribute("data-icon", room.users[i].icon);
            }

            let name = user.querySelector("h5");
            if (name.innerHTML !== room.users[i].name) {
                name.innerHTML = room.users[i].name;
            }
        } else {
            let media = `
        <div class="media p-2 mb-2 bg-` + (room.users[i].id === socket.id ? "warning text-dark" : (room.users[i].error !== "" ? "danger" : "dark")) + ` rounded" id="user-` + room.users[i].id + `">
            <div class="rounded bg-light mr-2">
                <img class="mr-1" src="../icons/` + room.users[i].icon + `" alt="icon" data-icon="` + room.users[i].icon + `">
            </div>
            <div class="media-body">
                <h5 class="mb-0">` + room.users[i].name + `</h5>
                ` + (i === 0 ? '<img src="https://img.icons8.com/ios-filled/24/000000/crown.png" alt="Ersteller"/>' : "") + `
                <small>
                    ` + userPlayStatusHTML(room.users[i]) + `
                </small>
            </div>
        </div>
            `;
            if (room.users[i].id === socket.id) {
                body.innerHTML = media + body.innerHTML;
            } else {
                body.innerHTML += media;
            }
        }
    }
}

function updateCountryCode(code) {
    let tmp = document.querySelector("#countryDropdown>div.dropdown-menu"), txt = "";
    document.getElementById("btnCountryDropdown").innerHTML = code;
    countryCodes.forEach(function (country) {
        if (country["alpha2"] !== code) {
            txt += `<a class="dropdown-item" onclick="updateCountryCode('` + country["alpha2"] + `')">[` + country["alpha2"] + `] ` + country["name"] + `</a>`;
        }
    });
    tmp.innerHTML = txt;
}

function copyLink() {
    const el = document.getElementById('invite-link');
    el.select();
    document.execCommand('copy');
}

// Chat
document.querySelector('form#controls').addEventListener("submit", function (e) {
    e.preventDefault(); // prevents page reloading
    let tmp = document.querySelector('form#controls input');
    console.log("Trying to change video to: ", tmp.value);
    if (tmp.value !== "" && isValidHttpUrl(tmp.value)) {
        socket.emit('change video', tmp.value);
        changeVideo(tmp.value);
    } else {
        console.log("video url has been rejected");
    }
    tmp.value = "";
    return false;
});
document.querySelector('form#controls button#random-button').addEventListener("click", function (e) {
    e.preventDefault(); // prevents page reloading
    console.log("Trying to switch to random video");
    getRandomTopMusicByCountry(document.getElementById("btnCountryDropdown").innerHTML).then(function (data) {
        socket.emit('change video', data);
        changeVideo(data);
    });
    return false;
});