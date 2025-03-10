function getVirtualCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - offsetX) / scale;
    const y = (e.clientY - rect.top - offsetY) / scale;
    return { x, y };
}

function drawPen(x, y, pressure) {
    drawingCtx.beginPath();
    drawingCtx.moveTo(lastX * scale + offsetX, lastY * scale + offsetY);
    const midX = (lastX + x) / 2;
    const midY = (lastY + y) / 2;
    drawingCtx.quadraticCurveTo(lastX * scale + offsetX, lastY * scale + offsetY, midX * scale + offsetX, midY * scale + offsetY);
    drawingCtx.lineTo(x * scale + offsetX, y * scale + offsetY);
    drawingCtx.strokeStyle = color;
    drawingCtx.lineWidth = size * scale * pressure;
    drawingCtx.stroke();
    const action = { type: 'draw', tool: 'pen', color, size: size * pressure, lastX, lastY, x, y };
    history.push(action);
    redoStack = [];
    socket.send(JSON.stringify({ type: 'update', history, scale, offsetX, offsetY }));
}

function drawEraser(x, y, pressure) {
    drawingCtx.globalCompositeOperation = 'destination-out';
    drawingCtx.beginPath();
    drawingCtx.arc(x * scale + offsetX, y * scale + offsetY, size * scale * pressure, 0, Math.PI * 2);
    drawingCtx.fill();
    drawingCtx.globalCompositeOperation = 'source-over';
    const action = { type: 'draw', tool: 'eraser', size: size * pressure, x, y };
    history.push(action);
    redoStack = [];
    socket.send(JSON.stringify({ type: 'update', history, scale, offsetX, offsetY }));
}

function panBoard(e) {
    isPanning = true;
    const deltaX = e.movementX;
    const deltaY = e.movementY;
    offsetX = prevOffsetX + deltaX;
    offsetY = prevOffsetY + deltaY;
    panVelocityX = deltaX;
    panVelocityY = deltaY;
    prevOffsetX = offsetX;
    prevOffsetY = offsetY;
    socket.send(JSON.stringify({ type: 'update', history, scale, offsetX, offsetY }));
    redraw();
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
    drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    drawingCtx.save();
    drawingCtx.setTransform(1, 0, 0, 1, offsetX, offsetY);
    drawingCtx.scale(scale, scale);

    drawingCtx.globalCompositeOperation = 'source-over';
    history.forEach(action => {
        if (action.type === 'draw' && action.tool === 'pen') {
            drawingCtx.beginPath();
            drawingCtx.moveTo(action.lastX, action.lastY);
            const midX = (action.lastX + action.x) / 2;
            const midY = (action.lastY + action.y) / 2;
            drawingCtx.quadraticCurveTo(action.lastX, action.lastY, midX, midY);
            drawingCtx.lineTo(action.x, action.y);
            drawingCtx.strokeStyle = action.color;
            drawingCtx.lineWidth = action.size;
            drawingCtx.stroke();
        } else if (action.type === 'draw' && action.tool === 'eraser') {
            drawingCtx.globalCompositeOperation = 'destination-out';
            drawingCtx.beginPath();
            drawingCtx.arc(action.x, action.y, action.size, 0, Math.PI * 2);
            drawingCtx.fill();
            drawingCtx.globalCompositeOperation = 'source-over';
        }
    });
    drawingCtx.restore();

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGrid();
    ctx.drawImage(drawingCanvas, 0, 0);
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