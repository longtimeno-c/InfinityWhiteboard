const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid'); // Add UUID for unique identifiers

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server }); // WebSocket on root path

const BOARDS_FILE = 'whiteboard.json';
let boards = {
    default: { name: "Default Board", actions: [] }
};
const clients = new Map(); // Track connected clients

async function loadBoardsState() {
    try {
        const data = await fs.readFile(BOARDS_FILE, 'utf8');
        const loadedBoards = JSON.parse(data);
        
        // Ensure we have at least a default board
        if (!loadedBoards.default) {
            loadedBoards.default = { name: "Default Board", actions: [] };
        }
        
        boards = loadedBoards;
        console.log(`Loaded ${Object.keys(boards).length} boards`);
        
        // Log the number of actions in each board
        Object.keys(boards).forEach(boardId => {
            console.log(`Board "${boards[boardId].name}" has ${boards[boardId].actions.length} actions`);
        });
    } catch (error) {
        console.log('No existing boards state found, starting fresh');
        boards = {
            default: { name: "Default Board", actions: [] }
        };
    }
}

async function saveBoardsState() {
    try {
        await fs.writeFile(BOARDS_FILE, JSON.stringify(boards));
    } catch (error) {
        console.error('Error saving boards state:', error);
    }
}

// Debounce save function to prevent excessive writes
let saveTimeout = null;
function debouncedSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        saveBoardsState();
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

// Broadcast to all clients on a specific board
function broadcastToBoard(boardId, message, excludeClient = null) {
    wss.clients.forEach((client) => {
        const clientInfo = clients.get(client);
        if (client !== excludeClient && 
            client.readyState === WebSocket.OPEN && 
            clientInfo && 
            clientInfo.currentBoard === boardId) {
            client.send(message);
        }
    });
}

loadBoardsState().then(() => {
    wss.on('connection', (ws) => {
        const clientId = uuidv4();
        clients.set(ws, { 
            id: clientId, 
            username: null,
            currentBoard: 'default' // Default board on connection
        });
        console.log(`New client connected: ${clientId}`);
        
        // Send initial state to new client
        ws.send(JSON.stringify({ 
            type: 'init', 
            state: boards.default,
            boardId: 'default',
            boards: Object.keys(boards).map(id => ({ id, name: boards[id].name })),
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
                
                // Get client info
                const clientInfo = clients.get(ws);
                if (!clientInfo) return;
                
                // Get current board ID
                const boardId = clientInfo.currentBoard || 'default';

                if (data.type === 'username') {
                    // Store username for this client
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
                    
                } else if (data.type === 'switch_board') {
                    // Handle board switching
                    const newBoardId = data.boardId;
                    
                    if (boards[newBoardId]) {
                        // Update client's current board
                        clientInfo.currentBoard = newBoardId;
                        clients.set(ws, clientInfo);
                        
                        // Send the board state to the client
                        ws.send(JSON.stringify({
                            type: 'board_state',
                            boardId: newBoardId,
                            state: boards[newBoardId]
                        }));
                        
                        console.log(`Client ${clientId} switched to board: ${newBoardId}`);
                    } else {
                        console.error(`Board ${newBoardId} not found`);
                    }
                    
                } else if (data.type === 'create_board') {
                    // Handle board creation
                    const newBoardId = uuidv4();
                    const boardName = data.name || `Board ${Object.keys(boards).length + 1}`;
                    
                    // Create new board
                    boards[newBoardId] = {
                        name: boardName,
                        actions: []
                    };
                    
                    // Save boards state
                    debouncedSave();
                    
                    // Switch client to the new board
                    clientInfo.currentBoard = newBoardId;
                    clients.set(ws, clientInfo);
                    
                    // Send the new board state to the client
                    ws.send(JSON.stringify({
                        type: 'board_state',
                        boardId: newBoardId,
                        state: boards[newBoardId]
                    }));
                    
                    // Broadcast board list update to all clients
                    broadcast(JSON.stringify({
                        type: 'boards_list',
                        boards: Object.keys(boards).map(id => ({ id, name: boards[id].name }))
                    }));
                    
                    console.log(`Client ${clientId} created new board: ${boardName} (${newBoardId})`);
                    
                } else if (data.type === 'rename_board') {
                    // Handle board renaming
                    const boardId = data.boardId;
                    const newName = data.name;
                    
                    if (boards[boardId] && newName) {
                        boards[boardId].name = newName;
                        debouncedSave();
                        
                        // Broadcast board list update to all clients
                        broadcast(JSON.stringify({
                            type: 'boards_list',
                            boards: Object.keys(boards).map(id => ({ id, name: boards[id].name }))
                        }));
                        
                        console.log(`Board ${boardId} renamed to: ${newName}`);
                    }
                    
                } else if (data.type === 'delete_board') {
                    // Handle board deletion
                    const boardId = data.boardId;
                    
                    // Don't allow deleting the default board
                    if (boardId === 'default') {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Cannot delete the default board'
                        }));
                        return;
                    }
                    
                    if (boards[boardId]) {
                        // Delete the board
                        delete boards[boardId];
                        debouncedSave();
                        
                        // Move all clients on this board to the default board
                        for (const [client, info] of clients.entries()) {
                            if (info.currentBoard === boardId) {
                                info.currentBoard = 'default';
                                clients.set(client, info);
                                
                                // Send the default board state to affected clients
                                client.send(JSON.stringify({
                                    type: 'board_state',
                                    boardId: 'default',
                                    state: boards.default
                                }));
                            }
                        }
                        
                        // Broadcast board list update to all clients
                        broadcast(JSON.stringify({
                            type: 'boards_list',
                            boards: Object.keys(boards).map(id => ({ id, name: boards[id].name }))
                        }));
                        
                        console.log(`Board ${boardId} deleted`);
                    }
                    
                } else if (data.type === 'draw' || data.type === 'erase') {
                    // Add username to the action if available
                    if (clientInfo && clientInfo.username) {
                        data.username = clientInfo.username;
                    }
                    
                    // Add the action to board state
                    if (boards[boardId]) {
                        boards[boardId].actions.push(data);
                        debouncedSave();
                    }
                    
                    // Broadcast to clients on the same board
                    broadcastToBoard(boardId, JSON.stringify(data), ws);
                    
                } else if (data.type === 'undo') {
                    // Find the last action by this client and remove it
                    if (boards[boardId]) {
                        for (let i = boards[boardId].actions.length - 1; i >= 0; i--) {
                            if (boards[boardId].actions[i].clientId === clientId) {
                                boards[boardId].actions.splice(i, 1);
                                break;
                            }
                        }
                        debouncedSave();
                        
                        // Broadcast the updated state to clients on the same board
                        broadcastToBoard(boardId, JSON.stringify({ 
                            type: 'update', 
                            state: boards[boardId],
                            boardId: boardId
                        }));
                    }
                    
                } else if (data.type === 'clear') {
                    // Clear only the current board
                    if (boards[boardId]) {
                        boards[boardId].actions = [];
                        debouncedSave();
                        
                        // Broadcast clear command to clients on the same board
                        broadcastToBoard(boardId, JSON.stringify({ 
                            type: 'clear',
                            boardId: boardId
                        }));
                    }
                    
                } else if (data.type === 'clear_user') {
                    // Filter out actions by the specified username on the current board
                    if (data.username && boards[boardId]) {
                        boards[boardId].actions = boards[boardId].actions.filter(action => action.username !== data.username);
                        debouncedSave();
                        
                        // Broadcast the clear_user command to clients on the same board
                        broadcastToBoard(boardId, JSON.stringify({ 
                            type: 'clear_user', 
                            username: data.username,
                            boardId: boardId
                        }));
                    }
                    
                } else if (data.type === 'pan' || data.type === 'zoom') {
                    // Don't save view state changes, just broadcast to others on the same board
                    broadcastToBoard(boardId, JSON.stringify(data), ws);
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
            saveBoardsState();
        }
    }, 60000); // Force save every minute
});