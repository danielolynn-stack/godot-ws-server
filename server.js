const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;

// Vytvoříme HTTP server (Render to vyžaduje)
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end("WebSocket server running.\n");
});

// WebSocket navázaný na HTTP server
const wss = new WebSocket.Server({ noServer: true });

let rooms = {};

console.log(`🚀 Server běží na portu ${PORT}`);

server.on("upgrade", (req, socket, head) => {
    if (req.url === "/ws") {
        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit("connection", ws, req);
        });
    } else {
        socket.destroy();
    }
});

wss.on("connection", (ws) => {
    console.log("🟢 Nový WebSocket klient");

    ws.on("message", (msg) => {
        console.log("📩 RAW:", msg.toString());

        let data;
        try {
            data = JSON.parse(msg.toString());
        } catch (e) {
            ws.send(JSON.stringify({ action: "error", message: "Invalid JSON" }));
            return;
        }

        console.log("📨 PARSED:", data);

        if (data.action === "create") {
            if (rooms[data.code]) {
                ws.send(JSON.stringify({ action: "error", message: "Room code exists" }));
                return;
            }
            rooms[data.code] = [ws];
            ws.send(JSON.stringify({ action: "waiting", code: data.code }));
            console.log("🆕 Vytvořen pokoj:", data.code);
        }

        if (data.action === "join") {
            if (!rooms[data.code]) {
                ws.send(JSON.stringify({ action: "error", message: "Room not found" }));
                return;
            }
            rooms[data.code].push(ws);
            rooms[data.code].forEach(c => {
                c.send(JSON.stringify({ action: "connected", code: data.code }));
            });
            console.log("🔗 Připojen hráč do:", data.code);
        }
    });

    ws.on("close", () => {
        console.log("❌ Klient odpojen");
        for (let code in rooms) {
            rooms[code] = rooms[code].filter(c => c !== ws);
            if (rooms[code].length === 0) delete rooms[code];
        }
    });
});

server.listen(PORT);
