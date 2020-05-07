let app = require('express')();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    transports: ['polling'],
    pingInterval: 10000
});
const fs = require('fs');
const uniqid = require('uniqid');


// Rooms
app.get('/room/generate', (req, res) => {
    res.status(307).redirect(uniqid());
});
app.get('/room/room.css', (req, res) => {
    res.sendFile(__dirname + '/public/room/room.css');
});
app.get('/room/player.js', (req, res) => {
    res.sendFile(__dirname + '/public/room/player.js');
});
app.get('/room/room.js', (req, res) => {
    res.sendFile(__dirname + '/public/room/room.js');
});
app.get('/room/events.js', (req, res) => {
    res.sendFile(__dirname + '/public/room/events.js');
});
app.get('/room/:id', (req, res) => {
    res.sendFile(__dirname + '/public/room/room.html');
});
app.get('/room/:id/info.json', (req, res) => {
    res.json({
        id: req.params.id
    });
});


// Icons
let userIcons = [];
fs.readdir('public/icons', (err, files) => {
    files.forEach(file => {
        userIcons.push(file);
    });
});
app.get('/icons.json', (req, res) => {
    res.json(userIcons);
});
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// Socket-Communication
let rooms = [];
io.on('connection', (socket) => {
    const getRoom = (room) => {
        for (let i = 0; i < rooms.length; i++) {
            if (rooms[i].id === room) {
                return rooms[i];
            }
        }
    };
    const updateRoom = (data) => {
        if (!data) {
            return;
        }

        let tmp = getRoom(room);
        if (tmp) {
            if (data.history && tmp.history.length < data.history.length) {
                tmp.history = data.history;
            }
            if (data.src && tmp.src !== data.src) {
                tmp.src = data.src;
            }
            if (data.rate && tmp.rate !== data.rate) {
                tmp.rate = data.rate;
            }
            if (data.time && tmp.time !== data.time) {
                tmp.time = data.time;
            }
            if (data.playing && tmp.playing !== data.playing) {
                tmp.playing = data.playing;
            }
        }
    }
    const getUserInfo = (id) => {
        let tmp = getRoom(room);
        if (tmp) {
            for (let i = 0; i < tmp.users.length; i++) {
                if (tmp.users[i].id === id) {
                    return tmp.users[i];
                }
            }
        }
    }
    const addUser = (user) => {
        if (!user) {
            return;
        }
        let data = getUserInfo(socket.id);
        if (data) {
            data.name = user.name;
            data.iconId = user.iconId;
        } else {
            getRoom(room).users.push({
                id: socket.id,
                name: user.name,
                iconId: user.iconId
            });
        }
    }
    const chat = (msg, sendToAll = true) => {
        if (!msg) {
            return;
        }
        let tmp = getRoom(room);
        if (tmp) {
            let user = getUserInfo(socket.id);
            let data = {
                "id": (msg.id ? msg.id : socket.id),
                "time": Date.now(),
                "type": (msg.type ? msg.type : "light"),
                "name": (msg.name ? msg.name : user.name),
                "iconId": (msg.iconId ? msg.iconId : user.iconId),
                "message": msg.message
            };
            tmp.history.push(data);
            if (sendToAll) {
                io.to(room).emit('chat message', data);
            } else {
                socket.broadcast.to(room).emit('chat message', data);
            }
        }

    }

    let tmp = socket.handshake.headers.referer.match(/[\d\w]+/g);
    let room = tmp[tmp.length - 1];
    console.log('a user connected from room', room);
    socket.join(room);

    let foundRoom = false;
    for (let i = 0; i < rooms.length; i++) {
        if (rooms[i].id === room) {
            foundRoom = true;
        }
    }
    if (!foundRoom) {
        rooms.push({
            id: room,
            users: [],
            history: [],
            playing: false,
            rate: 1,
            src: "",
            time: 0
        });
    }

    socket.emit('getStatus', socket.id, (data) => {
        updateRoom(data);
        addUser(data);
    });
    socket.on('getStatus', (data, callback) => {
        if (data) {
            addUser(data);
        }
        callback(getRoom(room));
    });

    socket.on('disconnect', (data) => {
        console.log('user ' + socket.id + ' disconnected from ' + room + ':\n', data, rooms);
        let tmp = getRoom(room);
        if (tmp.users.length > 1) {
            let user = getUserInfo(socket.id);
            if (user) {
                chat({
                    "type": "warning",
                    "message": "Hat den Raum verlassen"
                });
                tmp.users = tmp.users.filter(item => item.id !== socket.id);
            }
        } else {
            rooms = rooms.filter(item => item.id !== room);
        }
        console.log("after:\n", rooms);
    });
    socket.on('chat message', chat);
    socket.on('change video', (msg) => {
        updateRoom({
            src: msg.src,
            time: 0,
            rate: 1
        });
        socket.broadcast.to(room).emit('change video', msg);
        chat({
            "message": "Wechselt video zu: " + msg.src
        });
    });
    socket.on('timeupdate', (time) => {
        updateRoom({time: time});
    });
    socket.once('join', (data, callback) => {
        addUser(data);
        chat({
            "type": "warning",
            "message": "Hat den Raum betreten"
        }, false);
        callback(getRoom(room));
    });
    socket.on('play failed', (msg) => {
        chat({
            type: "danger",
            message: "Wiedergabe fehlgeschlagen"
        });
        updateRoom({
            playing: false
        });
    });
    socket.on('play', (time) => {
        updateRoom({
            time: time,
            playing: true
        });
        socket.broadcast.to(room).emit('play', time);
    });
    socket.on('ratechange', (rate) => {
        updateRoom({
            rate: rate
        });
        socket.broadcast.to(room).emit('ratechange', rate);
    });
    socket.on('pause', (time) => {
        updateRoom({
            time: time,
            playing: false
        });
        socket.broadcast.to(room).emit('pause', time);
    });
    socket.on('seek', (time) => {
        updateRoom({
            time: time
        });
        socket.broadcast.to(room).emit('seek', time);
    });
});

// Fallback
app.get("/*", (req, res) => {
    if (fs.existsSync(__dirname + '/public' + req.url) && fs.lstatSync(__dirname + '/public' + req.url).isFile()) {
        res.sendFile(__dirname + '/public' + req.url);
    } else {
        res.status(404).end();
    }
})
http.listen(8080, () => {
    console.log('listening on *:8080');
});
