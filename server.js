const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 443;

// Vytvoříme HTTP server (Render to vyžaduje)
const server = http.createServer((req, res) => {
	res.writeHead(200);
	res.end("WebSocket server running.\n");
});

// WebSocket navázaný na HTTP server
const wss = new WebSocket.Server({ noServer: true });

let rooms = {};              // { code: [wsHost, wsJoiner?] }
let updateCounts = {};       // { code: count }
let joinTimeouts = {};       // { roomCode: timeoutID }

let lastLogTime = Date.now();
const LOG_INTERVAL = 10000; // 10 sekund
const JOIN_TIMEOUT = 10 * 60 * 1000; // 10 minut v ms

// Rate limit (server-side) - zahodit zprávy rychleji než toto (ms)
const RATE_LIMIT_MS = 20; // maximálně ~50 zpráv/s na klienta

// WeakMap pro poslední čas update pro každý ws
const lastUpdate = new WeakMap();

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

	// --- message handler ---
	ws.on("message", (msg) => {
		const raw = msg.toString();

		// Pokusíme se o JSON (pro systémové akce). Pokud to není JSON, použijeme raw string forwarding.
		let data;
		let isJson = true;
		try {
			data = JSON.parse(raw);
		} catch (e) {
			isJson = false;
		}

		// --- Pokud je to JSON (create/join/connected/...) ---
		if (isJson && data && typeof data.action === "string") {
			// CREATE
			if (data.action === "create") {
				if (!data.code) {
					ws.send(JSON.stringify({ action: "error", message: "Missing room code" }));
					return;
				}
				if (rooms[data.code]) {
					ws.send(JSON.stringify({ action: "error", message: "Room code exists" }));
					return;
				}
				rooms[data.code] = [ws];
				ws.roomCode = data.code;
				ws.role = "host";
				ws.send(JSON.stringify({ action: "waiting", code: data.code }));
				console.log("🆕 Vytvořen pokoj:", data.code);

				// Start join timeout
				joinTimeouts[data.code] = setTimeout(() => {
					if (rooms[data.code] && rooms[data.code].length === 1) {
						const hostWs = rooms[data.code][0];
						if (hostWs && hostWs.readyState === WebSocket.OPEN) {
							hostWs.send(JSON.stringify({
								action: "timeout_disconnect",
								message: "Joiner se nepřipojil do 10 minut"
							}));
							hostWs.close();
						}
						delete rooms[data.code];
						delete joinTimeouts[data.code];
						console.log(`⏰ Pokoj ${data.code} vypršel, hostitel odpojen`);
					}
				}, JOIN_TIMEOUT);

				return;
			}

			// JOIN
			if (data.action === "join") {
				if (!data.code) {
					ws.send(JSON.stringify({ action: "error", message: "Missing room code" }));
					return;
				}
				if (!rooms[data.code]) {
					ws.send(JSON.stringify({ action: "error", message: "Room not found" }));
					return;
				}
				if (rooms[data.code].length >= 2) {
					ws.send(JSON.stringify({ action: "error", message: "Room full" }));
					return;
				}

				// joiner připojen -> zrušit timeout
				if (joinTimeouts[data.code]) {
					clearTimeout(joinTimeouts[data.code]);
					delete joinTimeouts[data.code];
				}

				rooms[data.code].push(ws);
				ws.roomCode = data.code;
				ws.role = "joiner";

				rooms[data.code].forEach(c => {
					if (c && c.readyState === WebSocket.OPEN) {
						c.send(JSON.stringify({ action: "connected", code: data.code }));
					}
				});
				console.log("🔗 Připojen hráč do:", data.code);
				return;
			}

			// Pokud chceš zachovat update_position přes JSON jako záložní
			if (data.action === "update_position") {
				// Najít roomCode (může být uložený na ws)
				let roomCode = ws.roomCode || null;
				if (!roomCode) {
					// fallback: prohledat rooms (méně efektivní)
					for (let code in rooms) {
						if (rooms[code].includes(ws)) {
							roomCode = code;
							break;
						}
					}
				}
				if (roomCode) {
					// Server-side rate limit
					const now = Date.now();
					const last = lastUpdate.get(ws) || 0;
					if (now - last < RATE_LIMIT_MS) {
						return; // zahodíme přebytečné zprávy
					}
					lastUpdate.set(ws, now);

					rooms[roomCode].forEach(c => {
						if (c !== ws && c.readyState === WebSocket.OPEN) {
							// přepošleme JSON (záložka)
							c.send(JSON.stringify({
								action: "update_position",
								position: data.position
							}));
						}
					});
					if (!updateCounts[roomCode]) updateCounts[roomCode] = 0;
					updateCounts[roomCode]++;
				}
				return;
			}

			// Neznámá JSON akce
			ws.send(JSON.stringify({ action: "error", message: "Unknown action" }));
			return;
		}

		// --- Pokud to NENÍ JSON: předpokládáme, že jde o RAW string s pozicí ---
		// Musíme vědět, v jaké místnosti klient je
		const roomCode = ws.roomCode;
		if (!roomCode || !rooms[roomCode]) {
			// Nejsme ve hře -> ignorujeme raw zprávu (možná klient ještě neudělal create/join)
			// Nezaznamenáváme chybu (raw zprávy budou běžné až po připojení)
			return;
		}

		// Server-side rate limiting: zabrání zahlcení
		{
			const now = Date.now();
			const last = lastUpdate.get(ws) || 0;
			if (now - last < RATE_LIMIT_MS) {
				// zahodit
				return;
			}
			lastUpdate.set(ws, now);
		}

		// Přešleme raw string všem v místnosti kromě odesílatele
		rooms[roomCode].forEach(c => {
			if (c !== ws && c.readyState === WebSocket.OPEN) {
				// posíláme raw text BEZ jakéhokoliv JSONu -> klient přijme přesně to, co poslal odesílatel
				try {
					c.send(raw);
				} catch (e) {
					// pokud se posílání nezdaří, ignorujeme (další očista při close)
				}
			}
		});

		// Statistiky
		if (!updateCounts[roomCode]) updateCounts[roomCode] = 0;
		updateCounts[roomCode]++;

		// --- log souhrnně každých 10 sekund ---
		const now = Date.now();
		if (now - lastLogTime >= LOG_INTERVAL) {
			for (let code in updateCounts) {
				console.log(`📊 Pokoj ${code}: posláno ${updateCounts[code]} realtime zpráv (raw/Text)`);
				updateCounts[code] = 0;
			}
			lastLogTime = now;
		}
	});

	// --- close handler ---
	ws.on("close", () => {
		console.log("❌ Klient odpojen");
		for (let code in rooms) {
			rooms[code] = rooms[code].filter(c => c !== ws);
			if (rooms[code].length === 0) {
				delete rooms[code];
				if (joinTimeouts[code]) {
					clearTimeout(joinTimeouts[code]);
					delete joinTimeouts[code];
				}
				console.log(`🗑️ Pokoj ${code} byl zrušen (žádní klienti).`);
			}
		}
	});
});

server.listen(PORT);
console.log(`🚀 HTTP/WebSocket server běží na portu ${PORT}`);

