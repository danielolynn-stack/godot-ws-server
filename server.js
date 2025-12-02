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
let updateCounts = {};   // { roomCode: počet update_position zpráv }
let lastLogTime = Date.now();
const LOG_INTERVAL = 10000; // 10 sekund

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
        let data;
        try {
            data = JSON.parse(msg.toString());
        } catch (e) {
            ws.send(JSON.stringify({ action: "error", message: "Invalid JSON" }));
            return;
        }

        // --- LOG RAW/PARSED pro debug (jen když chcete) ---
        // console.log("📩 RAW:", msg.toString());
        // console.log("📨 PARSED:", data);

        // CREATE
        if (data.action === "create") {
            if (rooms[data.code]) {
                ws.send(JSON.stringify({ action: "error", message: "Room code exists" }));
                return;
            }
            rooms[data.code] = [ws];
            ws.send(JSON.stringify({ action: "waiting", code: data.code }));
            console.log("🆕 Vytvořen pokoj:", data.code);
        }

        // JOIN
        else if (data.action === "join") {
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

        // UPDATE_POSITION
        else if (data.action === "update_position") {
            // zjistit, ve kterém pokoji je klient
            let roomCode = null;
            for (let code in rooms) {
                if (rooms[code].includes(ws)) {
                    roomCode = code;
                    break;
                }
            }
            if (roomCode) {
                // poslat všem ostatním klientům v pokoji
                rooms[roomCode].forEach(c => {
                    if (c !== ws) {
                        c.send(JSON.stringify({
                            action: "update_position",
                            position: data.position
                        }));
                    }
                });

                // zvýšit počítadlo
                if (!updateCounts[roomCode]) updateCounts[roomCode] = 0;
                updateCounts[roomCode]++;
            }
        }

        // ERROR pro neznámé akce
        else {
            ws.send(JSON.stringify({ action: "error", message: "Unknown action" }));
        }

        // --- log souhrnně každých 10 sekund ---
        const now = Date.now();
        if (now - lastLogTime >= LOG_INTERVAL) {
            for (let code in updateCounts) {
                console.log(`📊 Pokoj ${code}: Joiner poslal ${updateCounts[code]} update_position zpráv`);
                updateCounts[code] = 0; // reset počítadla
            }
            lastLogTime = now;
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
console.log(`🚀 HTTP/WebSocket server běží na portu ${PORT}`);
