import {createServer} from "http";
import {Server} from "socket.io";
import express from "express";
import fs from "fs";
import cors from "cors";
import path from "path";
import {adjectives, animals, colors, names, starWars, uniqueNamesGenerator} from "unique-names-generator";

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

const nameLists = [adjectives, animals, colors, starWars, names];

const getRandomItem = (array) => {
    return array[Math.round(Math.random() * (array.length - 1))];
};
const getRandomName = (words = 2) => {
    let lists = [];
    for (let i = 0; i < words; i++) {
        lists.push(Math.round(Math.random() * (nameLists.length - 1)));
    }

    return uniqueNamesGenerator({
        dictionaries: lists.map((i) => nameLists[i]),
        length: words,
        style: "capital"
    }).replace("_", " ");
};

// Icons
let userIcons = [];
fs.readdir("public/icons", (err, files) => {
    userIcons = files;
});

app.get("/icons.json", (req, res) => {
    res.json(userIcons);
});

const generateId = (length = 4) => {
    let result = "", chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.round(Math.random() * (chars.length - 1)));
    }
    return result;
};
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

    let name = getRandomName(), icon = getRandomItem(userIcons);
    getRoom().users.push({
        id: socket.id,
        name,
        icon
    });
    log("User " + socket.id + " joined, assigned: \"" + name + "\" " + icon);

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
        _update(getUser(), data, [
            "queue",
            "users",
            "history",
            "interaction",
            "showTimePlayed",
            "controlsHidden"
        ]);
        if (socket.id === getRoom().owner || getRoom().anarchy) {
            let forbidden = [
                "volume",
                "muted",
                "loaded",
                "ready",
                "buffering",
                "seeking",
                "interaction",
                "showTimePlayed",
                "controlsHidden",
                "fullscreen",
                "loadedSeconds",
                "playedSeconds"
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
