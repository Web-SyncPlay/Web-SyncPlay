import {createServer} from "http";
import {Server} from "socket.io";
import express from "express";
import {iso31661} from "iso-3166";
import fs from "fs";
import cors from "cors";

const PORT = 8081;
const app = express();
app.use(cors());
const http = createServer(app);
const io = new Server(http);


const getRandomItem = (array) => {
    return array[Math.round(Math.random() * (array.length - 1))];
}
let defaultNameList = [
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
    "Das karierte Zebra",
    "Die fehlende Lösung",
    "Das samte Sandpapier",
    "Der verbrannte Kuchen",
    "Das unsichtbare Unicorn",
    "Zu Ihren Diensten",
    "Etwas cooles Dingens",
    "Das vergessene Unicorn",
    "Das Muffin in der Ecke",
    "Ein unsichtbares Prachtstück"
];

// Icons
let userIcons = [];
fs.readdir('icons', (err, files) => {
    userIcons = files;
});

app.get('/icons.json', (req, res) => {
    res.json(userIcons);
});
app.get('/iso-3166.json', (req, res) => {
    res.json(iso31661);
});
app.get('/', (req, res) => {
    res.sendFile('/app/public/index.html');
});

const generateId = (length = 4) => {
    let result = "", chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.round(Math.random() * (chars.length - 1)))
    }
    return result;
}
// Rooms
app.get('/room/generate', (req, res) => {
    let id;
    do {
        id = generateId();
    } while (rooms.some(room => room.id === id));
    res.json({id: id});
    // res.status(307).redirect(id);
});

// Socket-Communication
let rooms = [];
io.on('connection', (socket) => {
    // room-joining
    let tmp = socket.handshake.headers.referer.match(/[\d\w]+/g);
    let room = tmp[tmp.length - 1];
    const log = (...item) => {
        let d = new Date();
        let time = d.getFullYear() + "." + d.getMonth() + "." + d.getDay() + " " + d.getHours() + ":" + d.getMinutes() + ":" + d.getSeconds();
        console.log(time, "Room", room + ", ", ...item);
        fs.appendFile('log.txt', time + " Room " + room + ", " + item.join() + "\n", function (err) {
            if (err) throw err;
        });
    }
    socket.join(room);

    const getRoom = (id = room) => {
        for (let i = 0; i < rooms.length; i++) {
            if (rooms[i].id === id) {
                return rooms[i];
            }
        }
    };
    const getUserInfo = (id = socket.id) => {
        let tmp = getRoom();
        if (tmp) {
            for (let i = 0; i < tmp.users.length; i++) {
                if (tmp.users[i].id === id) {
                    return tmp.users[i];
                }
            }
        }
    };
    const updateRoom = (data) => {
        let tmp = getRoom();
        if (typeof data.src !== 'undefined' && tmp.src !== data.src) {
            log("Updated src ", tmp.src, " -> ", data.src);
            tmp.src = data.src;
        }
        if (typeof data.rate !== 'undefined' && tmp.rate !== data.rate) {
            log("Updated rate ", tmp.rate, " -> ", data.rate);
            tmp.rate = data.rate;
        }
        if (typeof data.playing !== 'undefined' && tmp.playing !== data.playing) {
            log("Updated playing ", tmp.playing, " -> ", data.playing);
            tmp.playing = data.playing;
        }
        if (typeof data.lastSeek !== 'undefined' && tmp.lastSeek !== data.lastSeek) {
            log("Updated lastSeek ", tmp.lastSeek, " -> ", data.lastSeek);
            tmp.lastSeek = data.lastSeek;
        }

        emitStatus();
    };
    const emitStatus = () => {
        io.to(room).emit('status', getRoom());
    };
    const emitUserStatus = () => {
        io.to(room).emit('userStatus', getRoom().users);
    }

    if (!getRoom()) {
        log('creating new room');
        rooms.push({
            id: room,
            users: [],
            playing: false,
            rate: 1,
            lastSeek: 0,
            src: "",
        });
    }
    let name = getRandomItem(defaultNameList), icon = getRandomItem(userIcons);
    while (getRoom().users.some(user => user.name === name)) {
        name = getRandomItem(defaultNameList);
    }
    while (getRoom().users.some(user => user.icon === icon)) {
        icon = getRandomItem(userIcons);
    }
    getRoom().users.push({
        id: socket.id,
        name: name,
        icon: icon,
        time: 0,
        playing: false,
        error: ""
    });
    log('user ' + socket.id + ' joined');
    log(name, icon);

    if (getRoom().src === "" && getRoom().users.length === 1) {
        log("Room seems new, requesting data from ", socket.id);
        socket.emit('getStatus', (data) => {
            log("data came from ", socket.id);
            updateRoom(data);
        });
    } else {
        // TODO: Zeiten abfragen von den Usern
        emitStatus();
    }

    socket.on('disconnect', () => {
        log('user ' + socket.id + ' disconnected');

        let tmp = getRoom();
        if (tmp.users.length >= 1) {
            tmp.users = tmp.users.filter(item => {
                return item.id !== socket.id;
            });
            log(tmp.users.length + ' users left');
            emitStatus();
        } else {
            rooms = rooms.filter(item => item.id !== room);
            log('no users left, purging room');
        }
    });
    socket.on('userUpdate', (data) => {
        let user = getUserInfo();
        if (typeof data.time !== 'undefined' && user.time !== data.time) {
            user.time = data.time;
        }
        if (typeof data.playing !== 'undefined' && user.playing !== data.playing) {
            user.playing = data.playing;
        }
        emitUserStatus();
    });
    socket.on('error', (msg) => {
        log("User ", socket.id, " has error ", msg);
        getUserInfo().error = "Wiedergabe fehlgeschlagen: " + msg;
        getUserInfo().playing = false;
        updateRoom({
            playing: false
        });
    });
    socket.on('error solved', () => {
        log("User ", socket.id, " solved error");
        getUserInfo().error = "";
        emitStatus();
    });
    socket.on('change video', (src) => {
        log("User ", socket.id, " changed video ", src);
        updateRoom({
            src: src,
            speed: 1,
            playing: true,
            lastSeek: 0
        });
    });
    socket.on('timeupdate', (time) => {
        getUserInfo().time = time;
        emitUserStatus();
    });
    socket.on('play', (time) => {
        log("User ", socket.id, " played at ", time);
        getUserInfo().time = time;
        getUserInfo().playing = true;
        updateRoom({
            playing: true,
            lastSeek: time
        });
    });
    socket.on('pause', (time) => {
        log("User ", socket.id, " paused at ", time);
        getUserInfo().time = time;
        getUserInfo().playing = false;
        updateRoom({
            playing: false,
            lastSeek: time
        });
    });
    socket.on('seeking', (time) => {
        log("User ", socket.id, " seeking to ", time);
        getUserInfo().time = time;
        updateRoom({
            lastSeek: time
        });
    });
    socket.on('ratechange', (speed) => {
        log("User ", socket.id, " changed rate ", speed);
        updateRoom({
            speed: speed
        });
    });

});

// Fallback
app.get("/*", (req, res) => {
    // sends file if it exists in /public
    if (fs.existsSync('/app/public' + req.url) && fs.lstatSync('/app/public' + req.url).isFile()) {
        res.sendFile('/app/public' + req.url);
    } else {
        res.status(404).end();
    }
})
http.listen(PORT, () => {
    console.log('listening on *:' + PORT);
});
