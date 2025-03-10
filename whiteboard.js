const canvas = document.getElementById('whiteboard');
const ctx = canvas.getContext('2d');
const drawingCanvas = document.createElement('canvas');
const drawingCtx = drawingCanvas.getContext('2d');
const status = document.getElementById('status');

let tool = 'pen';
let color = '#000000';
let size = 2;
let drawing = false;
let lastX, lastY;
let history = [];
let redoStack = [];
let scale = 1;
let offsetX = 0, offsetY = 0;
let prevOffsetX = 0, prevOffsetY = 0;
let panVelocityX = 0, panVelocityY = 0;
let isPanning = false;
const GRID_SIZE = 20;
const FRICTION = 0.92; // Slightly lower for smoother decay
let rafId = null; // For throttling redraws

ctx.lineCap = 'round';
ctx.lineJoin = 'round';
drawingCtx.lineCap = 'round';
drawingCtx.lineJoin = 'round';

const penTool = document.getElementById('penTool');
const eraserTool = document.getElementById('eraserTool');
const panTool = document.getElementById('panTool');

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight - document.getElementById('toolbar').offsetHeight;
    drawingCanvas.width = canvas.width;
    drawingCanvas.height = canvas.height;
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
        drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
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
    [lastX, lastY] = [x, y];
    if (tool === 'pen' || tool === 'eraser') {
        ctx.beginPath();
        ctx.moveTo(lastX * scale + offsetX, lastY * scale + offsetY);
    } else if (tool === 'pan') {
        canvas.style.cursor = 'grabbing';
        prevOffsetX = offsetX;
        prevOffsetY = offsetY;
        panVelocityX = 0;
        panVelocityY = 0;
    }
}

function draw(e) {
    e.preventDefault();
    if (!drawing) return;

    const { x, y } = getVirtualCoords(e);
    const pressure = e.pressure || 1;

    if (tool === 'pen' && e.buttons === 1) {
        // Draw directly to the main canvas for responsiveness
        ctx.strokeStyle = color;
        ctx.lineWidth = size * scale * pressure;
        ctx.lineTo(x * scale + offsetX, y * scale + offsetY);
        ctx.stroke();
        const action = { type: 'draw', tool: 'pen', color, size: size * pressure, lastX, lastY, x, y };
        history.push(action);
        redoStack = [];
    } else if (tool === 'eraser' && e.buttons === 1) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(x * scale + offsetX, y * scale + offsetY, size * scale * pressure, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        const action = { type: 'draw', tool: 'eraser', size: size * pressure, x, y };
        history.push(action);
        redoStack = [];
    } else if (tool === 'pan') {
        panBoard(e);
        throttleRedraw();
    }

    [lastX, lastY] = [x, y];
}

function stopDrawing() {
    drawing = false;
    if (tool === 'pen' || tool === 'eraser') {
        // Composite the current state to the offscreen canvas when the stroke ends
        drawingCtx.drawImage(canvas, 0, 0);
        socket.send(JSON.stringify({ type: 'update', history, scale, offsetX, offsetY }));
        redraw(); // Full redraw to ensure grid and history are in sync
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