function getVirtualCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - offsetX) / scale;
    const y = (e.clientY - rect.top - offsetY) / scale;
    return { x, y };
}

function panBoard(e) {
    isPanning = true;
    const deltaX = e.movementX;
    const deltaY = e.movementY;
    offsetX = prevOffsetX + deltaX;
    offsetY = prevOffsetY + deltaY;
    panVelocityX = deltaX * 0.5;
    panVelocityY = deltaY * 0.5;
    prevOffsetX = offsetX;
    prevOffsetY = offsetY;
}

function drawGrid() {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, offsetX, offsetY);
    ctx.scale(scale, scale);
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 0.5 / scale;

    const minX = -offsetX / scale;
    const minY = -offsetY / scale;
    const maxX = (canvas.width - offsetX) / scale;
    const maxY = (canvas.height - offsetY) / scale;

    for (let x = Math.floor(minX / GRID_SIZE) * GRID_SIZE; x <= maxX; x += GRID_SIZE) {
        ctx.beginPath();
        ctx.moveTo(x, minY);
        ctx.lineTo(x, maxY);
        ctx.stroke();
    }
    for (let y = Math.floor(minY / GRID_SIZE) * GRID_SIZE; y <= maxY; y += GRID_SIZE) {
        ctx.beginPath();
        ctx.moveTo(minX, y);
        ctx.lineTo(maxX, y);
        ctx.stroke();
    }
    ctx.restore();
}

function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGrid(); // Draw grid aligned with offsetX/offsetY
    ctx.drawImage(drawingCanvas, 0, 0); // Composite drawing layer on top

    // Update drawingCanvas with history (only needed for undo/redo or external updates)
    drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    drawingCtx.save();
    drawingCtx.translate(offsetX, offsetY);
    drawingCtx.scale(scale, scale);

    history.forEach(action => {
        if (action.type === 'draw' && action.tool === 'pen') {
            drawingCtx.beginPath();
            drawingCtx.strokeStyle = action.color;
            const points = action.points;
            for (let i = 0; i < points.length; i++) {
                drawingCtx.lineWidth = action.size * points[i].pressure;
                if (i === 0) {
                    drawingCtx.moveTo(points[i].x, points[i].y);
                } else {
                    const lastPoint = points[i - 1];
                    const midX = (lastPoint.x + points[i].x) / 2;
                    const midY = (lastPoint.y + points[i].y) / 2;
                    drawingCtx.quadraticCurveTo(lastPoint.x, lastPoint.y, midX, midY);
                }
            }
            drawingCtx.stroke();
        } else if (action.type === 'draw' && action.tool === 'eraser') {
            drawingCtx.globalCompositeOperation = 'destination-out';
            action.points.forEach(p => {
                drawingCtx.beginPath();
                drawingCtx.arc(p.x, p.y, action.size * p.pressure, 0, Math.PI * 2);
                drawingCtx.fill();
            });
            drawingCtx.globalCompositeOperation = 'source-over';
        }
    });
    drawingCtx.restore();
}

function undo() {
    if (history.length === 0) return;
    const action = history.pop();
    redoStack.push(action);
    socket.send(JSON.stringify({ type: 'update', history, scale, offsetX, offsetY }));
    redraw();
}

function redo() {
    if (redoStack.length === 0) return;
    const action = redoStack.pop();
    history.push(action);
    socket.send(JSON.stringify({ type: 'update', history, scale, offsetX, offsetY }));
    redraw();
}

function setupWebSocket() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = window.location.host;
    const socket = new WebSocket(`${wsProtocol}//${wsHost}`);

    socket.onopen = () => {
        console.log('Connected to WebSocket server');
        status.textContent = 'Connected';
        status.className = 'connected';
    };

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'init') {
            history = data.history || [];
            scale = data.scale || 1;
            offsetX = data.offsetX || 0;
            offsetY = data.offsetY || 0;
            redoStack = [];
            redraw();
        } else if (data.type === 'update') {
            history = data.history || [];
            scale = data.scale || 1;
            offsetX = data.offsetX || 0;
            offsetY = data.offsetY || 0;
            redraw();
        } else if (data.type === 'clear') {
            history = [];
            redoStack = [];
            scale = data.scale || 1;
            offsetX = data.offsetX || 0;
            offsetY = data.offsetY || 0;
            drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
            redraw();
        }
    };

    socket.onclose = () => {
        console.log('Disconnected from WebSocket server');
        status.textContent = 'Disconnected';
        status.className = 'disconnected';
    };

    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        status.textContent = 'Error';
        status.className = 'disconnected';
    };

    return socket;
}