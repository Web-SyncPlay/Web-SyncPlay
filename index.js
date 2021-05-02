import {createServer} from "http";
import {Server} from "socket.io";
import express from "express";
import {iso31661} from "iso-3166";
import fs from "fs";
import cors from "cors";
import path from "path";

const PORT = 8081;
const app = express();
app.use(cors());
const http = createServer(app);
const io = new Server(http, {
    cors: {
        origin: "*"
    }
});
const ROOT = process.env.IS_DOCKER ? "/app" : path.resolve();

const getRandomItem = (array) => {
    return array[Math.round(Math.random() * (array.length - 1))];
};
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
fs.readdir("public/icons", (err, files) => {
    userIcons = files;
});

app.get("/icons.json", (req, res) => {
    res.json(userIcons);
});
app.get("/iso-3166.json", (req, res) => {
    res.json(iso31661);
});

const generateId = (length = 4) => {
    let result = "", chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.round(Math.random() * (chars.length - 1)));
    }
    return result;
}
// Rooms
app.get("/room/generate", (req, res) => {
    let id;
    do {
        id = generateId();
    } while (rooms.some((room) => room.id === id));
    res.json({id});
    // res.status(307).redirect(id);
});

// Socket-Communication
let rooms = [];
io.on("connection", (socket) => {
    // room-joining
    let room = socket.handshake.query.roomId;
    const log = (...item) => {
        let d = new Date();
        let time = "[" + d.toUTCString() + "] [" + room + "]: ";
        console.log(time, ...item);
        fs.appendFile("log.txt", time + item.join() + "\n", function (err) {
            if (err) {
                throw err;
            }
        });
    }
    socket.join(room);

    // ------------------------------------------------------------------------------
    // Room management
    // ------------------------------------------------------------------------------
    const getRoom = (id = room) => {
        return rooms.find((r) => r.id === id);
    };
    if (!getRoom()) {
        rooms.push({
            id: room,
            users: [],
            owner: socket.id,
            anarchy: true
        });
        log("room created");
    }
    const getUser = (id = socket.id) => {
        let tmp = getRoom();
        if (tmp) {
            return tmp.users.find((u) => u.id === id);
        }
    };

    // update room/user data
    const emitStatus = () => {
        io.to(room).emit("status", getRoom());
    };
    const _update = (oldData, newData, forbiddenKeys = []) => {
        Object.keys(newData).forEach((key) => {
            if (!forbiddenKeys.includes(key)) {
                oldData[key] = newData[key];
            }
        });
    };
    const update = (data) => {
        _update(getUser(), data, ["queue", "users", "history", "interaction"]);
        if (socket.id === getRoom().owner || getRoom().anarchy) {
            let forbidden = [
                "volume",
                "muted",
                "loaded",
                "ready",
                "buffering",
                "seeking",
                "interaction",
                "fullscreen"
            ];

            if (!data.interaction) {
                forbidden = forbidden.concat([
                    "playbackRate",
                    "loop"
                ]);

                if (socket.id !== getRoom().owner) {
                    forbidden = forbidden.concat([
                        "played"
                    ]);
                }
            }

            _update(getRoom(), data, forbidden);
        }

        emitStatus();
    };

    // find icon and user name that hasn't been taken yet
    let name = getRandomItem(defaultNameList), icon = getRandomItem(userIcons);
    while (getRoom().users.some((user) => user.name === name)) {
        name = getRandomItem(defaultNameList);
    }
    while (getRoom().users.some((user) => user.icon === icon)) {
        icon = getRandomItem(userIcons);
    }
    getRoom().users.push({
        id: socket.id,
        name,
        icon
    });
    log("User " + socket.id + " joined, assigned: \"" + name + "\" " + icon);

    socket.on("disconnect", () => {
        log("User " + socket.id + " disconnected");

        let tmp = getRoom();
        if (tmp.users.length > 1) {
            tmp.users = tmp.users.filter((u) => {
                return u.id !== socket.id;
            });
            if (tmp.owner === socket.id) {
                tmp.owner = tmp.users[0].id;
            }
            log(tmp.users.length + " users left");
            emitStatus();
        } else {
            rooms = rooms.filter((item) => item.id !== room);
            log("no users left, purging room");
        }
    });
    socket.on("update", (data) => {
        update(data);
    });
    socket.on("chat", (data) => {
        io.to(room).emit("chat", {
            user: getUser(),
            time: new Date().getTime(),
            message: data.message
        });
    });

    emitStatus();
});

// ------------------------------------------------------------------------------
// Serve React app
// ------------------------------------------------------------------------------
app.get("/", (req, res) => {
    res.sendFile("public/index.html", {root: ROOT});
});
app.get("/*", (req, res) => {
    // sends file if it exists in /public
    if (fs.existsSync("public" + req.url) && fs.lstatSync("public" + req.url).isFile()) {
        res.sendFile("public" + req.url, {root: ROOT});
    } else {
        res.sendFile("public/index.html", {root: ROOT});
    }
});
http.listen(PORT, () => {
    console.log("listening on *:" + PORT);
});
