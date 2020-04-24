let app = require('express')();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    transports: ['polling']
});
const fs = require('fs');
const uniqid = require('uniqid');

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

io.on('connection', (socket) => {
    let tmp = socket.handshake.headers.referer.match(/[\d\w]+/g);
    console.log('a user connected from room', tmp[tmp.length - 1]);
    socket.join(tmp[tmp.length - 1]);
    socket.on('disconnect', (data) => {
        console.log('user disconnected:', data);
    });
    socket.on('chat message', (msg) => {
        if (msg.message.match(/^!play+ .*/)) {
            let play = {
                type: 'changeVideo',
                src: msg.message.replace("!play ", ""),
                name: msg.name,
                iconId: msg.iconId
            }
            io.to(msg.roomId).emit('change video', play);
        } else {
            io.to(msg.roomId).emit('chat message', msg);
        }
    });
    socket.on('join', (msg) => {
        socket.broadcast.to(msg.roomId).emit('join', msg);
    });
    socket.on('status', (msg) => {
        socket.broadcast.to(msg.roomId).emit('status', msg);
    });
    socket.on('play failed', (msg) => {
        io.to(msg.roomId).emit('play failed', msg);
    });
    socket.on('play', (msg) => {
        socket.broadcast.to(msg.roomId).emit('play', msg.time);
    });
    socket.on('pause', (msg) => {
        socket.broadcast.to(msg.roomId).emit('pause', msg.time);
    });
    socket.on('seek', (msg) => {
        socket.broadcast.to(msg.roomId).emit('seek', msg.time);
    });
});

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
