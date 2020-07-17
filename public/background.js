document.getElementById('root').style.display = "";
let radius = 60;
let ctx = document.getElementById('background').getContext('2d');
ctx.canvas.width = window.innerWidth;
ctx.canvas.height = window.innerHeight;
let rand = function (rMi, rMa) {
    return ~~((Math.random() * (rMa - rMi + 1)) + rMi);
}
ctx.lineCap = 'round';
let orbs = [];

const createOrb = () => {
    let mx, my, dx, dy, dist;
    let max = window.innerHeight > window.innerWidth ? window.innerHeight : window.innerWidth;
    do {
        mx = rand(-max, max) + window.innerWidth / 2;
        my = rand(-max, max) + window.innerHeight / 2;
        dx = window.innerWidth / 2 - mx;
        dy = window.innerHeight / 2 - my;
        dist = Math.sqrt(dx * dx + dy * dy);
    } while (dist < radius + 10);
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
const orbCreator = () => {
    createOrb();
    orbs.shift();
    setTimeout(orbCreator, rand(500, 5000));
}
orbCreator();

const loop = function () {
    requestAnimationFrame(loop);
    if (ctx.canvas.width !== window.innerWidth || ctx.canvas.height !== window.innerHeight) {
        ctx.canvas.width = window.innerWidth;
        ctx.canvas.height = window.innerHeight;
    }
    ctx.fillStyle = 'rgba(0,0,0)';
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

    // center-circle
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0,0,0)';
    ctx.arc(window.innerWidth / 2, window.innerHeight / 2, radius, 0, 2 * Math.PI);
    ctx.shadowColor = 'hsla(0,0%,100%,0.7)';
    ctx.shadowBlur = 20;
    ctx.stroke();
    ctx.fill();
    ctx.shadowBlur = 0;
    let i = orbs.length;
    while (i--) {
        orbs[i].update();
        orbs[i].draw(ctx);
    }

}

loop();

