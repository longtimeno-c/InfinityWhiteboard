const canvas = document.getElementById('whiteboard');
const ctx = canvas.getContext('2d');
const drawingCanvas = document.createElement('canvas'); // Offscreen drawing layer
const drawingCtx = drawingCanvas.getContext('2d');
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
    const oldScale = scale;
    scale *= factor;
    
    // Send zoom update to server
    socket.send(JSON.stringify({ 
        type: 'zoom', 
        scale 
    }));
    
    redraw();
}

function clearBoardWithConfirm() {
    if (confirm('Are you sure you want to clear the board?')) {
        // Send clear command to server
        socket.send(JSON.stringify({ type: 'clear' }));
        
        // Local clear (will be overwritten when server responds)
        history = [];
        redoStack = [];
        scale = 1;
        offsetX = 0;
        offsetY = 0;
        drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
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
    if (e.key === '+' || e.key === '=') zoom(1.2); // Zoom in
    if (e.key === '-') zoom(0.8); // Zoom out
    redraw();
});

function startDrawing(e) {
    e.preventDefault();
    drawing = true;
    const { x, y } = getVirtualCoords(e);
    currentStroke = { 
        type: 'draw', 
        tool, 
        color, 
        size, 
        points: [{ x, y, pressure: e.pressure || 1 }] 
    };
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
        const eraserSize = size * 2; // Make eraser slightly larger than pen
        
        // Only apply eraser to the drawing canvas
        drawingCtx.save();
        drawingCtx.globalCompositeOperation = 'destination-out';
        drawingCtx.beginPath();
        
        // Draw a path between points for continuous erasing
        if (currentStroke.points.length > 0) {
            const lastPoint = currentStroke.points[currentStroke.points.length - 1];
            drawingCtx.moveTo(lastPoint.x * scale + offsetX, lastPoint.y * scale + offsetY);
            drawingCtx.lineTo(x * scale + offsetX, y * scale + offsetY);
            drawingCtx.lineWidth = eraserSize * scale * pressure;
            drawingCtx.lineCap = 'round';
            drawingCtx.stroke();
        }
        
        // Add circular cap at current point for better erasing
        drawingCtx.beginPath();
        drawingCtx.arc(x * scale + offsetX, y * scale + offsetY, (eraserSize/2) * scale * pressure, 0, Math.PI * 2);
        drawingCtx.fill();
        
        drawingCtx.restore();
        
        // Clear the main canvas and redraw from drawing canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(drawingCanvas, 0, 0);
        
        currentStroke.type = 'erase'; // Make sure type is set to erase
        currentStroke.size = eraserSize; // Store the larger eraser size
        currentStroke.points.push({ x, y, pressure });
    } else if (tool === 'pan') {
        panBoard(e);
        throttleRedraw();
        
        // Send pan updates to other clients (throttled)
        throttleSendPanUpdate();
    }
}

// Throttle pan updates to reduce network traffic
let panUpdateTimeout = null;
function throttleSendPanUpdate() {
    if (!panUpdateTimeout) {
        panUpdateTimeout = setTimeout(() => {
            socket.send(JSON.stringify({ 
                type: 'pan', 
                offsetX, 
                offsetY 
            }));
            panUpdateTimeout = null;
        }, 100); // Send at most every 100ms
    }
}

function stopDrawing() {
    drawing = false;
    if (tool === 'pen' || tool === 'eraser') {
        if (currentStroke && currentStroke.points.length > 1) {
            // Only send strokes with at least 2 points
            history.push(currentStroke);
            redoStack = [];
            drawingCtx.drawImage(canvas, 0, 0); // Update offscreen canvas with current state
            
            // Send the stroke to the server
            socket.send(JSON.stringify({ 
                type: currentStroke.tool === 'eraser' ? 'erase' : 'draw',
                tool: currentStroke.tool,
                color: currentStroke.color,
                size: currentStroke.size,
                points: currentStroke.points
            }));
            
            redraw(); // Full redraw to sync grid and drawing
            currentStroke = null;
        }
    } else if (tool === 'pan') {
        canvas.style.cursor = 'grab';
        if (isPanning) {
            isPanning = false;
            
            // Send final pan position
            socket.send(JSON.stringify({ 
                type: 'pan', 
                offsetX, 
                offsetY 
            }));
            
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

function undo() {
    if (history.length === 0) return;
    
    // Send undo command to server
    socket.send(JSON.stringify({ type: 'undo' }));
    
    // Local undo (will be overwritten when server responds)
    const action = history.pop();
    redoStack.push(action);
    redraw();
}

function redo() {
    if (redoStack.length === 0) return;
    
    // Local redo (will be overwritten when server responds)
    const action = redoStack.pop();
    history.push(action);
    
    // Send redo command to server
    socket.send(JSON.stringify({ type: 'redo' }));
    
    redraw();
}

// Initialize the whiteboard
function initWhiteboard() {
    // Set up canvas and context
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    drawingCtx.lineCap = 'round';
    drawingCtx.lineJoin = 'round';
    
    // Resize canvas to fit window
    resizeCanvas();
    
    // Set default tool
    setTool('pen');
    
    // Force an initial redraw
    setTimeout(() => {
        console.log('Initial whiteboard setup complete');
        redraw();
    }, 500);
}

// Call init function when page loads
window.addEventListener('DOMContentLoaded', initWhiteboard);

const socket = setupWebSocket();