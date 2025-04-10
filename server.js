const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid'); // Add UUID for unique identifiers

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server }); // WebSocket on root path

const BOARDS_FILE = 'whiteboard.json';
const USERS_FILE = 'users.json';
let boards = {
    default: { name: "Default Board", actions: [] }
};
let users = {
    users: [
        {
            id: "shaun",
            username: "Shaun",
            isAdmin: true
        }
    ],
    boardAccess: {
        default: {
            readAccess: ["*"],
            writeAccess: ["*"]
        }
    }
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

async function loadUsersState() {
    try {
        const data = await fs.readFile(USERS_FILE, 'utf8');
        users = JSON.parse(data);
        console.log(`Loaded ${users.users.length} users`);
    } catch (error) {
        console.log('No existing users state found, starting fresh');
        users = {
            users: [
                {
                    id: "shaun",
                    username: "Shaun",
                    isAdmin: true
                }
            ],
            boardAccess: {
                default: {
                    readAccess: ["*"],
                    writeAccess: ["*"]
                }
            }
        };
        // Save the default users state
        await saveUsersState();
    }
}

async function saveUsersState() {
    try {
        await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
    } catch (error) {
        console.error('Error saving users state:', error);
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

// Check if a user has read access to a board
function hasReadAccess(username, boardId) {
    if (!users.boardAccess[boardId]) {
        return false;
    }
    
    // Check if user is admin
    const userInfo = users.users.find(u => u.username === username);
    if (userInfo && userInfo.isAdmin) {
        return true;
    }
    
    const readAccess = users.boardAccess[boardId].readAccess;
    return readAccess.includes(username) || readAccess.includes("*");
}

// Check if a user has write access to a board
function hasWriteAccess(username, boardId) {
    if (!users.boardAccess[boardId]) {
        return false;
    }
    
    // Check if user is admin
    const userInfo = users.users.find(u => u.username === username);
    if (userInfo && userInfo.isAdmin) {
        return true;
    }
    
    const writeAccess = users.boardAccess[boardId].writeAccess;
    return writeAccess.includes(username) || writeAccess.includes("*");
}

// Get user info by username
function getUserByUsername(username) {
    return users.users.find(u => u.username === username);
}

// Function to check if a username is randomly generated
function isRandomlyGeneratedUsername(username) {
    // List of words used in random username generation
    const adjectives = ['Creative', 'Artistic', 'Clever', 'Bright', 'Colorful', 'Dazzling', 'Elegant', 'Fancy', 'Glowing', 'Happy'];
    const nouns = ['Artist', 'Painter', 'Creator', 'Designer', 'Sketcher', 'Drawer', 'Illustrator', 'Doodler', 'Visionary', 'Genius'];
    
    // Check if the username contains any of our adjectives
    const hasAdjective = adjectives.some(adj => username.includes(adj));
    
    // Check if the username contains any of our nouns
    const hasNoun = nouns.some(noun => username.includes(noun));
    
    // Check if the username contains numbers
    const hasNumbers = /\d/.test(username);
    
    // Consider it randomly generated if it contains both an adjective/noun AND numbers
    return (hasAdjective || hasNoun) && hasNumbers;
}

// Add or update a user
function addOrUpdateUser(username) {
    // Check if the username appears to be randomly generated
    const isRandomUsername = isRandomlyGeneratedUsername(username);
    
    const existingUser = users.users.find(u => u.username === username);
    if (!existingUser && !isRandomUsername) {
        // Only store non-random usernames
        const userId = username.toLowerCase().replace(/[^a-z0-9]/g, '');
        users.users.push({
            id: userId,
            username: username,
            isAdmin: false
        });
        saveUsersState();
    }
    return users.users.find(u => u.username === username) || {
        id: username.toLowerCase().replace(/[^a-z0-9]/g, ''),
        username: username,
        isAdmin: false
    };
}

// Load both boards and users state
Promise.all([loadBoardsState(), loadUsersState()]).then(() => {
    wss.on('connection', (ws) => {
        const clientId = uuidv4();
        clients.set(ws, { 
            id: clientId, 
            username: null,
            currentBoard: 'default', // Default board on connection
            isAdmin: false
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
                        
                        // Check if user is admin
                        const userInfo = getUserByUsername(data.username);
                        if (userInfo) {
                            clientInfo.isAdmin = userInfo.isAdmin;
                        } else {
                            // Add new user
                            const newUser = addOrUpdateUser(data.username);
                            clientInfo.isAdmin = newUser.isAdmin;
                        }
                        
                        clients.set(ws, clientInfo);
                        console.log(`Client ${clientId} set username: ${data.username}, isAdmin: ${clientInfo.isAdmin}`);
                        
                        // Send admin status to client
                        ws.send(JSON.stringify({
                            type: 'admin_status',
                            isAdmin: clientInfo.isAdmin
                        }));
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
                        // Check if user has read access to the board
                        if (clientInfo.username && hasReadAccess(clientInfo.username, newBoardId)) {
                        // Update client's current board
                        clientInfo.currentBoard = newBoardId;
                        clients.set(ws, clientInfo);
                        
                        // Send the board state to the client
                        ws.send(JSON.stringify({
                            type: 'board_state',
                            boardId: newBoardId,
                                state: boards[newBoardId],
                                canWrite: hasWriteAccess(clientInfo.username, newBoardId)
                        }));
                        
                        console.log(`Client ${clientId} switched to board: ${newBoardId}`);
                        } else {
                            // Send access denied message
                            ws.send(JSON.stringify({
                                type: 'error',
                                message: 'Access denied to this board'
                            }));
                        }
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
                    
                    // Set default access rights for the new board
                    users.boardAccess[newBoardId] = {
                        readAccess: [clientInfo.username],
                        writeAccess: [clientInfo.username]
                    };
                    
                    // Save boards and users state
                    debouncedSave();
                    saveUsersState();
                    
                    // Switch client to the new board
                    clientInfo.currentBoard = newBoardId;
                    clients.set(ws, clientInfo);
                    
                    // Send the new board state to the client
                    ws.send(JSON.stringify({
                        type: 'board_state',
                        boardId: newBoardId,
                        state: boards[newBoardId],
                        canWrite: true
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
                        // Check if user has write access or is admin
                        if (clientInfo.isAdmin || (clientInfo.username && hasWriteAccess(clientInfo.username, boardId))) {
                        boards[boardId].name = newName;
                        debouncedSave();
                        
                        // Broadcast board list update to all clients
                        broadcast(JSON.stringify({
                            type: 'boards_list',
                            boards: Object.keys(boards).map(id => ({ id, name: boards[id].name }))
                        }));
                        
                        console.log(`Board ${boardId} renamed to: ${newName}`);
                        } else {
                            // Send access denied message
                            ws.send(JSON.stringify({
                                type: 'error',
                                message: 'You do not have permission to rename this board'
                            }));
                        }
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
                        // Check if user is admin
                        if (clientInfo.isAdmin) {
                        // Delete the board
                        delete boards[boardId];
                            
                            // Delete access rights for the board
                            if (users.boardAccess[boardId]) {
                                delete users.boardAccess[boardId];
                                saveUsersState();
                            }
                            
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
                                        state: boards.default,
                                        canWrite: hasWriteAccess(info.username, 'default')
                                }));
                            }
                        }
                        
                        // Broadcast board list update to all clients
                        broadcast(JSON.stringify({
                            type: 'boards_list',
                            boards: Object.keys(boards).map(id => ({ id, name: boards[id].name }))
                        }));
                        
                        console.log(`Board ${boardId} deleted`);
                        } else {
                            // Send access denied message
                            ws.send(JSON.stringify({
                                type: 'error',
                                message: 'Only admins can delete boards'
                            }));
                        }
                    }
                    
                } else if (data.type === 'update_access') {
                    // Handle access rights update
                    if (!clientInfo.isAdmin) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Only admins can update access rights'
                        }));
                        return;
                    }
                    
                    const { boardId, username, readAccess, writeAccess } = data;
                    
                    if (boards[boardId]) {
                        // Ensure board access entry exists
                        if (!users.boardAccess[boardId]) {
                            users.boardAccess[boardId] = {
                                readAccess: ["*"],
                                writeAccess: ["*"]
                            };
                        }
                        
                        // Update access rights
                        if (readAccess === true) {
                            if (!users.boardAccess[boardId].readAccess.includes(username)) {
                                users.boardAccess[boardId].readAccess.push(username);
                            }
                        } else if (readAccess === false) {
                            users.boardAccess[boardId].readAccess = users.boardAccess[boardId].readAccess.filter(u => u !== username);
                        }
                        
                        if (writeAccess === true) {
                            if (!users.boardAccess[boardId].writeAccess.includes(username)) {
                                users.boardAccess[boardId].writeAccess.push(username);
                            }
                        } else if (writeAccess === false) {
                            users.boardAccess[boardId].writeAccess = users.boardAccess[boardId].writeAccess.filter(u => u !== username);
                        }
                        
                        // Save users state
                        saveUsersState();
                        
                        // Send updated access rights to admin
                        ws.send(JSON.stringify({
                            type: 'access_rights',
                            boardAccess: users.boardAccess
                        }));
                        
                        console.log(`Access rights updated for board ${boardId} and user ${username}`);
                        
                        // Update write access for affected clients
                        for (const [client, info] of clients.entries()) {
                            if (info.username === username && info.currentBoard === boardId) {
                                client.send(JSON.stringify({
                                    type: 'write_access',
                                    canWrite: hasWriteAccess(username, boardId)
                                }));
                            }
                        }
                    }
                    
                } else if (data.type === 'get_users') {
                    // Handle request for users list (admin only)
                    if (clientInfo.isAdmin) {
                        ws.send(JSON.stringify({
                            type: 'users_list',
                            users: users.users
                        }));
                        
                        // Also send access rights
                        ws.send(JSON.stringify({
                            type: 'access_rights',
                            boardAccess: users.boardAccess
                        }));
                    }
                    
                } else if (data.type === 'draw' || data.type === 'erase') {
                    // Check write access
                    if (clientInfo.username && hasWriteAccess(clientInfo.username, boardId)) {
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
                    } else {
                        // Send access denied message
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'You do not have write access to this board'
                        }));
                    }
                    
                } else if (data.type === 'undo') {
                    // Check write access
                    if (clientInfo.username && hasWriteAccess(clientInfo.username, boardId)) {
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
                    } else {
                        // Send access denied message
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'You do not have write access to this board'
                        }));
                    }
                    
                } else if (data.type === 'clear') {
                    // Check if user is admin or has write access
                    if (clientInfo.isAdmin || (clientInfo.username && hasWriteAccess(clientInfo.username, boardId))) {
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
                    } else {
                        // Send access denied message
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'You do not have permission to clear this board'
                        }));
                    }
                    
                } else if (data.type === 'clear_user') {
                    // Check if user is admin or if they're clearing their own content
                    if (clientInfo.isAdmin || (data.username === clientInfo.username)) {
                        // Filter out actions by the specified username on the current board
                        if (data.username && boards[boardId]) {
                            console.log(`Clearing content for user ${data.username} on board ${boardId}`);
                            
                            // Count actions before filtering
                            const beforeCount = boards[boardId].actions.length;
                            
                            // Filter out actions by the specified username
                            boards[boardId].actions = boards[boardId].actions.filter(action => {
                                return action.username !== data.username;
                            });
                            
                            // Count actions after filtering
                            const afterCount = boards[boardId].actions.length;
                            console.log(`Removed ${beforeCount - afterCount} actions for user ${data.username}`);
                            
                            debouncedSave();
                            
                            // Broadcast the clear_user command to clients on the same board
                            broadcastToBoard(boardId, JSON.stringify({ 
                                type: 'clear_user', 
                                username: data.username,
                                boardId: boardId
                            }));
                        } else {
                            console.error(`Invalid clear_user request: username=${data.username}, boardId=${boardId}`);
                            ws.send(JSON.stringify({
                                type: 'error',
                                message: 'Invalid clear request: missing username or board not found'
                            }));
                        }
                    } else {
                        // Send access denied message
                        console.error(`Access denied: ${clientInfo.username} tried to clear content for ${data.username}`);
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Only admins can clear other users\' content'
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
    const PORT = process.env.PORT || 3010;
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