function getRoomId() {
    let tmp = window.location.href.match(/[\d\w]+/g);
    return tmp[tmp.length - 1];
}

function getRandomIndex(array) {
    return Math.round(Math.random() * (array.length - 1));
}

// well i doubt ftp, tel or urn are working video/audio feeds
function isValidHttpUrl(string) {
    let url;

    try {
        url = new URL(string);
    } catch (_) {
        return false;
    }

    return url.protocol === "http:" || url.protocol === "https:";
}

let roomId = getRoomId();
document.title = "Raum " + roomId;
let userIcons;
let userIcon;
fetch("../icons.json").then(data => {
    return data.json();
}).then(data => {
    userIcons = data;
    let tmp = document.querySelector('.input-group-prepend .dropdown-menu');
    tmp.innerHTML = "";
    userIcon = getRandomIndex(userIcons);
    userIcons.forEach((item, index) => {
        if (index === userIcon) {
            tmp.innerHTML += '<button class="btn btn-success m-1" type="button">' + icon(index) + '</button>';
        } else {
            tmp.innerHTML += '<button class="btn btn-outline-primary m-1" type="button" onclick="updateUserIcon(' + index + ')">' + icon(index) + '</button>';
        }
    });
    document.querySelector("#nameModal div.d-table>button").innerHTML = icon(userIcon);
    updateUserIcon(userIcon);
}).catch(e => {
    console.log(e);
    alert("Raum konnte nicht angefordert werden:\n" + e);
});

// http://stackoverflow.com/questions/2450954/how-to-randomize-shuffle-a-javascript-array
function shuffle(array) {
    let currentIndex = array.length, temporaryValue, randomIndex;
    while (0 !== currentIndex) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex -= 1;

        temporaryValue = array[currentIndex];
        array[currentIndex] = array[randomIndex];
        array[randomIndex] = temporaryValue;
    }
    return array;
}

let name;
// why shuffle? because math.random() is useless
let defaultNameList = shuffle([
    "Ein wildes Tier",
    "Rabauken Hamster",
    "Ein, äh.. Dingens-Bums",
    "Fetter fetter Adler",
    "Mit Eleganz in den Keller",
    "Ein Tier wie jedes Andere",
    "Das etwas Andere",
    "Mein Name hat kein Gewicht",
    "Der Mäuse-Druide",
    "Eine Trollelfe",
    "Die zarte Orc-Ballerina",
    "Eine fliegende Maus",
    "Ein fliegendes Zebra",
    "Eine drehende Ananas",
    "Das majestätische Stück Torte",
    "Ein farbenfrohes Transparent",
    "Die fehlende Lösung",
    "Das samte Sandpapier",
    "Der verbrannte Kuchen",
    "Das unsichtbare Unicorn",
    "Zu Ihren Diensten",
    "Etwas cooles Dingens",
    "Das vergessene Unicorn",
    "Das Muffin in der Ecke",
    "Ein unsichtbares Prachtstück"
]);

function updateUserIcon(id) {
    document.querySelector('#invite-link').innerHTML = '<input type="text" readonly class="form-control-plaintext" value="' + window.location.href + '">';
    console.log("UpdateUserIcon", id);
    document.querySelector('.input-group-prepend>button>img').src = "../icons/" + userIcons[id];
    document.querySelectorAll('.input-group-prepend .dropdown-menu button').forEach((item, index) => {
        if (userIcon !== id) {
            if (index === userIcon) {
                if (item.classList.contains("btn-success")) {
                    item.classList.remove("btn-success")
                    item.classList.add("btn-outline-primary");
                    item.setAttribute("onclick", "updateUserIcon(" + index + ")");
                }
            } else if (index === id) {
                if (item.classList.contains("btn-outline-primary")) {
                    item.classList.remove("btn-outline-primary");
                    item.classList.add("btn-success");
                    item.setAttribute("onclick", "");
                }
            }
        }
    });
    userIcon = id;
}

function icon(index) {
    return '<img src="../icons/' + userIcons[index] + '" alt="..."/>';
}


// Chat
let chatHistory = [];
document.querySelector('#chat form').addEventListener("submit", (e) => {
    e.preventDefault(); // prevents page reloading
    let tmp = document.querySelector('#message');
    if (tmp.value !== "") {
        socket.emit('chat message', {
            "name": name,
            "iconId": userIcon,
            "message": tmp.value
        });
    }
    tmp.value = "";
    return false;
});
document.querySelector('form#controls').addEventListener("submit", (e) => {
    e.preventDefault(); // prevents page reloading
    let tmp = document.querySelector('form#controls input');
    console.log("Trying to change video to: ", tmp.value);
    if (tmp.value !== "" && isValidHttpUrl(tmp.value)) {
        socket.emit('change video', {
            "name": name,
            "iconId": userIcon,
            "src": tmp.value
        });
        changeVideo(tmp.value);
    }
    tmp.value = "";
    return false;
});
document.querySelector('form#controls button#random-button').addEventListener("click", (e) => {
    e.preventDefault(); // prevents page reloading
    console.log("Trying to switch to random video");
    getRandomTopMusicByCountry("JP").then(data => {
        socket.emit('change video', {
            "src": data
        });
        changeVideo(data);
    });
    return false;
});

function htmlEncode(input) {
    let el = document.createElement("div");
    el.innerText = el.textContent = input;
    return el.innerHTML;
}

function chat(msg) {
    console.log("New Chat-message", msg);
    chatHistory.push(msg);
    let tmp = document.querySelector('#messages');
    tmp.innerHTML += `
        <li class="media bg-` + msg.type + ` mb-2 rounded">
            <div class="rounded bg-light p-1 m-1 mr-0">
                ` + icon(msg.iconId) + `
            </div>
            <div class="media-body">
              <h5 class="mt-0 mb-1"><small class="text-muted">` + msg.name + `</small></h5>
              ` + htmlEncode(msg.message) + `
            </div>
        </li>
    `;
    tmp.scrollTop = tmp.scrollHeight;
}


document.querySelector('#nameModal form').addEventListener("submit", (e) => {
    e.preventDefault(); // prevents page reloading
    let tmp = document.querySelector('#nameModal input').value;
    if (tmp !== "") {
        name = tmp;
        join();
        $("#nameModal").modal('hide');
    } else {
        alert("Sei doch etwas kreativer....");
    }
    return false;
});