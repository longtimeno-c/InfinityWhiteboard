const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const fs = require('fs').promises;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server }); // WebSocket on root path

const BOARD_FILE = 'whiteboard.json';
let boardState = { actions: [] };
const drawings = []; // Store all drawings server-side

async function loadBoardState() {
    try {
        const data = await fs.readFile(BOARD_FILE, 'utf8');
        boardState = JSON.parse(data);
    } catch (error) {
        console.log('No existing board state found, starting fresh');
    }
}

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
        ws.send(JSON.stringify({ type: 'init', state: boardState }));

        // Send existing drawings to new clients
        ws.send(JSON.stringify({ type: 'init-canvas', drawings }));

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);

                if (data.type === 'undo' && boardState.actions.length > 0) {
                    boardState.actions.pop();
                    saveBoardState();
                } else if (data.type === 'redo') {
                    // Redo would require a redo stack, omitted for simplicity
                } else {
                    boardState.actions.push(data);
                    saveBoardState();
                }

                // Store the drawing data
                if (data.type === 'draw') {
                    drawings.push({
                        path: data.path,
                        color: data.color,
                        width: data.width,
                        id: ws.id
                    });
                } else if (data.type === 'erase') {
                    // Store eraser strokes separately
                    drawings.push({
                        path: data.path,
                        type: 'erase',
                        width: data.width,
                        id: ws.id
                    });
                }

                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(data));
                    }
                });
            } catch (error) {
                console.error('Error processing message:', error);
            }
        });

        ws.on('close', () => console.log('Client disconnected'));
    });

    wss.on('error', (error) => {
        console.error('WebSocket Server Error:', error);
    });

    // Serve static files (e.g., index.html)
    app.use(express.static('.'));

    // Start the server on port 3000
    const PORT = 3001;
    server.listen(PORT, () => {
        console.log(`HTTP and WebSocket server running on http://localhost:${PORT}`);
        console.log(`Expect Caddy to proxy https://watch.stream150.com and wss://watch.stream150.com to this server`);
    });

    // Add a route to save drawings to a file periodically
    setInterval(() => {
        const fs = require('fs');
        fs.writeFileSync('drawings.json', JSON.stringify(drawings));
    }, 60000); // Save every minute
});