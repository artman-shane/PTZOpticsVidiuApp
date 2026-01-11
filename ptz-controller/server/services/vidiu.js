const mqtt = require('mqtt');
const axios = require('axios');
const config = require('../../config.json');
const EventEmitter = require('events');

/**
 * Vidiu-X MQTT Client
 * Teradek Vidiu devices use MQTT over WebSocket for real-time communication
 *
 * Discovered MQTT Topics (from protocol analysis):
 *
 * STATUS TOPICS (subscribe):
 * - Session/0/Stream/0/Info/stream/0    - Stream state {State: 'Ready'|'Starting'|'Live'|'Error', Account Name, Broadcast, Uptime}
 * - Session/0/Stream/0                  - Stream mode {mode: 'YouTubeLive'|'Facebook'|'RTMP'|...}
 * - Session/0/Stream/0/YouTubeLive      - YouTube settings {broadcast_id, account_id, auto_reconnect, adaptive_bitrate}
 * - Session/0/Info                      - Session state {State: 'Playing'|'Active'}
 * - Accounts/YouTubeLive/{account_id}/LiveBroadcasts         - Broadcast order {order: Array}
 * - Accounts/YouTubeLive/{account_id}/LiveBroadcasts/{id}    - Broadcast details {id, status, streamID, info: {title, scheduledStartTime}}
 * - History/Events/Info                 - Event history {Count, State, Latest}
 * - History/Events/Info/latest          - Latest event {title, description, category, timestamp}
 * - System/Product/Info                 - Device info {Serial, Model}
 * - Input/Video/Info                    - Video input {Resolution, Framerate, Format}
 *
 * COMMAND TOPICS (publish) - from PublishActionsView.js:
 * - Session/0/Stream/0/publish          - Start streaming (go live)
 * - Session/0/Stream/0/unpublish        - Stop streaming
 * - Session/0/Stream/0/preview          - Start preview (send to YouTube but not live)
 * - Session/0/Stream/0/endpreview       - End preview
 * - Session/0/Stream/0/broadcast        - Go live (transition from preview to broadcast)
 * - Session/0/Stream/0/complete         - Complete/end broadcast
 * - Session/0/Stream/0/halt             - Halt streaming
 * - Session/0/Stream/0/cancel           - Cancel streaming
 * - Session/0/Stream/0/YouTubeLive/set  - Select broadcast {broadcast_id: 'xxx'} or account {account_id: 'xxx'}
 * - Accounts/YouTubeLive/{account_id}/LiveBroadcasts/refresh - Refresh broadcast list {}
 *
 * NOISY TOPICS (filter out):
 * - Session/0/AudioEncoder/Info/level   - Audio levels (10+ per second)
 * - System/Time/Info                    - System time (every second)
 * - Session/0/Preview/data              - JPEG preview frames (binary)
 * - Network/Wired/0/Info                - Network stats (every few seconds)
 * - System/CPU/Info, System/Memory/Info - System stats
 *
 * State machine: Invalid → Waiting → Ready → Starting → Live → Stopping → Ready/Complete → Error
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
      accountId: '',           // YouTube account ID (e.g., 'UCc0jjuA7gz7sIjwSJtA9q0A')
      streamInterface: '',
      broadcast: '',           // Display name of current broadcast
      broadcastId: '',         // ID of current broadcast
      broadcastActive: false,
      scheduledStartTime: '',
      bitrate: 0,
      audioLevel: { left: -60, right: -60 }
    };
    this.destinations = [];
    // YouTube broadcasts stored by ID
    this.broadcastsMap = new Map();
    this.broadcastOrder = [];
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
      console.log('[Vidiu] Already connected');
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const url = this.getWsUrl();
      console.log(`[Vidiu] Connecting to ${url}`);

      // Vidiu uses admin/admin as default MQTT credentials
      const username = config.vidiu?.username || 'admin';
      const password = config.vidiu?.password || 'admin';

      console.log(`[Vidiu] Using credentials: ${username}/${password}`);

      try {
        this.client = mqtt.connect(url, {
          protocol: 'ws',
          reconnectPeriod: 5000,
          connectTimeout: 10000,
          clean: true,
          username: username,
          password: password,
          clientId: `ptz-controller-${Date.now()}`
        });

        this.client.on('connect', () => {
          console.log('[Vidiu] ✓ Connected to MQTT successfully');
          this.connected = true;
          this.subscribeToTopics();
          this.emit('connected');
          resolve();
        });

        this.client.on('message', (topic, message) => {
          this.handleMessage(topic, message);
        });

        this.client.on('error', (error) => {
          console.error('[Vidiu] ✗ MQTT Error:', error.message);
          console.error('[Vidiu] Error code:', error.code);
          this.connected = false;
        });

        this.client.on('close', () => {
          console.log('[Vidiu] Connection closed');
          this.connected = false;
          this.emit('disconnected');
        });

        this.client.on('reconnect', () => {
          console.log('[Vidiu] Reconnecting...');
        });

        this.client.on('offline', () => {
          console.log('[Vidiu] Client went offline');
        });

        // Timeout for initial connection
        setTimeout(() => {
          if (!this.connected) {
            console.log('[Vidiu] Connection timeout - could not connect within 10 seconds');
            reject(new Error('Connection timeout'));
          }
        }, 10000);

      } catch (error) {
        console.error('[Vidiu] Connection exception:', error);
        reject(error);
      }
    });
  }

  subscribeToTopics() {
    if (!this.client) return;

    // Subscribe only to relevant topics (not '#' which floods with audio levels, time, etc.)
    const topics = [
      // Stream status and state
      'Session/0/Stream/0/Info/stream/0',  // Main stream state (Ready/Live/Starting/Error)
      'Session/0/Stream/0/Info/#',          // All stream info
      'Session/0/Stream/0',                 // Stream mode
      'Session/0/Stream/0/YouTubeLive',     // YouTube settings
      'Session/0/Info',                     // Session state

      // Broadcasts - use wildcard for any account
      'Accounts/YouTubeLive/+/LiveBroadcasts',      // Broadcast order list
      'Accounts/YouTubeLive/+/LiveBroadcasts/+',    // Individual broadcasts
      'Accounts/YouTubeLive/+',                      // Account info

      // Events and history
      'History/Events/Info',
      'History/Events/Info/latest',

      // Device info
      'System/Product/Info',
      'Input/Video/Info',

      // All destination settings (for mode detection)
      'Session/0/Stream/0/+',  // Catches YouTubeLive, Facebook, RTMP, etc.
    ];

    topics.forEach(topic => {
      this.client.subscribe(topic, { qos: 0 }, (err) => {
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

      // Debug logging - always log status-related topics
      if (process.env.DEBUG_MQTT || topic.includes('Stream/0/Info') || topic.includes('LiveBroadcasts')) {
        console.log(`[Vidiu MQTT] ${topic}:`, typeof data === 'object' ? JSON.stringify(data).substring(0, 200) : data);
      }

      // Handle specific topics
      this.processTopicData(topic, data);

      // Check for pending request handlers
      if (this.messageHandlers.has(topic)) {
        const handler = this.messageHandlers.get(topic);
        handler(data);
        this.messageHandlers.delete(topic);
      }

      // Check for response handlers (success/error responses)
      if (topic.endsWith('/success') || topic.endsWith('/error')) {
        // Find matching request handler
        for (const [key, handler] of this.messageHandlers.entries()) {
          if (key.startsWith('request-') && typeof handler === 'function') {
            handler(topic, message);
          }
        }
      }

      this.emit('message', { topic, data });

    } catch (error) {
      console.error('[Vidiu] Message parse error:', error);
    }
  }

  processTopicData(topic, data) {
    // Stream status - look for State field
    if (data && typeof data === 'object') {
      // Main status object with State (e.g., Ready, Live, Starting, etc.)
      // From: Session/0/Stream/0/Info or Session/0/Stream/0/Info/stream/0
      if (data.State !== undefined && topic.includes('Stream/0/Info')) {
        this.status.state = data.State;
        this.status.uptime = data.Uptime || this.status.uptime;
        this.status.accountName = data['Account Name'] || this.status.accountName;
        this.status.streamInterface = data['Stream Interface'] || this.status.streamInterface;
        this.status.broadcast = data.Broadcast || this.status.broadcast;
        this.status.scheduledStartTime = data['Scheduled Start Time'] || this.status.scheduledStartTime;
        this.status.broadcastActive = data['YouTubeLive Broadcast Active'] ||
                                      data['Facebook Broadcast Active'] ||
                                      data['Broadcast Active'] || false;
        this.emit('status', this.status);
      }

      // YouTube settings with broadcast_id and account_id
      // From: Session/0/Stream/0/YouTubeLive
      if (topic.includes('Stream/0/YouTubeLive') && !topic.includes('/set')) {
        if (data.broadcast_id !== undefined) {
          this.status.broadcastId = data.broadcast_id;
        }
        if (data.account_id !== undefined && data.account_id !== '') {
          this.status.accountId = data.account_id;
        }
      }

      // Account info from Accounts/YouTubeLive/{id}
      // Format: {id: 'UCc0jjuA7gz7sIjwSJtA9q0A', name: 'Winder Building'}
      if (topic.match(/^Accounts\/YouTubeLive\/[^/]+$/) && data.id && data.name) {
        this.status.accountId = data.id;
        this.status.accountName = data.name;
      }

      // Bitrate info from encoder
      if (data.Bitrate !== undefined) {
        this.status.bitrate = data.Bitrate;
      }

      // Network info
      if (topic.includes('Network/Info')) {
        this.status.network = data;
      }

      // YouTube broadcast details (individual broadcasts)
      // From: Accounts/YouTubeLive/{account_id}/LiveBroadcasts/{broadcast_id}
      // Format: {id, status, streamID, info: {title, scheduledStartTime, ...}}
      if (topic.includes('/LiveBroadcasts/') && data.id && data.info && data.info.title) {
        this.broadcastsMap.set(data.id, {
          id: data.id,
          title: data.info.title,
          scheduledStartTime: data.info.scheduledStartTime || '',
          description: data.info.description || '',
          status: data.status?.lifeCycleStatus || 'unknown',
          privacyStatus: data.status?.privacyStatus || 'unknown'
        });
        this.emit('broadcast', data);
      }

      // Broadcast order array
      // From: Accounts/YouTubeLive/{account_id}/LiveBroadcasts
      if (data.order && Array.isArray(data.order)) {
        this.broadcastOrder = data.order;
        this.emit('broadcastOrder', data.order);
      }

      // Stream mode from Session/0/Stream/0
      // Format: {mode: 'YouTubeLive'}
      if (topic === 'Session/0/Stream/0' && data.mode !== undefined) {
        this.currentMode = data.mode;
        this.emit('mode', data.mode);
      }
    }
  }

  /**
   * Send a request to the Vidiu via MQTT
   * Mimics the controller.request() pattern from the web UI
   * The Vidiu expects requests to include a unique requestID in the topic
   */
  request(topic, payload = {}) {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connected) {
        reject(new Error('Not connected'));
        return;
      }

      // Generate unique request ID (matching the original UI pattern)
      const requestId = Date.now().toString();
      const fullTopic = `${topic}/${requestId}`;
      const responseTopic = `${topic}/${requestId}/+`;

      const message = JSON.stringify(payload);
      console.log(`[Vidiu] Publishing to ${fullTopic}: ${message}`);

      // Subscribe to response topic first
      this.client.subscribe(responseTopic, { qos: 0 }, (subErr) => {
        if (subErr) {
          console.error(`[Vidiu] Subscribe error for response:`, subErr);
        }
      });

      // Set up response handler
      const timeout = setTimeout(() => {
        console.log(`[Vidiu] Request timeout for ${fullTopic}`);
        this.client.unsubscribe(responseTopic);
        resolve(); // Resolve anyway - command may have worked
      }, 5000);

      // Listen for success/error response
      const responseHandler = (responseTopic, responseMessage) => {
        if (responseTopic.startsWith(`${topic}/${requestId}/`)) {
          clearTimeout(timeout);
          this.client.unsubscribe(responseTopic);
          const result = responseTopic.endsWith('/success') ? 'success' : 'error';
          console.log(`[Vidiu] Response received: ${result}`);
          if (result === 'error') {
            try {
              const errorData = JSON.parse(responseMessage.toString());
              console.error(`[Vidiu] Error response:`, JSON.stringify(errorData));
            } catch (e) {
              console.error(`[Vidiu] Error response (raw):`, responseMessage.toString());
            }
          }
          resolve();
        }
      };

      // Temporarily add handler
      this.messageHandlers.set(`request-${requestId}`, responseHandler);

      // Publish with QoS 2 (exactly once, matching original)
      this.client.publish(fullTopic, message, { qos: 2 }, (err) => {
        if (err) {
          console.error(`[Vidiu] Publish error:`, err);
          clearTimeout(timeout);
          reject(err);
        } else {
          console.log(`[Vidiu] Published successfully to ${fullTopic}`);
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

      // From PublishActionsView.js: controller.request(this.prefix + '/publish', {});
      // The prefix is Session/0/Stream/0
      const topic = 'Session/0/Stream/0/publish';
      await this.request(topic, {});
      console.log(`[Vidiu] Start streaming command sent to ${topic}`);

      return { success: true, message: 'Start command sent' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async stopStreaming() {
    try {
      await this.ensureConnected();

      // From PublishActionsView.js: controller.request(this.prefix + '/unpublish', {});
      const topic = 'Session/0/Stream/0/unpublish';
      await this.request(topic, {});
      console.log(`[Vidiu] Stop streaming command sent to ${topic}`);

      return { success: true, message: 'Stop command sent' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Preview mode - start sending to YouTube but not live yet
   */
  async startPreview() {
    try {
      await this.ensureConnected();
      const topic = 'Session/0/Stream/0/preview';
      await this.request(topic, {});
      console.log(`[Vidiu] Preview command sent to ${topic}`);
      return { success: true, message: 'Preview started' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * End preview mode
   */
  async endPreview() {
    try {
      await this.ensureConnected();
      const topic = 'Session/0/Stream/0/endpreview';
      await this.request(topic, {});
      console.log(`[Vidiu] End preview command sent to ${topic}`);
      return { success: true, message: 'Preview ended' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Go live on YouTube (transition from preview to broadcast)
   */
  async broadcast() {
    try {
      await this.ensureConnected();
      const topic = 'Session/0/Stream/0/broadcast';
      await this.request(topic, {});
      console.log(`[Vidiu] Broadcast command sent to ${topic}`);
      return { success: true, message: 'Broadcast started' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Complete/end broadcast
   */
  async completeBroadcast() {
    try {
      await this.ensureConnected();
      const topic = 'Session/0/Stream/0/complete';
      await this.request(topic, {});
      console.log(`[Vidiu] Complete broadcast command sent to ${topic}`);
      return { success: true, message: 'Broadcast completed' };
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

      // From SettingsCollection.js: controller.request(topic + '/set', settings)
      // Mode change is sent as {mode: 'YouTubeLive'} to Session/0/Stream/0/set
      await this.request('Session/0/Stream/0/set', { mode: destinationId });
      this.currentMode = destinationId;

      return { success: true, message: `Destination set to ${destinationId}` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Update settings for a specific topic
   * From SettingsCollection.js: controller.request(topic + '/set', settings)
   * @param {string} topic - Base topic (e.g., 'Session/0/Stream/0/YouTubeLive')
   * @param {object} settings - Key-value pairs to update
   */
  async updateSettings(topic, settings) {
    try {
      await this.ensureConnected();
      const setTopic = `${topic}/set`;
      await this.request(setTopic, settings);
      console.log(`[Vidiu] Settings updated on ${setTopic}:`, settings);
      return { success: true, message: 'Settings updated' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Update YouTube Live settings
   * @param {object} settings - e.g., {broadcast_id, account_id, auto_reconnect, adaptive_bitrate}
   */
  async setYouTubeSettings(settings) {
    return this.updateSettings('Session/0/Stream/0/YouTubeLive', settings);
  }

  /**
   * Update Facebook Live settings
   * @param {object} settings - e.g., {live_mode, page_id, timeline_title, timeline_privacy}
   */
  async setFacebookSettings(settings) {
    return this.updateSettings('Session/0/Stream/0/Facebook', settings);
  }

  /**
   * Update RTMP settings
   * @param {object} settings - e.g., {url, stream_key, channel_name}
   */
  async setRTMPSettings(settings) {
    return this.updateSettings('Session/0/Stream/0/RTMP', settings);
  }

  /**
   * Update video encoder settings
   * @param {object} settings - e.g., {codec, bitrate_setting, bitrate_range, resolution}
   */
  async setVideoEncoderSettings(settings) {
    return this.updateSettings('Session/0/VideoEncoder', settings);
  }

  /**
   * Update audio encoder settings
   * @param {object} settings - e.g., {bitrate_setting, stream_mute, stream_volume}
   */
  async setAudioEncoderSettings(settings) {
    return this.updateSettings('Session/0/AudioEncoder', settings);
  }

  /**
   * Update network settings
   * @param {string} interface - 'Wired/0', 'Wireless/0', or 'Modem/0'
   * @param {object} settings - Network settings
   */
  async setNetworkSettings(interface_, settings) {
    return this.updateSettings(`Network/${interface_}`, settings);
  }

  /**
   * Update system settings
   * @param {object} settings - e.g., {password, public_snapshot}
   */
  async setSystemSettings(settings) {
    return this.updateSettings('System', settings);
  }

  async selectBroadcast(broadcastId) {
    try {
      await this.ensureConnected();

      // From protocol analysis: Session/0/Stream/0/YouTubeLive/set with {broadcast_id: 'xxx'}
      const topic = 'Session/0/Stream/0/YouTubeLive/set';
      await this.request(topic, { broadcast_id: broadcastId });
      console.log(`[Vidiu] Broadcast selection sent to ${topic}: ${broadcastId}`);

      this.status.broadcastId = broadcastId;
      return { success: true, message: `Broadcast selected: ${broadcastId}` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get list of available YouTube broadcasts
   */
  async getBroadcasts() {
    try {
      // Return broadcasts in order
      const broadcasts = [];

      // Use order array if available, otherwise just iterate map
      const orderedIds = this.broadcastOrder.length > 0
        ? this.broadcastOrder
        : Array.from(this.broadcastsMap.keys());

      for (const id of orderedIds) {
        const broadcast = this.broadcastsMap.get(id);
        if (broadcast) {
          broadcasts.push({
            ...broadcast,
            selected: id === this.status.broadcastId
          });
        }
      }

      return {
        success: true,
        data: {
          broadcasts,
          currentBroadcastId: this.status.broadcastId,
          currentBroadcast: this.status.broadcast,
          mode: this.currentMode
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Refresh the list of YouTube broadcasts
   * Triggers the Vidiu to fetch latest broadcasts from YouTube
   */
  async refreshBroadcasts() {
    try {
      await this.ensureConnected();

      console.log('[Vidiu] Refresh broadcasts requested');
      console.log('[Vidiu] Connected:', this.connected);
      console.log('[Vidiu] Current accountId:', this.status.accountId);
      console.log('[Vidiu] Current mode:', this.currentMode);

      // Keep old data until new data arrives (don't clear immediately)
      const oldBroadcasts = new Map(this.broadcastsMap);
      const oldOrder = [...this.broadcastOrder];

      // From protocol analysis: Accounts/YouTubeLive/{account_id}/LiveBroadcasts/refresh
      // We need the account_id - use the stored one or default
      let accountId = this.status.accountId || this.getDefaultAccountId();

      // If we still don't have an account ID, try to request YouTubeLive settings first
      if (!accountId && this.connected) {
        console.log('[Vidiu] No account ID, requesting YouTubeLive settings...');
        // Subscribe to get the account ID
        this.client.subscribe('Session/0/Stream/0/YouTubeLive', { qos: 0 });
        this.client.subscribe('Accounts/YouTubeLive/+', { qos: 0 });

        // Wait a moment for the settings to arrive
        await new Promise(resolve => setTimeout(resolve, 1000));
        accountId = this.status.accountId;
        console.log('[Vidiu] After waiting, accountId:', accountId);
      }

      if (accountId) {
        const topic = `Accounts/YouTubeLive/${accountId}/LiveBroadcasts/refresh`;

        // Clear before refresh, but restore if nothing comes back
        this.broadcastsMap.clear();
        this.broadcastOrder = [];

        await this.request(topic, {});
        console.log(`[Vidiu] Refresh sent to ${topic}`);

        // Wait for broadcasts to come in via MQTT
        await new Promise(resolve => setTimeout(resolve, 3000));

        console.log('[Vidiu] After refresh, broadcasts count:', this.broadcastsMap.size);
        console.log('[Vidiu] Broadcast order:', this.broadcastOrder);

        // If nothing came back, restore old data
        if (this.broadcastsMap.size === 0 && oldBroadcasts.size > 0) {
          console.log('[Vidiu] No new data received, restoring previous broadcasts');
          this.broadcastsMap = oldBroadcasts;
          this.broadcastOrder = oldOrder;
        }
      } else {
        console.log('[Vidiu] No account ID available for refresh - MQTT may not be connected or YouTubeLive not configured');
        return {
          success: false,
          error: 'No YouTube account ID available. Make sure YouTubeLive mode is selected on the Vidiu.',
          data: { broadcasts: [], connected: this.connected }
        };
      }

      return await this.getBroadcasts();
    } catch (error) {
      console.error('[Vidiu] Refresh broadcasts error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get the default/first YouTube account ID
   */
  getDefaultAccountId() {
    // Return stored account or null
    return this.status.accountId || null;
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
  // Streaming controls
  startStreaming: () => vidiuClient.startStreaming(),     // publish
  stopStreaming: () => vidiuClient.stopStreaming(),       // unpublish
  startPreview: () => vidiuClient.startPreview(),         // preview
  endPreview: () => vidiuClient.endPreview(),             // endpreview
  broadcast: () => vidiuClient.broadcast(),               // broadcast (go live from preview)
  completeBroadcast: () => vidiuClient.completeBroadcast(), // complete
  // Destinations and broadcasts
  getDestinations: () => vidiuClient.getDestinations(),
  setDestination: (id) => vidiuClient.setDestination(id),
  selectBroadcast: (id) => vidiuClient.selectBroadcast(id),
  getBroadcasts: () => vidiuClient.getBroadcasts(),
  refreshBroadcasts: () => vidiuClient.refreshBroadcasts(),
  // Settings - general and specific
  updateSettings: (topic, settings) => vidiuClient.updateSettings(topic, settings),
  setYouTubeSettings: (settings) => vidiuClient.setYouTubeSettings(settings),
  setFacebookSettings: (settings) => vidiuClient.setFacebookSettings(settings),
  setRTMPSettings: (settings) => vidiuClient.setRTMPSettings(settings),
  setVideoEncoderSettings: (settings) => vidiuClient.setVideoEncoderSettings(settings),
  setAudioEncoderSettings: (settings) => vidiuClient.setAudioEncoderSettings(settings),
  setNetworkSettings: (iface, settings) => vidiuClient.setNetworkSettings(iface, settings),
  setSystemSettings: (settings) => vidiuClient.setSystemSettings(settings),
  // Device info
  getDeviceInfo: () => vidiuClient.getDeviceInfo(),
  getConnectionInfo: () => vidiuClient.getConnectionInfo()
};
