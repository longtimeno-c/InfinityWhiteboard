function getVirtualCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - offsetX) / scale;
    const y = (e.clientY - rect.top - offsetY) / scale;
    return { x, y };
}

function panBoard(e) {
    if (!isPanning) return;
    
    // Get current mouse position
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // If this is the first move after starting to pan, initialize lastMouseX/Y
    if (typeof lastMouseX === 'undefined') {
        lastMouseX = mouseX;
        lastMouseY = mouseY;
        return;
    }
    
    // Calculate the movement delta with reduced sensitivity
    const sensitivity = 0.5; // Reduce this value to make panning less sensitive
    const deltaX = (mouseX - lastMouseX) * sensitivity;
    const deltaY = (mouseY - lastMouseY) * sensitivity;
    
    // Update offsets
    offsetX += deltaX;
    offsetY += deltaY;
    
    // Update velocity for inertia (also apply sensitivity to inertia)
    panVelocityX = deltaX * 0.5;
    panVelocityY = deltaY * 0.5;
    
    // Store current position for next move
    lastMouseX = mouseX;
    lastMouseY = mouseY;
    
    // Update the canvas
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
    console.log(`Redrawing canvas with ${history.length} actions`);
    
    // Clear both canvases
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    
    // Draw grid on main canvas
    drawGrid();
    
    // Set up drawing canvas for rendering history
    drawingCtx.save();
    drawingCtx.translate(offsetX, offsetY);
    drawingCtx.scale(scale, scale);

    // Draw all actions from history
    if (history && history.length > 0) {
        history.forEach((action, index) => {
            if (!action) {
                console.warn(`Skipping undefined action at index ${index}`);
                return;
            }
            
            if (action.type === 'draw') {
                drawingCtx.beginPath();
                drawingCtx.strokeStyle = action.color || '#000000';
                drawingCtx.lineWidth = action.size || 2;
                
                const points = action.points;
                if (!points || points.length < 2) {
                    console.warn(`Skipping invalid draw action: insufficient points`);
                    return;
                }
                
                drawingCtx.moveTo(points[0].x, points[0].y);
                
                for (let i = 1; i < points.length; i++) {
                    // Ignore pressure and use constant line width
                    drawingCtx.lineWidth = action.size || 2;
                    
                    if (i === 1) {
                        // For the first segment, just draw a line
                        drawingCtx.lineTo(points[i].x, points[i].y);
                    } else {
                        // For subsequent segments, use quadratic curves for smoother lines
                        const lastPoint = points[i - 1];
                        const midX = (lastPoint.x + points[i].x) / 2;
                        const midY = (lastPoint.y + points[i].y) / 2;
                        drawingCtx.quadraticCurveTo(lastPoint.x, lastPoint.y, midX, midY);
                    }
                }
                drawingCtx.stroke();
            } else if (action.type === 'erase') {
                drawingCtx.globalCompositeOperation = 'destination-out';
                
                const points = action.points;
                if (!points || points.length === 0) {
                    console.warn(`Skipping invalid erase action: no points`);
                    return;
                }
                
                points.forEach(p => {
                    // Ignore pressure and use constant eraser size
                    drawingCtx.beginPath();
                    drawingCtx.arc(p.x, p.y, action.size || 10, 0, Math.PI * 2);
                    drawingCtx.fill();
                });
                
                drawingCtx.globalCompositeOperation = 'source-over';
            }
        });
    } else {
        console.log('No actions to draw');
    }
    
    drawingCtx.restore();
    
    // Composite drawing layer onto main canvas
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
    let clientId = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    const reconnectDelay = 2000; // Start with 2 seconds

    function connect() {
        socket.onopen = () => {
            console.log('Connected to WebSocket server');
            status.textContent = 'Connected';
            status.className = 'connected';
            reconnectAttempts = 0; // Reset reconnect attempts on successful connection
        };

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                if (data.type === 'init') {
                    // Store client ID assigned by server
                    clientId = data.clientId;
                    console.log(`Initialized with client ID: ${clientId}`);
                    
                    // Load initial state
                    if (data.state && data.state.actions) {
                        console.log(`Received initial state with ${data.state.actions.length} actions`);
                        history = data.state.actions || [];
                        
                        // Force immediate redraw of initial state
                        setTimeout(() => {
                            console.log('Rendering initial state...');
                            redraw();
                            // Force a second redraw after a short delay to ensure everything is visible
                            setTimeout(() => {
                                redraw();
                            }, 100);
                        }, 0);
                    }
                } else if (data.type === 'draw' || data.type === 'erase') {
                    // Real-time drawing from another client
                    if (data.clientId !== clientId) { // Ignore our own actions that echo back
                        console.log(`Received drawing action from client ${data.clientId}`);
                        
                        // For incremental strokes, we need to find if we already have a stroke in progress
                        if (data.isIncremental) {
                            // Find if we have a temporary stroke from this client
                            const tempStrokeIndex = history.findIndex(action => 
                                action.clientId === data.clientId && action.isIncremental);
                            
                            if (tempStrokeIndex >= 0) {
                                // Replace the temporary stroke with the new one
                                history[tempStrokeIndex] = data;
                            } else {
                                // Add as a new temporary stroke
                                history.push(data);
                            }
                        } else if (data.isComplete) {
                            // For complete strokes, remove any temporary strokes from this client
                            history = history.filter(action => 
                                !(action.clientId === data.clientId && action.isIncremental));
                            
                            // Add the complete stroke
                            history.push(data);
                        } else {
                            // Regular stroke (not marked as incremental or complete)
                            history.push(data);
                        }
                        
                        // Force immediate redraw without waiting for user interaction
                        requestAnimationFrame(() => {
                            redraw();
                        });
                    }
                } else if (data.type === 'update') {
                    // Full state update (e.g., after undo/redo)
                    if (data.state && data.state.actions) {
                        console.log(`Received state update with ${data.state.actions.length} actions`);
                        history = data.state.actions;
                        // Force immediate redraw
                        requestAnimationFrame(() => {
                            redraw();
                        });
                    }
                } else if (data.type === 'clear') {
                    // Clear board command
                    console.log('Received clear board command');
                    history = [];
                    redoStack = [];
                    drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
                    // Force immediate redraw
                    requestAnimationFrame(() => {
                        redraw();
                    });
                } else if (data.type === 'pan' && data.clientId !== clientId) {
                    // Pan update from another client
                    offsetX = data.offsetX;
                    offsetY = data.offsetY;
                    // Force immediate redraw
                    requestAnimationFrame(() => {
                        redraw();
                    });
                } else if (data.type === 'zoom' && data.clientId !== clientId) {
                    // Zoom update from another client
                    scale = data.scale;
                    // Force immediate redraw
                    requestAnimationFrame(() => {
                        redraw();
                    });
                }
            } catch (error) {
                console.error('Error processing WebSocket message:', error);
            }
        };

        socket.onclose = (event) => {
            console.log(`Disconnected from WebSocket server: ${event.code} ${event.reason}`);
            status.textContent = 'Disconnected';
            status.className = 'disconnected';
            
            // Attempt to reconnect unless it was a clean close
            if (!event.wasClean && reconnectAttempts < maxReconnectAttempts) {
                const delay = reconnectDelay * Math.pow(1.5, reconnectAttempts);
                reconnectAttempts++;
                console.log(`Attempting to reconnect in ${delay}ms (attempt ${reconnectAttempts}/${maxReconnectAttempts})...`);
                status.textContent = `Reconnecting (${reconnectAttempts}/${maxReconnectAttempts})...`;
                
                setTimeout(() => {
                    const newSocket = new WebSocket(`${wsProtocol}//${wsHost}`);
                    socket = newSocket;
                    connect(); // Set up event handlers for the new socket
                }, delay);
            }
        };

        socket.onerror = (error) => {
            console.error('WebSocket error:', error);
            status.textContent = 'Error';
            status.className = 'disconnected';
        };
    }

    // Initialize connection
    connect();

    // Add methods to the socket object
    const enhancedSocket = {
        send: (data) => {
            // Add client ID to outgoing messages if available
            if (typeof data === 'string') {
                try {
                    const parsedData = JSON.parse(data);
                    if (clientId && !parsedData.clientId) {
                        parsedData.clientId = clientId;
                    }
                    socket.send(JSON.stringify(parsedData));
                } catch (e) {
                    socket.send(data); // Send as is if not valid JSON
                }
            } else {
                socket.send(data);
            }
        },
        getClientId: () => clientId
    };

    return enhancedSocket;
}