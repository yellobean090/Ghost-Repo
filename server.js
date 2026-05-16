const { WebSocketServer } = require("ws");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3001;

const USERS = {
  ghost_alpha: { pass: "alpha@7749", alias: "ALPHA" },
  ghost_beta:  { pass: "beta@3382",  alias: "BETA"  },
};

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.url === "/ping") {
    res.writeHead(200);
    res.end("GHOST SERVER ONLINE");
  } else if (req.url === "/" || req.url === "/index.html") {
    const filePath = path.join(__dirname, "index.html");
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end("Could not load index.html");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocketServer({ server });

// track connected authenticated clients: username -> ws
const connected = {};

function broadcast(fromAlias, text, excludeWs = null) {
  const payload = JSON.stringify({ type: "msg", alias: fromAlias, text, ts: Date.now() });
  for (const ws of Object.values(connected)) {
    if (ws !== excludeWs && ws.readyState === 1) {
      ws.send(payload);
    }
  }
}

function sendTo(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

wss.on("connection", (ws) => {
  ws.username = null;
  console.log("[+] New connection");

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // AUTH
    if (msg.type === "auth") {
      const user = USERS[msg.username];
      if (!user || user.pass !== msg.password) {
        sendTo(ws, { type: "auth_fail", reason: "Invalid credentials." });
        return;
      }
      if (connected[msg.username]) {
        sendTo(ws, { type: "auth_fail", reason: "Already connected from another session." });
        return;
      }
      ws.username = msg.username;
      ws.alias = user.alias;
      connected[msg.username] = ws;

      sendTo(ws, { type: "auth_ok", alias: user.alias });
      console.log(`[AUTH] ${user.alias} connected`);

      // notify the other person if online
      const other = Object.keys(connected).find(u => u !== msg.username);
      if (other) {
        sendTo(connected[other], { type: "sys", text: `${user.alias} has joined the session.` });
        sendTo(ws, { type: "sys", text: `${USERS[other].alias} is already here.` });
      } else {
        sendTo(ws, { type: "sys", text: "Waiting for your contact to connect..." });
      }
      return;
    }


    // TYPING
    if (msg.type === "typing") {
      if (!ws.username) return;
      // relay to the other connected user
      for (const [uname, sock] of Object.entries(connected)) {
        if (uname !== ws.username && sock.readyState === 1) {
          sendTo(sock, { type: "typing", alias: ws.alias, active: !!msg.active });
        }
      }
    }
    // TYPING
    if (msg.type === "typing") {
      if (!ws.username) return;
      const payload = JSON.stringify({ type: "typing", alias: ws.alias, typing: msg.typing });
      for (const [uname, client] of Object.entries(connected)) {
        if (uname !== ws.username && client.readyState === 1) {
          client.send(payload);
        }
      }
      return;
    }

    // CHAT
    if (msg.type === "chat") {
      if (!ws.username) return;
      console.log(`[MSG] ${ws.alias}: ${msg.text}`);
      // echo back to sender with confirmation
      sendTo(ws, { type: "msg_sent", alias: ws.alias, text: msg.text, ts: Date.now() });
      // send to everyone else
      broadcast(ws.alias, msg.text, ws);
    }
  });

  ws.on("close", () => {
    if (ws.username) {
      delete connected[ws.username];
      console.log(`[-] ${ws.alias} disconnected`);
      broadcast("SYS", `${ws.alias} has left the session.`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n  GHOST SERVER running on port ${PORT}`);
  console.log(`  Waiting for connections...\n`);
});
