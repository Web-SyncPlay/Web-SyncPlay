let app = require('express')();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    transports: ['polling']
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
    const updateStatus = (data) => {
        if (!data) {
            return;
        }
        for (let i = 0; i < rooms.length; i++) {
            if (rooms[i].id === room) {
                if (rooms[i].history.length < data.history.length) {
                    rooms[i].history = data.history;
                }
                if (rooms[i].src !== data.src) {
                    rooms[i].src = data.src;
                }
                if (rooms[i].rate !== data.rate) {
                    rooms[i].rate = data.rate;
                }
                if (rooms[i].time !== data.time) {
                    rooms[i].time = data.time;
                }
                break;
            }
        }
    }
    const addUser = (user) => {
        if (!user) {
            return;
        }
        for (let i = 0; i < rooms.length; i++) {
            if (rooms[i].id === room) {
                let found = false;
                for (let j = 0; j < rooms[i].users.length; j++) {
                    if (rooms[i].users[j].id === socket.id) {
                        rooms[i].users[j] = {
                            id: socket.id,
                            name: user.name,
                            iconId: user.iconId
                        }
                        found = true;
                        break;
                    }
                }

                if (!found) {
                    rooms[i].users.push({
                        id: socket.id,
                        name: user.name,
                        iconId: user.iconId
                    });
                }
                break;
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
            rate: 1,
            src: "",
            time: 0
        });
    }

    socket.emit('getStatus', socket.id, (data) => {
        console.log("Client answered!!!", data);
        updateStatus(data);
        addUser(data);
    });

    socket.on('disconnect', (data) => {
        console.log('user ' + socket.id + ' disconnected from ' + room + ':\n', data, rooms);
        for (let i = 0; i < rooms.length; i++) {
            if (rooms[i].id === room) {
                if (rooms[i].users.length > 1) {
                    for (let j = 0; j < rooms[i].users.length; j++) {
                        socket.broadcast.to(room).emit("quited", {
                            "type": 'quit',
                            "name": rooms[i].users[j].name,
                            "iconId": rooms[i].users[j].name.iconId,
                            "reason": data
                        });
                        rooms[i].users = rooms[i].users.filter(item => item.id !== socket.id);
                        break;
                    }
                } else {
                    rooms = rooms.filter(item => item.id !== room);
                }
                break;
            }
        }
        console.log("after:\n", rooms);
    });
    socket.on('chat message', (msg) => {
        for (let i = 0; i < rooms.length; i++) {
            if (rooms[i].id === room) {
                rooms[i].history.push(msg);
                break;
            }
        }
        io.to(room).emit('chat message', msg);
    });
    socket.on('change video', (msg) => {
        for (let i = 0; i < rooms.length; i++) {
            if (rooms[i].id === room) {
                rooms[i].src = msg.src;
                rooms[i].time = 0;
                rooms[i].rate = 1;
                break;
            }
        }
        socket.broadcast.to(room).emit('change video', msg);
    });
    socket.on('timeupdate', (msg) => {
        for (let i = 0; i < rooms.length; i++) {
            if (rooms[i].id === room) {
                rooms[i].time = msg.time;
                break;
            }
        }
    });
    socket.once('join', (data) => {
        addUser(data);
        socket.broadcast.to(room).emit('join', data);
    });
    socket.on('status', (msg) => {
        socket.broadcast.to(room).emit('status', msg);
    });
    socket.on('play failed', (msg) => {
        io.to(room).emit('play failed', msg);
    });
    socket.on('play', (msg) => {
        socket.broadcast.to(room).emit('play', msg.time);
    });
    socket.on('ratechange', (msg) => {
        for (let i = 0; i < rooms.length; i++) {
            if (rooms[i].id === room) {
                rooms[i].rate = msg.rate;
                break;
            }
        }
        socket.broadcast.to(room).emit('ratechange', msg);
    });
    socket.on('pause', (msg) => {
        socket.broadcast.to(room).emit('pause', msg.time);
    });
    socket.on('seek', (msg) => {
        socket.broadcast.to(room).emit('seek', msg.time);
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
