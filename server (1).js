'use strict';
// Servidor en línea de Real Life Simulator: un único mundo compartido para todos los jugadores.
// Solo reparte posiciones y mensajes de chat; la partida de cada jugador (dinero, casas...) sigue en su navegador.
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const MAX_PLAYERS = +process.env.MAX_PLAYERS || 60;
const TICK_MS = 100;

const players = new Map();
let nextId = 1;

const fs = require('fs');
const path = require('path');
// El propio servidor reparte el juego: quien abre su dirección entra directamente al mundo compartido.
const GAME_FILE = [path.join(__dirname, 'public', 'index.html'), path.join(__dirname, 'index.html')].find(f => fs.existsSync(f)) || path.join(__dirname, 'index.html');
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/' || url === '/index.html') {
    fs.readFile(GAME_FILE, (err, data) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Falta index.html (copia Real_Life_Simulator.html junto a server.js con el nombre index.html)'); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      res.end(data);
    });
  } else if (url === '/estado') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Real Life Simulator · jugadores conectados: ' + players.size);
  } else {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('No encontrado');
  }
});
const wss = new WebSocketServer({ server, maxPayload: 2048 });

const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').trim().slice(0, n);
const num = (v, lo, hi) => (typeof v === 'number' && isFinite(v)) ? Math.min(hi, Math.max(lo, v)) : null;
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const broadcast = (o, except) => {
  const d = JSON.stringify(o);
  for (const p of players.values()) if (p.ws !== except && p.ws.readyState === 1) p.ws.send(d);
};
const pub = p => ({ id: p.id, n: p.n, x: p.x, y: p.y, z: p.z, r: p.r, s: p.s, c: p.c, k: p.k, h: p.h });

wss.on('connection', ws => {
  if (players.size >= MAX_PLAYERS) { send(ws, { t: 'full' }); ws.close(1013); return; }
  let me = null, tokens = 40, lastT = Date.now(), lastChat = 0;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw, isBinary) => {
    if (isBinary) return;
    const now = Date.now();
    tokens = Math.min(40, tokens + (now - lastT) / 1000 * 40); lastT = now;   // máx. ~40 mensajes/s por jugador
    if (--tokens < 0) return;
    let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;

    if (m.t === 'j' && !me) {
      const id = String(nextId++);
      const n = clean(m.n, 14) || ('Jugador' + id);
      me = { id, n, x: 24, y: 0, z: 1.5, r: 0, s: 0, c: '', k: 0, h: 0, dirty: false, ws };
      send(ws, { t: 'w', id, n, p: [...players.values()].map(pub) });
      players.set(id, me);
      broadcast({ t: 'j', id, n }, ws);
      return;
    }
    if (!me) return;

    if (m.t === 'p') {
      const x = num(m.x, -500, 3000), y = num(m.y, -50, 300), z = num(m.z, -500, 3000), r = num(m.r, -10, 10), s = num(m.s, 0, 60);
      if (x === null || y === null || z === null || r === null) return;
      me.x = x; me.y = y; me.z = z; me.r = r; me.s = s === null ? 0 : s;
      me.c = (typeof m.c === 'string' && /^[a-z]{1,12}$/.test(m.c)) ? m.c : '';
      me.k = (Number.isInteger(m.k) && m.k >= 0 && m.k <= 0xffffff) ? m.k : 0;
      me.h = m.h ? 1 : 0;
      me.dirty = true;
    } else if (m.t === 'c') {
      if (now - lastChat < 700) return;
      const text = clean(m.m, 120);
      if (!text) return;
      lastChat = now;
      broadcast({ t: 'c', id: me.id, n: me.n, m: text });
    }
  });

  ws.on('close', () => {
    if (!me) return;
    players.delete(me.id);
    broadcast({ t: 'l', id: me.id });
  });
  ws.on('error', () => {});
});

// Reparte las posiciones de quienes se han movido, 10 veces por segundo
setInterval(() => {
  const arr = [];
  for (const p of players.values()) if (p.dirty) { p.dirty = false; arr.push([p.id, p.x, p.y, p.z, p.r, p.s, p.c, p.k, p.h]); }
  if (arr.length) broadcast({ t: 's', p: arr });
}, TICK_MS);

// Elimina conexiones muertas
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false; ws.ping();
  });
}, 30000);

server.listen(PORT, () => console.log('Servidor en línea escuchando en el puerto ' + PORT));
