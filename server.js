const { WebSocketServer } = require("ws");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 3001;

const USERS = {
  ghost_alpha: { pass: "alpha@7749", alias: "ALPHA" },
  ghost_beta: { pass: "beta@3382", alias: "BETA" },
};

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  if (req.url === "/ping") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("GHOST SERVER ONLINE");
    return;
  }

  if (req.url === "/" || req.url === "/index.html") {
    const filePath = path.join(__dirname, "index.html");
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end("Could not load index.html");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(data);
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });
const connected = Object.create(null);

// Messages are intentionally never stored. They exist only in the browser DOM
// while a client is connected and in transit through the WebSocket connection.
function broadcastSystem(text, excludeWs = null) {
  const payload = JSON.stringify({ type: "sys", text });
  for (const ws of Object.values(connected)) {
    if (ws !== excludeWs && ws.readyState === 1) ws.send(payload);
  }
}

function sendTo(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function clearSessionIfEmpty() {
  if (Object.keys(connected).length === 0) {
    // There is deliberately no message/session history to delete.
    // Keeping this function explicit prevents future code from accidentally
    // introducing persistent chat storage without revisiting the privacy rule.
  }
}

wss.on("connection", (ws) => {
  ws.username = null;
  ws.alias = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "auth") {
      const username = typeof msg.username === "string" ? msg.username : "";
      const password = typeof msg.password === "string" ? msg.password : "";
      const user = USERS[username];

      if (!user || user.pass !== password) {
        sendTo(ws, { type: "auth_fail", reason: "Invalid credentials." });
        return;
      }

      if (connected[username]) {
        sendTo(ws, { type: "auth_fail", reason: "Already connected from another session." });
        return;
      }

      ws.username = username;
      ws.alias = user.alias;
      connected[username] = ws;

      sendTo(ws, { type: "auth_ok", alias: user.alias });

      const other = Object.keys(connected).find((u) => u !== username);
      if (other) {
        sendTo(connected[other], { type: "sys", text: `${user.alias} has joined the session.` });
        sendTo(ws, { type: "sys", text: `${USERS[other].alias} is already here.` });
      } else {
        sendTo(ws, { type: "sys", text: "Waiting for your contact to connect..." });
      }
      return;
    }

    if (!ws.username) return;

    if (msg.type === "typing") {
      const payload = {
        type: "typing",
        alias: ws.alias,
        typing: !!msg.typing,
      };

      for (const [username, client] of Object.entries(connected)) {
        if (username !== ws.username && client.readyState === 1) {
          client.send(JSON.stringify(payload));
        }
      }
      return;
    }

    if (msg.type === "chat") {
      const text = typeof msg.text === "string" ? msg.text.trim() : "";
      if (!text || text.length > 2000) return;

      // Do not log or persist message content on the server.
      sendTo(ws, { type: "msg_sent" });

      const payload = JSON.stringify({
        type: "msg",
        alias: ws.alias,
        text,
        ts: Date.now(),
      });

      for (const [username, client] of Object.entries(connected)) {
        if (username !== ws.username && client.readyState === 1) {
          client.send(payload);
        }
      }
      return;
    }
  });

  ws.on("close", () => {
    if (!ws.username) return;

    const username = ws.username;
    const alias = ws.alias;

    if (connected[username] === ws) {
      delete connected[username];
    }

    // When the second/last participant leaves, the in-memory connection map
    // becomes empty. Since no messages are persisted, the conversation is gone.
    clearSessionIfEmpty();
    broadcastSystem(`${alias} has left the session.`);
  });

  ws.on("error", () => {
    // Avoid writing chat content or credentials to server logs.
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`GHOST SERVER running on port ${PORT}`);
});
