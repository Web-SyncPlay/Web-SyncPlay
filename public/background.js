document.getElementById('root').style.display = "";
let radius = 20;
let ctx = document.getElementById('background').getContext('2d');
ctx.canvas.width = window.innerWidth;
ctx.canvas.height = window.innerHeight;
ctx.lineCap = 'round';
let orbs = [];

function rand(rMi, rMa) {
    return ~~((Math.random() * (rMa - rMi + 1)) + rMi);
}

function createOrb() {
    let mx, my, dx, dy, dist;
    let max = window.innerHeight > window.innerWidth ? window.innerHeight : window.innerWidth;
    do {
        mx = rand(-max, max) + window.innerWidth / 2;
        my = rand(-max, max) + window.innerHeight / 2;
        dx = window.innerWidth / 2 - mx;
        dy = window.innerHeight / 2 - my;
        dist = Math.sqrt(dx * dx + dy * dy);
    } while (dist < radius);
    let angle = Math.atan2(dy, dx);
    orbs.push({
        x: mx,
        y: my,
        lastX: mx,
        lastY: my,
        colorAngle: rand(0, 360),
        angle: angle + Math.PI / 2,
        size: rand(1, 3) / 2,
        radius: dist,
        speed: rand(5, 12) / 20,
        alpha: 1 - Math.abs(dist) / window.innerWidth,
        draw: function () {
            let gradient = ctx.createLinearGradient(this.lastX, this.lastY, this.x, this.y);
            gradient.addColorStop(0.00, "transparent");
            gradient.addColorStop(1.00, 'hsla(' + this.colorAngle + ',100%,50%,1)');

            ctx.beginPath();
            ctx.strokeStyle = gradient;
            ctx.lineWidth = this.size;
            ctx.moveTo(this.lastX, this.lastY);
            ctx.lineTo(this.x, this.y);
            ctx.stroke();
        },
        update: function () {
            this.lastX = window.innerWidth / 2 + Math.sin((this.angle - this.speed * Math.PI / 20) * -1) * this.radius;
            this.lastY = window.innerHeight / 2 + Math.cos((this.angle - this.speed * Math.PI / 20) * -1) * this.radius;

            this.x = window.innerWidth / 2 + Math.sin(this.angle * -1) * this.radius;
            this.y = window.innerHeight / 2 + Math.cos(this.angle * -1) * this.radius;
            this.angle += this.speed / this.radius;
        }
    });
}


for (let i = 0; i < window.innerWidth * window.innerHeight / 5000; i++) {
    createOrb();
}

function orbCreator() {
    createOrb();
    orbs.shift();
    setTimeout(orbCreator, rand(500, 5000));
}

orbCreator();

function loop() {
    requestAnimationFrame(loop);
    if (ctx.canvas.width !== window.innerWidth || ctx.canvas.height !== window.innerHeight) {
        ctx.canvas.width = window.innerWidth;
        ctx.canvas.height = window.innerHeight;
    }
    ctx.fillStyle = 'rgba(0,0,0)';
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

    // center-circle
    let i = orbs.length;
    while (i--) {
        orbs[i].update();
        orbs[i].draw(ctx);
    }

}

loop();
