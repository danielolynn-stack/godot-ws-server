const WebSocket = require('ws');
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

let rooms = {}; // { "ABCD": [ws1, ws2] }

console.log(`🌐 WebSocket server spuštěn na portu ${PORT}`);

wss.on('connection', (ws) => {
    console.log("🎮 Nový klient připojen");

    ws.on('message', (msg) => {
        let data;
        try {
            data = JSON.parse(msg); // { action: "create/join", code: "ABCD" }
        } catch(e) {
            console.log("❌ Chyba při parsování zprávy:", msg);
            ws.send(JSON.stringify({ action: "error", message: "Invalid JSON" }));
            return;
        }

        console.log("📩 Zpráva od klienta:", data);

        if(data.action === "create") {
            if(rooms[data.code]) {
                // pokoj s tímto kódem už existuje
                ws.send(JSON.stringify({ action: "error", message: "Room code already exists" }));
                console.log(`❌ Nelze vytvořit pokoj, kód ${data.code} už existuje`);
            } else {
                rooms[data.code] = [ws];
                ws.send(JSON.stringify({ action: "waiting", code: data.code }));
                console.log(`✅ Vytvořen nový pokoj s kódem ${data.code}`);
                _logRooms();
            }
        }
        else if(data.action === "join") {
            if(rooms[data.code]) {
                rooms[data.code].push(ws);
                // upozornit všechny hráče v pokoji, že jsou spojeni
                rooms[data.code].forEach(client => {
                    client.send(JSON.stringify({ action: "connected", code: data.code, players: rooms[data.code].length }));
                });
                console.log(`🎮 Klient připojen do pokoje ${data.code}`);
                _logRooms();
            } else {
                ws.send(JSON.stringify({ action: "error", message: "Room not found" }));
                console.log(`❌ Pokus o připojení do neexistujícího pokoje ${data.code}`);
            }
        } else {
            ws.send(JSON.stringify({ action: "error", message: "Unknown action" }));
            console.log("❌ Neznámá akce:", data.action);
        }
    });

    ws.on('close', () => {
        console.log("❌ Klient odpojen");
        // odebrat ws z rooms
        for (let code in rooms) {
            rooms[code] = rooms[code].filter(c => c !== ws);
            if (rooms[code].length === 0) {
                delete rooms[code];
                console.log(`🗑️ Pokoj ${code} byl smazán (nikdo připojen)`);
            }
        }
        _logRooms();
    });
});

// Pomocná funkce pro log aktuálních pokojů
function _logRooms() {
    console.log("🗂️ Aktuální pokoje:");
    for (let code in rooms) {
        console.log(`  - ${code}: ${rooms[code].length} hráč(ů)`);
    }
}
