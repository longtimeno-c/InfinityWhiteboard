const WebSocket = require('ws');
const fs = require('fs').promises;
const wss = new WebSocket.Server({ port: 3001 });

const BOARD_FILE = 'whiteboard.json';
let boardState = { actions: [] }; // Store all actions for persistence

// Load existing board state
async function loadBoardState() {
    try {
        const data = await fs.readFile(BOARD_FILE, 'utf8');
        boardState = JSON.parse(data);
    } catch (error) {
        console.log('No existing board state found, starting fresh');
    }
}

// Save board state
async function saveBoardState() {
    try {
        await fs.writeFile(BOARD_FILE, JSON.stringify(boardState));
    } catch (error) {
        console.error('Error saving board state:', error);
    }
}

loadBoardState().then(() => {
    wss.on('connection', (ws) => {
        console.log('New client connected');
        
        // Send current board state to new client
        ws.send(JSON.stringify({ type: 'init', state: boardState }));

        ws.on('message', (message) => {
            const data = JSON.parse(message);
            
            if (data.type !== 'undo' && data.type !== 'redo') {
                boardState.actions.push(data);
                saveBoardState();
            }

            // Broadcast to all clients
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(data));
                }
            });
        });

        ws.on('close', () => console.log('Client disconnected'));
    });

    wss.on('error', (error) => {
        console.error('WebSocket Server Error:', error);
    });

    console.log('WebSocket server running on ws://localhost:3001');
});