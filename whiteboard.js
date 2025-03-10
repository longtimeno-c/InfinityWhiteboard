const canvas = document.getElementById('whiteboard');
const ctx = canvas.getContext('2d');
const drawingCanvas = document.createElement('canvas'); // Offscreen drawing layer
const drawingCtx = drawingCanvas.getContext('2d');
const status = document.getElementById('status');

// Username elements
const usernameModal = document.getElementById('username-modal');
const usernameInput = document.getElementById('username-input');
const saveUsernameBtn = document.getElementById('save-username-btn');
const usernameDisplay = document.getElementById('username-display');
const changeUsernameBtn = document.getElementById('change-username-btn');

// Get references to the clear options modal elements
const clearOptionsModal = document.getElementById('clear-options-modal');
const clearOwnBtn = document.getElementById('clear-own-btn');
const clearAllBtn = document.getElementById('clear-all-btn');
const cancelClearBtn = document.getElementById('cancel-clear-btn');

// Board management variables
let currentBoardId = 'default';
let boards = [];

let username = ''; // Current username
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
let socket; // WebSocket connection

ctx.lineCap = 'round';
ctx.lineJoin = 'round';
drawingCtx.lineCap = 'round';
drawingCtx.lineJoin = 'round';

const penTool = document.getElementById('penTool');
const eraserTool = document.getElementById('eraserTool');
const panTool = document.getElementById('panTool');

// Username functions
function generateRandomUsername() {
    const adjectives = ['Creative', 'Artistic', 'Clever', 'Bright', 'Colorful', 'Dazzling', 'Elegant', 'Fancy', 'Glowing', 'Happy'];
    const nouns = ['Artist', 'Painter', 'Creator', 'Designer', 'Sketcher', 'Drawer', 'Illustrator', 'Doodler', 'Visionary', 'Genius'];
    const randomNumber = Math.floor(Math.random() * 1000);
    
    const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
    
    return `${randomAdjective}${randomNoun}${randomNumber}`;
}

function setCookie(name, value, days) {
    const expires = new Date();
    expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/`;
}

function getCookie(name) {
    const nameEQ = `${name}=`;
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
}

function showUsernameModal() {
    // Generate a random username as a suggestion
    usernameInput.value = generateRandomUsername();
    usernameModal.classList.add('show');
    usernameInput.focus();
    usernameInput.select(); // Select the text for easy editing
}

function hideUsernameModal() {
    usernameModal.classList.remove('show');
}

function saveUsername() {
    const newUsername = usernameInput.value.trim();
    if (newUsername) {
        username = newUsername;
        usernameDisplay.textContent = username;
        setCookie('whiteboard_username', username, 30); // Store for 30 days
        hideUsernameModal();
        
        // Send username to server
        socket.send(JSON.stringify({ 
            type: 'username', 
            username: username 
        }));
    }
}

function initUsername() {
    // Check if username cookie exists
    const savedUsername = getCookie('whiteboard_username');
    if (savedUsername) {
        username = savedUsername;
        usernameDisplay.textContent = username;
    } else {
        // Show modal for first-time visitors
        showUsernameModal();
    }
    
    // Set up event listeners
    saveUsernameBtn.addEventListener('click', saveUsername);
    changeUsernameBtn.addEventListener('click', showUsernameModal);
    
    // Allow pressing Enter to save username
    usernameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            saveUsername();
        }
    });
}

// Board management functions
function switchBoard(boardId) {
    if (boardId === currentBoardId) return;
    
    // Send switch board command to server
    socket.send(JSON.stringify({
        type: 'switch_board',
        boardId: boardId
    }));
    
    // Update UI to show loading state
    updateBoardSelector();
}

function createBoard() {
    const boardName = prompt('Enter a name for the new board:', `Board ${boards.length + 1}`);
    if (boardName) {
        // Send create board command to server
        socket.send(JSON.stringify({
            type: 'create_board',
            name: boardName
        }));
    }
}

function renameBoard(boardId) {
    const board = boards.find(b => b.id === boardId);
    if (!board) return;
    
    const newName = prompt('Enter a new name for the board:', board.name);
    if (newName && newName !== board.name) {
        // Send rename board command to server
        socket.send(JSON.stringify({
            type: 'rename_board',
            boardId: boardId,
            name: newName
        }));
    }
}

function deleteBoard(boardId) {
    if (boardId === 'default') {
        alert('Cannot delete the default board');
        return;
    }
    
    const board = boards.find(b => b.id === boardId);
    if (!board) return;
    
    if (confirm(`Are you sure you want to delete the board "${board.name}"?`)) {
        // Send delete board command to server
        socket.send(JSON.stringify({
            type: 'delete_board',
            boardId: boardId
        }));
    }
}

function updateBoardSelector() {
    const boardSelector = document.getElementById('board-selector');
    if (!boardSelector) return;
    
    // Clear existing options
    boardSelector.innerHTML = '';
    
    // Add boards to selector
    boards.forEach(board => {
        const option = document.createElement('div');
        option.className = 'board-option';
        if (board.id === currentBoardId) {
            option.classList.add('active');
        }
        
        // Create board name element
        const nameEl = document.createElement('span');
        nameEl.className = 'board-name';
        nameEl.textContent = board.name;
        nameEl.addEventListener('click', () => switchBoard(board.id));
        option.appendChild(nameEl);
        
        // Create board actions container
        const actionsEl = document.createElement('div');
        actionsEl.className = 'board-actions';
        
        // Add rename button
        const renameBtn = document.createElement('button');
        renameBtn.className = 'board-action-btn';
        renameBtn.innerHTML = '<i class="fas fa-edit"></i>';
        renameBtn.title = 'Rename board';
        renameBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            renameBoard(board.id);
        });
        actionsEl.appendChild(renameBtn);
        
        // Add delete button (except for default board)
        if (board.id !== 'default') {
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'board-action-btn';
            deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
            deleteBtn.title = 'Delete board';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteBoard(board.id);
            });
            actionsEl.appendChild(deleteBtn);
        }
        
        option.appendChild(actionsEl);
        boardSelector.appendChild(option);
    });
    
    // Add "Create new board" button
    const createBoardBtn = document.createElement('div');
    createBoardBtn.className = 'create-board-btn';
    createBoardBtn.innerHTML = '<i class="fas fa-plus"></i> New Board';
    createBoardBtn.addEventListener('click', createBoard);
    boardSelector.appendChild(createBoardBtn);
}

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

// Add event listeners for the clear options buttons
clearOwnBtn.addEventListener('click', () => {
    hideClearOptionsModal();
    clearUserContent();
});

clearAllBtn.addEventListener('click', () => {
    hideClearOptionsModal();
    clearAllContent();
});

cancelClearBtn.addEventListener('click', hideClearOptionsModal);

function showClearOptionsModal() {
    clearOptionsModal.style.display = 'flex';
}

function hideClearOptionsModal() {
    clearOptionsModal.style.display = 'none';
}

function clearBoardWithConfirm() {
    // Special handling for user named "Shaun"
    if (username === "Shaun") {
        // Show the custom modal with options
        showClearOptionsModal();
    } else {
        // For all other users, just ask if they want to clear their own content
        if (confirm('Are you sure you want to clear your own content from the current board?')) {
            clearUserContent();
        }
    }
}

function clearUserContent() {
    // Filter out the current user's strokes from history
    const filteredHistory = history.filter(stroke => stroke.username !== username);
    
    // Send clear user command to server
    socket.send(JSON.stringify({ 
        type: 'clear_user', 
        username: username 
    }));
    
    // Local clear (will be overwritten when server responds)
    history = filteredHistory;
    redoStack = [];
    drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    redraw();
}

function clearAllContent() {
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
        points: [{ x, y, pressure: 1 }] // Always use pressure 1 instead of e.pressure || 1
    };
    ctx.beginPath();
    ctx.moveTo(x * scale + offsetX, y * scale + offsetY);
}

function draw(e) {
    e.preventDefault();
    if (!drawing || !e.buttons) return;

    const { x, y } = getVirtualCoords(e);
    const pressure = 1; // Always use pressure 1 instead of e.pressure || 1

    if (tool === 'pen') {
        ctx.strokeStyle = color;
        ctx.lineWidth = size * scale; // Remove pressure from the calculation
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
            drawingCtx.lineWidth = eraserSize * scale; // Remove pressure from the calculation
            drawingCtx.lineCap = 'round';
            drawingCtx.stroke();
        }
        
        // Add circular cap at current point for better erasing
        drawingCtx.beginPath();
        drawingCtx.arc(x * scale + offsetX, y * scale + offsetY, (eraserSize/2) * scale, 0, Math.PI * 2); // Remove pressure from the calculation
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
                points: currentStroke.points,
                username: username // Include username with the stroke
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
    
    // Initialize the clear options modal
    hideClearOptionsModal();
    
    // Force an initial redraw
    setTimeout(() => {
        console.log('Initial whiteboard setup complete');
        redraw();
    }, 500);
}

// Call init function when page loads
document.addEventListener('DOMContentLoaded', () => {
    // Initialize username first
    initUsername();
    
    // Then initialize whiteboard and WebSocket
    initWhiteboard();
    
    // Setup WebSocket after username is initialized
    socket = setupWebSocket();
});

function setupWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    const socket = new WebSocket(wsUrl);
    
    socket.onopen = () => {
        console.log('WebSocket connection established');
        status.textContent = 'Connected';
        status.className = 'connected';
        
        // Send username if available
        if (username) {
            socket.send(JSON.stringify({ 
                type: 'username', 
                username: username 
            }));
        }
    };
    
    socket.onclose = () => {
        console.log('WebSocket connection closed');
        status.textContent = 'Disconnected';
        status.className = 'disconnected';
        
        // Try to reconnect after a delay
        setTimeout(() => {
            console.log('Attempting to reconnect...');
            setupWebSocket();
        }, 3000);
    };
    
    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        status.textContent = 'Connection Error';
        status.className = 'disconnected';
    };
    
    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            
            if (data.type === 'init') {
                console.log('Received initial state');
                history = data.state.actions || [];
                currentBoardId = data.boardId || 'default';
                
                // Store the list of boards
                if (data.boards) {
                    boards = data.boards;
                    updateBoardSelector();
                }
                
                redraw();
            } else if (data.type === 'boards_list') {
                // Update the list of boards
                if (data.boards) {
                    boards = data.boards;
                    updateBoardSelector();
                }
            } else if (data.type === 'board_state') {
                // Handle board state update (when switching boards)
                if (data.boardId) {
                    currentBoardId = data.boardId;
                    history = data.state.actions || [];
                    redoStack = [];
                    scale = 1;
                    offsetX = 0;
                    offsetY = 0;
                    redraw();
                    updateBoardSelector();
                }
            } else if (data.type === 'draw') {
                // Handle drawing from other clients
                const stroke = {
                    type: 'draw',
                    tool: data.tool || 'pen',
                    color: data.color,
                    size: data.size,
                    points: data.points
                };
                history.push(stroke);
                redraw();
            } else if (data.type === 'erase') {
                // Handle erasing from other clients
                const stroke = {
                    type: 'erase',
                    tool: 'eraser',
                    size: data.size,
                    points: data.points
                };
                history.push(stroke);
                redraw();
            } else if (data.type === 'clear') {
                // Handle board clear
                history = [];
                redoStack = [];
                redraw();
            } else if (data.type === 'clear_user') {
                // Handle clearing a specific user's content
                if (data.username) {
                    // Filter out the specified user's strokes
                    history = history.filter(stroke => stroke.username !== data.username);
                    redraw();
                }
            } else if (data.type === 'pan') {
                // Handle pan updates from other clients
                offsetX = data.offsetX;
                offsetY = data.offsetY;
                redraw();
            } else if (data.type === 'zoom') {
                // Handle zoom updates from other clients
                scale = data.scale;
                redraw();
            } else if (data.type === 'user_update') {
                // Handle username updates from other clients
                console.log(`User ${data.clientId} is now known as ${data.username}`);
                // You could display this information in a users list if you add that feature
            } else if (data.type === 'user_disconnect') {
                // Handle user disconnection
                console.log(`User ${data.username} (${data.clientId}) disconnected`);
                // You could update a users list if you add that feature
            } else if (data.type === 'error') {
                // Handle error messages from the server
                alert(data.message || 'An error occurred');
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    };
    
    return socket;
}