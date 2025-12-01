const WebSocket = require('ws');
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

let rooms = {}; // { "ABCD": [ws1, ws2] }

wss.on('connection', (ws) => {
  ws.on('message', (msg) => {
    const data = JSON.parse(msg); // { action: "create/join", code: "ABCD" }
    
    if(data.action === "create") {
      rooms[data.code] = [ws];
      ws.send(JSON.stringify({ action: "waiting", code: data.code }));
    }
    else if(data.action === "join") {
      if(rooms[data.code]) {
        rooms[data.code].push(ws);
        // upozornit oba hráče, že jsou spojeni
        rooms[data.code].forEach(client => {
          client.send(JSON.stringify({ action: "connected", code: data.code }));
        });
      } else {
        ws.send(JSON.stringify({ action: "error", message: "Room not found" }));
      }
    }
  });

  ws.on('close', () => {
    // odebrat ws z rooms
    for (let code in rooms) {
      rooms[code] = rooms[code].filter(c => c !== ws);
      if (rooms[code].length === 0) delete rooms[code];
    }
  });
});
