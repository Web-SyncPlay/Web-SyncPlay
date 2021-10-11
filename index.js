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
    userIcons = files.map((f) => "/icons/" + f);
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
    let embed = socket.handshake.query.isEmbed === "true";
    let controller = socket.handshake.query.isController === "true" || false;
    const log = (...item) => {
        let d = new Date();
        let time = "[" + d.toUTCString() + "] [" + room + "]: ";
        console.log(time, ...item);
        fs.appendFile("log.txt", time + item.join() + "\n", function (err) {
            if (err) {
                throw err;
            }
        });
    };
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
            owner: (controller ? "" : socket.id),
            anarchy: true
        });
        log("room created");
    } else if (getRoom().owner === "") {
        getRoom().owner = socket.id;
    }

    const getUser = (id = socket.id) => {
        let tmp = getRoom();
        if (tmp) {
            return tmp.users.find((u) => u.id === id);
        }
    };

    if (controller) {
        getRoom().users.push({
            id: socket.id,
            embed,
            controller
        });
    } else if (embed) {
        getRoom().users.push({
            id: socket.id,
            embed
        });
    } else {
        let name = getRandomName(), icon = getRandomItem(userIcons);
        getRoom().users.push({
            id: socket.id,
            embed,
            name: name,
            icon
        });
    }
    log("UserView " + socket.id + " joined" + (embed ? ", is embed" : "") + (controller ? ", is controller" : ""));

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
        ]);
        if (data.interaction && (socket.id === getRoom().owner || getRoom().anarchy)) {
            let forbidden = [
                "volume",
                "muted",
                "loaded",
                "ready",
                "buffering",
                "seeking",
                "interaction",
                "fullscreen",
                "loadedSeconds",
                "playedSeconds"
            ];

            _update(getRoom(), data, forbidden);
        } else if (socket.id === getRoom().owner) {
            let d = {};
            if (data.played) {
                d.played = data.played;
            }
            if (data.duration) {
                d.duration = data.duration;
            }
            _update(getRoom(), d);
        }

        emitStatus();
    };

    socket.on("disconnect", () => {
        log("UserView " + socket.id + " disconnected");

        let tmp = getRoom();
        if (tmp.users.length > 1) {
            tmp.users = tmp.users.filter((u) => {
                return u.id !== socket.id;
            });
            if (tmp.owner === socket.id) {
                let found = false;
                for (let i = 0; i < tmp.users.length; i++) {
                    if (tmp.users[i].controller) {
                        continue;
                    }

                    tmp.owner = tmp.users[i].id;
                    found = true;
                    break;
                }

                if (!found) {
                    tmp.owner = "";
                }
            }
            log(tmp.users.length + " users left");
            emitStatus();
        } else {
            rooms = rooms.filter((item) => item.id !== room);
            log("no users left, purging room");
        }
    });
    socket.on("initialState", (data) => {
        log("initial state received");
        if (socket.id === getRoom().owner) {
            log("is owner setting data");
            update({...data, interaction: true});
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
    const url = path.join("public", req.url)
    if (fs.existsSync(url) && fs.lstatSync(url).isFile()) {
        res.sendFile(url, {root: ROOT});
    } else {
        res.sendFile("public/index.html", {root: ROOT});
    }
});
http.listen(PORT, () => {
    console.log("listening on *:" + PORT);
});
