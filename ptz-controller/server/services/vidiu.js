const mqtt = require('mqtt');
const axios = require('axios');
const config = require('../../config.json');
const EventEmitter = require('events');

/**
 * Vidiu-X MQTT Client
 * Teradek Vidiu devices use MQTT over WebSocket for real-time communication
 *
 * Discovered MQTT Topics:
 * - Session/0/Stream/0/Info/stream/0 - Stream status info
 * - Session/0/AudioEncoder/Info/level - Audio levels
 * - System/Time/Info - System time
 * - Network/Info - Network status
 * - Session/0/Preview/data - Video preview frames
 *
 * State machine: Invalid → Waiting → Ready → Starting → Live → Stopping → Ready/Complete
 */

class VidiuClient extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.connected = false;
    this.connecting = false;
    this.status = {
      state: 'Unknown',
      uptime: '--',
      accountName: '',
      streamInterface: '',
      broadcast: '',
      broadcastActive: false,
      bitrate: 0,
      audioLevel: { left: -60, right: -60 }
    };
    this.destinations = [];
    this.broadcasts = [];
    this.currentMode = '';
    this.reconnectTimer = null;
    this.messageHandlers = new Map();
    this.requestId = 0;
  }

  getVidiuIP() {
    return config.vidiu?.ip || '192.168.108.21';
  }

  getWsUrl() {
    return `ws://${this.getVidiuIP()}/mqtt`;
  }

  connect() {
    if (this.client && this.connected) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const url = this.getWsUrl();
      console.log(`[Vidiu] Connecting to ${url}`);

      // Get optional credentials from config
      const username = config.vidiu?.username || '';
      const password = config.vidiu?.password || '';

      try {
        this.client = mqtt.connect(url, {
          protocol: 'ws',
          reconnectPeriod: 5000,
          connectTimeout: 10000,
          clean: true,
          // Vidiu may require credentials
          username: username || undefined,
          password: password || undefined,
          // Try common client ID formats
          clientId: `ptz-controller-${Date.now()}`
        });

        this.client.on('connect', () => {
          console.log('[Vidiu] Connected to MQTT');
          this.connected = true;
          this.subscribeToTopics();
          this.emit('connected');
          resolve();
        });

        this.client.on('message', (topic, message) => {
          this.handleMessage(topic, message);
        });

        this.client.on('error', (error) => {
          console.error('[Vidiu] MQTT Error:', error.message);
          this.connected = false;
          // Don't re-emit error to prevent crashes - just log it
          // The client will auto-reconnect based on reconnectPeriod
        });

        this.client.on('close', () => {
          console.log('[Vidiu] Connection closed');
          this.connected = false;
          this.emit('disconnected');
        });

        this.client.on('reconnect', () => {
          console.log('[Vidiu] Reconnecting...');
        });

        // Timeout for initial connection
        setTimeout(() => {
          if (!this.connected) {
            reject(new Error('Connection timeout'));
          }
        }, 10000);

      } catch (error) {
        reject(error);
      }
    });
  }

  subscribeToTopics() {
    if (!this.client) return;

    // Subscribe to all topics to capture status updates
    // Based on protocol analysis, Vidiu uses hierarchical topics
    const topics = [
      '#',  // All topics - we'll filter in handleMessage
    ];

    topics.forEach(topic => {
      this.client.subscribe(topic, (err) => {
        if (err) {
          console.error(`[Vidiu] Subscribe error for ${topic}:`, err);
        } else {
          console.log(`[Vidiu] Subscribed to ${topic}`);
        }
      });
    });
  }

  handleMessage(topic, message) {
    try {
      // Try to parse as JSON
      let data;
      const msgStr = message.toString();

      // Skip binary/preview data
      if (topic.includes('Preview/data')) {
        return;
      }

      try {
        data = JSON.parse(msgStr);
      } catch (e) {
        // Not JSON, might be raw value
        data = msgStr;
      }

      // Debug logging (can be disabled in production)
      if (process.env.DEBUG_MQTT) {
        console.log(`[Vidiu] ${topic}:`, typeof data === 'object' ? JSON.stringify(data).substring(0, 100) : data);
      }

      // Handle specific topics
      this.processTopicData(topic, data);

      // Check for pending request handlers
      if (this.messageHandlers.has(topic)) {
        const handler = this.messageHandlers.get(topic);
        handler(data);
        this.messageHandlers.delete(topic);
      }

      this.emit('message', { topic, data });

    } catch (error) {
      console.error('[Vidiu] Message parse error:', error);
    }
  }

  processTopicData(topic, data) {
    // Stream status - look for State field
    if (data && typeof data === 'object') {
      // Main status object with State
      if (data.State !== undefined) {
        this.status.state = data.State;
        this.status.uptime = data.Uptime || this.status.uptime;
        this.status.accountName = data['Account Name'] || this.status.accountName;
        this.status.streamInterface = data['Stream Interface'] || this.status.streamInterface;
        this.status.broadcast = data.Broadcast || this.status.broadcast;
        this.status.broadcastActive = data['YouTubeLive Broadcast Active'] ||
                                      data['Facebook Broadcast Active'] ||
                                      data['Broadcast Active'] || false;
        this.emit('status', this.status);
      }

      // Audio levels
      if (topic.includes('AudioEncoder/Info/level')) {
        this.status.audioLevel = {
          left: data.left || data.L || -60,
          right: data.right || data.R || -60
        };
      }

      // Bitrate info
      if (data.bitrate !== undefined) {
        this.status.bitrate = data.bitrate;
      }
      if (data['Video Bitrate'] !== undefined) {
        this.status.bitrate = data['Video Bitrate'];
      }

      // Network info
      if (topic.includes('Network/Info')) {
        this.status.network = data;
      }

      // Available broadcasts list
      if (data.broadcasts || data.available_broadcasts) {
        this.broadcasts = data.broadcasts || data.available_broadcasts;
        this.emit('broadcasts', this.broadcasts);
      }

      // Mode/destination info
      if (data.mode !== undefined) {
        this.currentMode = data.mode;
      }
    }
  }

  /**
   * Send a request to the Vidiu via MQTT
   * Mimics the controller.request() pattern from the web UI
   */
  request(topic, payload = {}) {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connected) {
        reject(new Error('Not connected'));
        return;
      }

      const message = JSON.stringify(payload);

      this.client.publish(topic, message, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Send request and wait for response on a specific topic
   */
  requestWithResponse(requestTopic, responseTopic, payload = {}, timeout = 5000) {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connected) {
        reject(new Error('Not connected'));
        return;
      }

      const timer = setTimeout(() => {
        this.messageHandlers.delete(responseTopic);
        reject(new Error('Response timeout'));
      }, timeout);

      this.messageHandlers.set(responseTopic, (data) => {
        clearTimeout(timer);
        resolve(data);
      });

      this.request(requestTopic, payload).catch(reject);
    });
  }

  // ============================================
  // Public API Methods
  // ============================================

  async getStatus() {
    try {
      // Try MQTT first
      if (this.connected && this.status.state !== 'Unknown') {
        return {
          success: true,
          data: {
            connected: this.connected,
            state: this.status.state,
            uptime: this.status.uptime,
            accountName: this.status.accountName,
            streamInterface: this.status.streamInterface,
            broadcast: this.status.broadcast,
            broadcastActive: this.status.broadcastActive,
            bitrate: this.status.bitrate,
            audioLevel: this.status.audioLevel,
            isStreaming: this.status.state === 'Live',
            isReady: this.status.state === 'Ready'
          }
        };
      }

      // Fall back to HTTP status check
      return await this.getStatusViaHttp();
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * HTTP fallback for getting status when MQTT isn't available
   */
  async getStatusViaHttp() {
    try {
      const baseUrl = `http://${this.getVidiuIP()}`;
      const response = await axios.get(baseUrl, { timeout: 3000 });
      const html = response.data;

      // Parse status from HTML
      const isLive = html.includes('LIVE') || html.includes('Broadcasting');
      const isReady = html.includes('Ready') || html.includes('Standby');

      return {
        success: true,
        data: {
          connected: true,
          state: isLive ? 'Live' : (isReady ? 'Ready' : 'Unknown'),
          isStreaming: isLive,
          isReady: isReady,
          source: 'http'
        }
      };
    } catch (error) {
      return { success: false, error: 'Could not connect to Vidiu' };
    }
  }

  async getStreamingStatus() {
    try {
      // Try MQTT connection (non-blocking)
      this.ensureConnected().catch(() => {});

      // If we have MQTT status, use it
      if (this.connected && this.status.state !== 'Unknown') {
        const isLive = this.status.state === 'Live';
        const isStarting = this.status.state === 'Starting';
        const isStopping = this.status.state === 'Stopping';

        return {
          success: true,
          data: {
            streaming: isLive,
            isStreaming: isLive,
            state: this.status.state,
            starting: isStarting,
            stopping: isStopping,
            bitrate: this.status.bitrate,
            uptime: this.status.uptime,
            broadcast: this.status.broadcast
          }
        };
      }

      // Fall back to HTTP
      const httpStatus = await this.getStatusViaHttp();
      if (httpStatus.success) {
        return {
          success: true,
          data: {
            streaming: httpStatus.data.isStreaming,
            isStreaming: httpStatus.data.isStreaming,
            state: httpStatus.data.state,
            source: 'http'
          }
        };
      }

      return httpStatus;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async startStreaming() {
    try {
      await this.ensureConnected();

      // Based on protocol analysis, start command is sent as empty object
      // The actual topic varies but commonly is Session/0/Stream/0/Command/start
      const topics = [
        'Session/0/Stream/0/Command/start',
        'Session/0/Command/start',
        'Broadcast/Command/start'
      ];

      for (const topic of topics) {
        try {
          await this.request(topic, {});
          console.log(`[Vidiu] Start command sent to ${topic}`);
        } catch (e) {
          // Try next topic
        }
      }

      return { success: true, message: 'Start command sent' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async stopStreaming() {
    try {
      await this.ensureConnected();

      // Similar to start, stop is sent as empty object
      const topics = [
        'Session/0/Stream/0/Command/stop',
        'Session/0/Command/stop',
        'Broadcast/Command/stop'
      ];

      for (const topic of topics) {
        try {
          await this.request(topic, {});
          console.log(`[Vidiu] Stop command sent to ${topic}`);
        } catch (e) {
          // Try next topic
        }
      }

      return { success: true, message: 'Stop command sent' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getDestinations() {
    try {
      await this.ensureConnected();

      // Return available modes/platforms
      // Based on protocol analysis, these are the available modes
      const destinations = [
        { id: 'YouTubeLive', name: 'YouTube Live', active: this.currentMode === 'YouTubeLive' },
        { id: 'Facebook', name: 'Facebook', active: this.currentMode === 'Facebook' },
        { id: 'Twitch', name: 'Twitch', active: this.currentMode === 'Twitch' },
        { id: 'Wowza', name: 'Wowza', active: this.currentMode === 'Wowza' },
        { id: 'Core', name: 'Core', active: this.currentMode === 'Core' },
        { id: 'RTMP', name: 'Custom RTMP', active: this.currentMode === 'RTMP' }
      ];

      return {
        success: true,
        data: {
          destinations,
          broadcasts: this.broadcasts,
          currentMode: this.currentMode
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async setDestination(destinationId) {
    try {
      await this.ensureConnected();

      // Mode change is sent as {mode: 'YouTubeLive'} etc.
      await this.request('Session/0/Stream/0/Settings/mode', { mode: destinationId });
      this.currentMode = destinationId;

      return { success: true, message: `Destination set to ${destinationId}` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async selectBroadcast(broadcastId) {
    try {
      await this.ensureConnected();

      // Broadcast selection is sent as {broadcast_id: '...'}
      await this.request('Session/0/Stream/0/Settings/broadcast', { broadcast_id: broadcastId });

      return { success: true, message: `Broadcast selected: ${broadcastId}` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getDeviceInfo() {
    try {
      await this.ensureConnected();

      return {
        success: true,
        data: {
          connected: this.connected,
          ip: this.getVidiuIP(),
          accountName: this.status.accountName,
          streamInterface: this.status.streamInterface,
          currentMode: this.currentMode
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getConnectionInfo() {
    try {
      await this.ensureConnected();

      return {
        success: true,
        data: {
          connected: this.connected,
          bitrate: this.status.bitrate,
          network: this.status.network,
          audioLevel: this.status.audioLevel
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async ensureConnected() {
    if (!this.connected && !this.connecting) {
      this.connecting = true;
      try {
        await this.connect();
        // Give a moment for subscriptions and initial messages
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.log('[Vidiu] Connection attempt failed:', error.message);
      } finally {
        this.connecting = false;
      }
    }
  }

  disconnect() {
    if (this.client) {
      this.client.end();
      this.client = null;
      this.connected = false;
    }
  }
}

// Singleton instance
const vidiuClient = new VidiuClient();

// Auto-connect on module load (non-blocking)
// Note: MQTT requires authentication - will fall back to HTTP if connection fails
setImmediate(() => {
  vidiuClient.connect().catch(err => {
    console.log('[Vidiu] MQTT connection not available, using HTTP fallback');
    // Stop reconnection attempts since we'll use HTTP
    if (vidiuClient.client) {
      vidiuClient.client.end(true);
      vidiuClient.client = null;
    }
  });
});

// Export both the client instance and wrapper methods for the routes
module.exports = {
  client: vidiuClient,
  getStatus: () => vidiuClient.getStatus(),
  getStreamingStatus: () => vidiuClient.getStreamingStatus(),
  startStreaming: () => vidiuClient.startStreaming(),
  stopStreaming: () => vidiuClient.stopStreaming(),
  getDestinations: () => vidiuClient.getDestinations(),
  setDestination: (id) => vidiuClient.setDestination(id),
  selectBroadcast: (id) => vidiuClient.selectBroadcast(id),
  getDeviceInfo: () => vidiuClient.getDeviceInfo(),
  getConnectionInfo: () => vidiuClient.getConnectionInfo()
};
