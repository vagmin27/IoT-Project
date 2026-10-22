/**
 * Server-Sent Events (SSE) Manager
 * Manages active HTTP SSE connections, monotonic event IDs,
 * in-memory event replay buffers for reconnection recovery, and broadcasts.
 *
 * ARCHITECTURAL NOTES & REPLAY LIMITATIONS:
 * - Event IDs are monotonically incrementing integers generated per broadcast.
 * - The replay buffer is an IN-MEMORY circular buffer with a fixed window size
 *   (default: 100 events).
 * - It is designed for short, transient disconnections (e.g. WiFi handoffs, quick page reloads).
 * - LIMITATION: It does NOT provide durable disk/database replay across process restarts.
 *   If the backend server restarts or a client is offline for longer than 100 events,
 *   missed events outside the in-memory window cannot be delivered via SSE replay.
 * - In that eventuality, connected clients rely on active REST reconciliation
 *   (GET /api/alerts/active and GET /api/patients) upon reconnection to establish ground truth.
 */
class SSEManager {
  constructor() {
    this.clients = new Set();
    this.currentEventId = 0;
    this.replayBufferSize = 100;
    this.replayBuffer = []; // { id, event, data, timestamp }
    this.heartbeatInterval = null;

    this.startHeartbeat();
  }

  /**
   * Register a new client SSE response stream
   * @param {express.Request} req 
   * @param {express.Response} res 
   */
  addClient(req, res) {
    // Set proper SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable proxy buffering (Nginx, etc.)
    res.flushHeaders?.();

    const client = {
      id: Symbol('sse-client'),
      res,
      connectedAt: new Date(),
    };

    this.clients.add(client);
    console.log(`[SSE] Client connected. Total active clients: ${this.clients.size}`);

    // Initial connection greeting
    this.sendToClient(client, 'connected', {
      message: 'Connected to Hospital Mobility SSE Stream',
      serverTime: new Date().toISOString(),
      activeClients: this.clients.size,
    });

    // Check for Last-Event-ID header for replay recovery
    const lastEventIdHeader = req.headers['last-event-id'];
    if (lastEventIdHeader) {
      const lastSeenId = parseInt(lastEventIdHeader, 10);
      if (!isNaN(lastSeenId)) {
        this.replayEvents(client, lastSeenId);
      }
    }

    // Handle client disconnect
    req.on('close', () => {
      this.clients.delete(client);
      console.log(`[SSE] Client disconnected. Total active clients: ${this.clients.size}`);
    });
  }

  /**
   * Send single event to a specific client
   */
  sendToClient(client, eventType, data, eventId = null) {
    try {
      const idPart = eventId !== null ? `id: ${eventId}\n` : '';
      client.res.write(`${idPart}event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (err) {
      console.error(`[SSE] Error writing to client: ${err.message}`);
      this.clients.delete(client);
    }
  }

  /**
   * Replay missed events from buffer if available
   */
  replayEvents(client, lastSeenId) {
    const missed = this.replayBuffer.filter((item) => item.id > lastSeenId);
    if (missed.length > 0) {
      console.log(`[SSE] Replaying ${missed.length} missed event(s) for client starting after ID ${lastSeenId}`);
      for (const item of missed) {
        this.sendToClient(client, item.event, item.data, item.id);
      }
    }
  }

  /**
   * Broadcast an event to all connected clients and store in replay buffer
   */
  broadcast(eventType, data) {
    this.currentEventId += 1;
    const eventItem = {
      id: this.currentEventId,
      event: eventType,
      data,
      timestamp: new Date(),
    };

    // Maintain circular buffer
    this.replayBuffer.push(eventItem);
    if (this.replayBuffer.length > this.replayBufferSize) {
      this.replayBuffer.shift();
    }

    for (const client of this.clients) {
      this.sendToClient(client, eventType, data, this.currentEventId);
    }

    return this.currentEventId;
  }

  /**
   * Keep connections alive through proxies with periodic comments
   */
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      for (const client of this.clients) {
        try {
          client.res.write(': keepalive-ping\n\n');
        } catch {
          this.clients.delete(client);
        }
      }
    }, 20000);

    if (this.heartbeatInterval.unref) {
      this.heartbeatInterval.unref();
    }
  }

  getClientCount() {
    return this.clients.size;
  }

  clear() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    for (const client of this.clients) {
      try {
        client.res.end();
      } catch {}
    }
    this.clients.clear();
    this.replayBuffer = [];
  }
}

module.exports = new SSEManager();
