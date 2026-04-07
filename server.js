const WebSocket = require('ws');
const http = require('http');
const Y = require('yjs');
const syncProtocol = require('y-protocols/sync');
const awarenessProtocol = require('y-protocols/awareness');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');

const messageSync = 0;
const messageAwareness = 1;
const messageQueryAwareness = 3;

/** @type {Map<string, { doc: Y.Doc, awareness: import('y-protocols/awareness').Awareness, conns: Set<WebSocket> }>} */
const rooms = new Map();

function parseRoom(reqUrl = '/') {
  const url = new URL(reqUrl, 'http://localhost');
  const room = decodeURIComponent(url.pathname.slice(1));
  return room || 'default';
}

function decodeAwarenessClientIds(update) {
  const decoder = decoding.createDecoder(update);
  const len = decoding.readVarUint(decoder);
  const ids = [];

  for (let i = 0; i < len; i += 1) {
    const clientId = decoding.readVarUint(decoder);
    ids.push(clientId);
    decoding.readVarUint(decoder);
    decoding.readVarString(decoder);
  }

  return ids;
}

function broadcast(roomState, payload, except = null) {
  for (const conn of roomState.conns) {
    if (conn !== except && conn.readyState === WebSocket.OPEN) {
      conn.send(payload);
    }
  }
}

function getRoomState(roomName) {
  let roomState = rooms.get(roomName);
  if (roomState) {
    return roomState;
  }

  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  const conns = new Set();
  roomState = { doc, awareness, conns };

  doc.on('update', (update, origin) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, update);
    broadcast(roomState, encoding.toUint8Array(encoder), origin || null);
  });

  awareness.on('update', ({ added, updated, removed }, origin) => {
    const changed = added.concat(updated, removed);
    if (changed.length === 0) {
      return;
    }

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changed)
    );
    broadcast(roomState, encoding.toUint8Array(encoder), origin || null);
  });

  rooms.set(roomName, roomState);
  return roomState;
}

function sendCurrentAwareness(conn, roomState) {
  const clientIds = Array.from(roomState.awareness.getStates().keys());
  if (clientIds.length === 0 || conn.readyState !== WebSocket.OPEN) {
    return;
  }

  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageAwareness);
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(roomState.awareness, clientIds)
  );
  conn.send(encoding.toUint8Array(encoder));
}

function handleMessage(conn, roomState, data) {
  const message = new Uint8Array(data);
  const decoder = decoding.createDecoder(message);
  const messageType = decoding.readVarUint(decoder);

  switch (messageType) {
    case messageSync: {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.readSyncMessage(decoder, encoder, roomState.doc, conn);
      if (encoding.length(encoder) > 1 && conn.readyState === WebSocket.OPEN) {
        conn.send(encoding.toUint8Array(encoder));
      }
      break;
    }
    case messageAwareness: {
      const update = decoding.readVarUint8Array(decoder);
      conn.awarenessClientIds = decodeAwarenessClientIds(update);
      awarenessProtocol.applyAwarenessUpdate(roomState.awareness, update, conn);
      break;
    }
    case messageQueryAwareness: {
      sendCurrentAwareness(conn, roomState);
      break;
    }
    default:
      break;
  }
}

const server = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain' });
  response.end('y-websocket server is running');
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (conn, req) => {
  const roomName = parseRoom(req.url);
  const roomState = getRoomState(roomName);

  conn.awarenessClientIds = [];
  roomState.conns.add(conn);

  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeSyncStep1(encoder, roomState.doc);
  conn.send(encoding.toUint8Array(encoder));
  sendCurrentAwareness(conn, roomState);

  conn.on('message', (data) => {
    handleMessage(conn, roomState, data);
  });

  conn.on('close', () => {
    roomState.conns.delete(conn);

    if (conn.awarenessClientIds.length > 0) {
      awarenessProtocol.removeAwarenessStates(roomState.awareness, conn.awarenessClientIds, conn);
    }

    if (roomState.conns.size === 0) {
      roomState.awareness.destroy();
      roomState.doc.destroy();
      rooms.delete(roomName);
    }
  });
});

const PORT = process.env.PORT || 1234;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Running y-websocket server on port ${PORT}`);
});