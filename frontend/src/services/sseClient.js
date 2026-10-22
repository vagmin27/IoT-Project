/**
 * Server-Sent Events (SSE) Client
 * Handles connection lifecycle, event dispatching, deduplication,
 * and reconnection reconciliation.
 */
class SSEClient {
  constructor() {
    this.eventSource = null;
    this.status = 'DISCONNECTED'; // CONNECTING, CONNECTED, DISCONNECTED
    this.statusListeners = new Set();
    this.eventListeners = new Map(); // eventType -> Set of callbacks
    this.processedEventIds = new Set();
    this.reconnectTimeout = null;
    this.reconnectListeners = new Set();
  }

  onStatusChange(callback) {
    this.statusListeners.add(callback);
    callback(this.status);
    return () => this.statusListeners.delete(callback);
  }

  setStatus(newStatus) {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.statusListeners.forEach((cb) => cb(newStatus));
    }
  }

  addReconnectListener(callback) {
    this.reconnectListeners.add(callback);
    return () => this.reconnectListeners.delete(callback);
  }

  setReconnectCallback(cb) {
    return this.addReconnectListener(cb);
  }

  on(eventType, callback) {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType).add(callback);
    return () => {
      const set = this.eventListeners.get(eventType);
      if (set) set.delete(callback);
    };
  }

  connect() {
    if (this.eventSource) {
      this.eventSource.close();
    }

    this.setStatus('CONNECTING');
    console.log('[SSE-Client] Connecting to /api/events/stream...');

    this.eventSource = new EventSource('/api/events/stream');

    this.eventSource.onopen = () => {
      console.log('[SSE-Client] SSE stream open and connected.');
      const wasDisconnected = this.status === 'DISCONNECTED' || this.status === 'CONNECTING';
      this.setStatus('CONNECTED');

      // Reconcile active alerts and patient state on reconnection
      if (wasDisconnected && this.reconnectListeners.size > 0) {
        console.log('[SSE-Client] Reconnection detected, reconciling active state...');
        this.reconnectListeners.forEach((cb) => {
          try {
            cb();
          } catch (err) {
            console.error('[SSE-Client] Error in reconnect callback:', err);
          }
        });
      }
    };

    this.eventSource.onerror = (err) => {
      console.warn('[SSE-Client] Connection error or interruption:', err);
      // Browser EventSource automatically attempts to reconnect
      if (this.eventSource && this.eventSource.readyState === EventSource.CONNECTING) {
        this.setStatus('CONNECTING');
      } else {
        this.setStatus('DISCONNECTED');
      }
    };

    // Generic and custom event listeners
    const registeredEvents = [
      'connected',
      'alert_created',
      'alert_updated',
      'patient_status_updated',
      'sensor_event',
      'simulator_status',
    ];

    registeredEvents.forEach((eventType) => {
      this.eventSource.addEventListener(eventType, (e) => {
        try {
          const data = JSON.parse(e.data);
          const eventId = e.lastEventId;

          // Deduplication protection
          if (eventId && this.processedEventIds.has(eventId)) {
            console.debug(`[SSE-Client] Dropping duplicate event ID: ${eventId}`);
            return;
          }
          if (eventId) {
            this.processedEventIds.add(eventId);
            if (this.processedEventIds.size > 200) {
              const [first] = this.processedEventIds;
              this.processedEventIds.delete(first);
            }
          }

          const listeners = this.eventListeners.get(eventType);
          if (listeners) {
            listeners.forEach((cb) => cb(data, eventId));
          }
        } catch (parseError) {
          console.error(`[SSE-Client] Failed parsing event data for ${eventType}:`, parseError);
        }
      });
    });
  }

  disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    this.setStatus('DISCONNECTED');
  }
}

export const sseClient = new SSEClient();
