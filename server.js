const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid'); // Add UUID for unique identifiers

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server }); // WebSocket on root path

const BOARD_FILE = 'whiteboard.json';
let boardState = { actions: [] };
const clients = new Map(); // Track connected clients

async function loadBoardState() {
    try {
        const data = await fs.readFile(BOARD_FILE, 'utf8');
        boardState = JSON.parse(data);
        console.log('Loaded board state with', boardState.actions.length, 'actions');
    } catch (error) {
        console.log('No existing board state found, starting fresh');
        boardState = { actions: [] };
    }
}

async function saveBoardState() {
    try {
        await fs.writeFile(BOARD_FILE, JSON.stringify(boardState));
    } catch (error) {
        console.error('Error saving board state:', error);
    }
}

// Debounce save function to prevent excessive writes
let saveTimeout = null;
function debouncedSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        saveBoardState();
        saveTimeout = null;
    }, 1000); // Save after 1 second of inactivity
}

// Broadcast to all clients except sender
function broadcast(message, excludeClient = null) {
    wss.clients.forEach((client) => {
        if (client !== excludeClient && client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

loadBoardState().then(() => {
    wss.on('connection', (ws) => {
        const clientId = uuidv4();
        clients.set(ws, { id: clientId, username: null });
        console.log(`New client connected: ${clientId}`);
        
        // Send initial state to new client
        ws.send(JSON.stringify({ 
            type: 'init', 
            state: boardState,
            clientId: clientId
        }));

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                
                // Add client ID and timestamp to the action
                if (!data.clientId) {
                    data.clientId = clientId;
                }
                data.timestamp = Date.now();

                if (data.type === 'username') {
                    // Store username for this client
                    const clientInfo = clients.get(ws);
                    if (clientInfo) {
                        clientInfo.username = data.username;
                        clients.set(ws, clientInfo);
                        console.log(`Client ${clientId} set username: ${data.username}`);
                    }
                    
                    // Broadcast username change to all clients
                    broadcast(JSON.stringify({
                        type: 'user_update',
                        clientId: clientId,
                        username: data.username
                    }));
                    
                } else if (data.type === 'draw' || data.type === 'erase') {
                    // Add username to the action if available
                    const clientInfo = clients.get(ws);
                    if (clientInfo && clientInfo.username) {
                        data.username = clientInfo.username;
                    }
                    
                    // Add the action to board state
                    boardState.actions.push(data);
                    debouncedSave();
                    
                    // Broadcast to all other clients
                    broadcast(JSON.stringify(data), ws);
                } else if (data.type === 'undo') {
                    // Find the last action by this client and remove it
                    for (let i = boardState.actions.length - 1; i >= 0; i--) {
                        if (boardState.actions[i].clientId === clientId) {
                            boardState.actions.splice(i, 1);
                            break;
                        }
                    }
                    debouncedSave();
                    
                    // Broadcast the updated state to all clients
                    broadcast(JSON.stringify({ 
                        type: 'update', 
                        state: boardState 
                    }));
                } else if (data.type === 'clear') {
                    boardState.actions = [];
                    debouncedSave();
                    
                    // Broadcast clear command to all clients
                    broadcast(JSON.stringify({ type: 'clear' }));
                } else if (data.type === 'clear_user') {
                    // Filter out actions by the specified username
                    if (data.username) {
                        boardState.actions = boardState.actions.filter(action => action.username !== data.username);
                        debouncedSave();
                        
                        // Broadcast the clear_user command to all clients
                        broadcast(JSON.stringify({ 
                            type: 'clear_user', 
                            username: data.username 
                        }));
                    }
                } else if (data.type === 'pan' || data.type === 'zoom') {
                    // Don't save view state changes, just broadcast to others
                    broadcast(JSON.stringify(data), ws);
                }
            } catch (error) {
                console.error('Error processing message:', error);
            }
        });

        ws.on('close', () => {
            const clientInfo = clients.get(ws);
            console.log(`Client disconnected: ${clientInfo?.id} (${clientInfo?.username || 'unnamed'})`);
            
            // Notify other clients about disconnection
            if (clientInfo && clientInfo.username) {
                broadcast(JSON.stringify({
                    type: 'user_disconnect',
                    clientId: clientInfo.id,
                    username: clientInfo.username
                }));
            }
            
            clients.delete(ws);
        });

        ws.on('error', (error) => {
            console.error(`WebSocket error for client ${clients.get(ws)?.id}:`, error);
        });
    });

    wss.on('error', (error) => {
        console.error('WebSocket Server Error:', error);
    });

    // Serve static files
    app.use(express.static('.'));

    // Start the server
    const PORT = process.env.PORT || 3001;
    server.listen(PORT, () => {
        console.log(`HTTP and WebSocket server running on http://localhost:${PORT}`);
        console.log(`Expect Caddy to proxy https://watch.stream150.com and wss://watch.stream150.com to this server`);
    });

    // Periodically save board state as backup
    setInterval(() => {
        if (saveTimeout) {
            clearTimeout(saveTimeout);
            saveTimeout = null;
            saveBoardState();
        }
    }, 60000); // Force save every minute
});