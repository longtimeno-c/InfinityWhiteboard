const canvas = document.getElementById('whiteboard');
const ctx = canvas.getContext('2d');
const gridCanvas = document.createElement('canvas'); // Offscreen grid
const gridCtx = gridCanvas.getContext('2d');
const status = document.getElementById('status');

let tool = 'pen';
let color = '#000000';
let size = 2;
let drawing = false;
let currentStroke = null;
let history = [];
let redoStack = [];
let scale = 1;
let offsetX = 0, offsetY = 0;
let prevOffsetX = 0, prevOffsetY = 0;
let panVelocityX = 0, panVelocityY = 0;
let isPanning = false;
const GRID_SIZE = 20;
const FRICTION = 0.92;
let rafId = null;

ctx.lineCap = 'round';
ctx.lineJoin = 'round';
gridCtx.lineCap = 'round';
gridCtx.lineJoin = 'round';

const penTool = document.getElementById('penTool');
const eraserTool = document.getElementById('eraserTool');
const panTool = document.getElementById('panTool');

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight - document.getElementById('toolbar').offsetHeight;
    gridCanvas.width = canvas.width;
    gridCanvas.height = canvas.height;
    drawGrid();
    redraw();
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function setTool(newTool) {
    tool = newTool;
    canvas.style.cursor = tool === 'pan' ? 'grab' : 'crosshair';
    penTool.classList.toggle('active', tool === 'pen');
    eraserTool.classList.toggle('active', tool === 'eraser');
    panTool.classList.toggle('active', tool === 'pan');
}

function setColor(newColor) {
    color = newColor;
}

function setSize(newSize) {
    size = parseInt(newSize);
}

function zoom(factor) {
    scale *= factor;
    socket.send(JSON.stringify({ type: 'zoom', scale }));
    redraw();
}

function clearBoardWithConfirm() {
    if (confirm('Are you sure you want to clear the board?')) {
        history = [];
        redoStack = [];
        scale = 1;
        offsetX = 0;
        offsetY = 0;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        socket.send(JSON.stringify({ type: 'clear', history: [], scale: 1, offsetX: 0, offsetY: 0 }));
        redraw();
    }
}

canvas.addEventListener('pointerdown', startDrawing);
canvas.addEventListener('pointermove', draw);
canvas.addEventListener('pointerup', stopDrawing);
canvas.addEventListener('pointerleave', stopDrawing);
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom(e.deltaY > 0 ? 0.9 : 1.1);
});

document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'z') undo();
    if (e.ctrlKey && e.key === 'y') redo();
    if (e.key === 'p') setTool('pen');
    if (e.key === 'e') setTool('eraser');
    if (e.key === ' ') setTool('pan');
    if (e.key === 'ArrowLeft') offsetX += 20;
    if (e.key === 'ArrowRight') offsetX -= 20;
    if (e.key === 'ArrowUp') offsetY += 20;
    if (e.key === 'ArrowDown') offsetY -= 20;
    redraw();
});

function startDrawing(e) {
    e.preventDefault();
    drawing = true;
    const { x, y } = getVirtualCoords(e);
    currentStroke = { type: 'draw', tool, color, size, points: [{ x, y, pressure: e.pressure || 1 }] };
    ctx.beginPath();
    ctx.moveTo(x * scale + offsetX, y * scale + offsetY);
}

function draw(e) {
    e.preventDefault();
    if (!drawing || !e.buttons) return;

    const { x, y } = getVirtualCoords(e);
    const pressure = e.pressure || 1;

    if (tool === 'pen') {
        ctx.strokeStyle = color;
        ctx.lineWidth = size * scale * pressure;
        const lastPoint = currentStroke.points[currentStroke.points.length - 1];
        const midX = (lastPoint.x + x) / 2;
        const midY = (lastPoint.y + y) / 2;
        ctx.quadraticCurveTo(lastPoint.x * scale + offsetX, lastPoint.y * scale + offsetY, midX * scale + offsetX, midY * scale + offsetY);
        ctx.stroke();
        currentStroke.points.push({ x, y, pressure });
    } else if (tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(x * scale + offsetX, y * scale + offsetY, size * scale * pressure, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        currentStroke.points.push({ x, y, pressure });
    } else if (tool === 'pan') {
        panBoard(e);
        throttleRedraw();
    }
}

function stopDrawing() {
    drawing = false;
    if (tool === 'pen' || tool === 'eraser') {
        if (currentStroke) {
            history.push(currentStroke);
            redoStack = [];
            socket.send(JSON.stringify({ type: 'update', history, scale, offsetX, offsetY }));
            currentStroke = null;
        }
    } else if (tool === 'pan') {
        canvas.style.cursor = 'grab';
        if (isPanning) {
            isPanning = false;
            requestAnimationFrame(applyPanInertia);
        }
    }
}

function throttleRedraw() {
    if (!rafId) {
        rafId = requestAnimationFrame(() => {
            redraw();
            rafId = null;
        });
    }
}

function applyPanInertia() {
    if (Math.abs(panVelocityX) > 0.1 || Math.abs(panVelocityY) > 0.1) {
        offsetX += panVelocityX;
        offsetY += panVelocityY;
        panVelocityX *= FRICTION;
        panVelocityY *= FRICTION;
        socket.send(JSON.stringify({ type: 'update', history, scale, offsetX, offsetY }));
        throttleRedraw();
        requestAnimationFrame(applyPanInertia);
    }
}

const socket = setupWebSocket();