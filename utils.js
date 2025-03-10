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
    gridCtx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
    gridCtx.strokeStyle = '#e0e0e0';
    gridCtx.lineWidth = 0.5;

    for (let x = 0; x <= gridCanvas.width; x += GRID_SIZE) {
        gridCtx.beginPath();
        gridCtx.moveTo(x, 0);
        gridCtx.lineTo(x, gridCanvas.height);
        gridCtx.stroke();
    }
    for (let y = 0; y <= gridCanvas.height; y += GRID_SIZE) {
        gridCtx.beginPath();
        gridCtx.moveTo(0, y);
        gridCtx.lineTo(gridCanvas.width, y);
        gridCtx.stroke();
    }
}

function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(gridCanvas, 0, 0); // Composite static grid
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    history.forEach(action => {
        if (action.type === 'draw' && action.tool === 'pen') {
            ctx.beginPath();
            ctx.strokeStyle = action.color;
            const points = action.points;
            for (let i = 0; i < points.length; i++) {
                ctx.lineWidth = action.size * points[i].pressure;
                if (i === 0) {
                    ctx.moveTo(points[i].x, points[i].y);
                } else {
                    const lastPoint = points[i - 1];
                    const midX = (lastPoint.x + points[i].x) / 2;
                    const midY = (lastPoint.y + points[i].y) / 2;
                    ctx.quadraticCurveTo(lastPoint.x, lastPoint.y, midX, midY);
                }
            }
            ctx.stroke();
        } else if (action.type === 'draw' && action.tool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            action.points.forEach(p => {
                ctx.beginPath();
                ctx.arc(p.x, p.y, action.size * p.pressure, 0, Math.PI * 2);
                ctx.fill();
            });
            ctx.globalCompositeOperation = 'source-over';
        }
    });
    ctx.restore();
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
            ctx.clearRect(0, 0, canvas.width, canvas.height);
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