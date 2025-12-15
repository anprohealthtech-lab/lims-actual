// src/utils/whatsappAPI.ts
import { supabase, database } from './supabase';

// Simple in-memory auth cache to avoid frequent /auth/v1/user calls during polling
let _authCache: { userId: string | null; token: string | null; fetchedAt: number } = {
  userId: null,
  token: null,
  fetchedAt: 0,
};

// Backend selection
// rest: call external REST API (DigitalOcean app)
// supabase-functions: call Supabase Edge Functions via supabase.functions.invoke
// netlify-functions: call Netlify Functions under /.netlify/functions/*
const WHATSAPP_API_MODE: 'rest' | 'supabase-functions' | 'netlify-functions' =
  ((import.meta as any).env?.VITE_WHATSAPP_API_MODE as any) || 'rest';

// REST base URL (used when WHATSAPP_API_MODE === 'rest')
const WHATSAPP_API_BASE_URL =
  (import.meta as any).env?.VITE_WHATSAPP_API_BASE_URL ||
  'https://lionfish-app-nmodi.ondigitalocean.app';

// Prefix used by the backend for WhatsApp routes
const WHATSAPP_API_PREFIX = '/api/whatsapp';
// Enable WS by default; can be disabled by setting VITE_WHATSAPP_WS_ENABLED=false
const WHATSAPP_WS_ENABLED = String(((import.meta as any).env?.VITE_WHATSAPP_WS_ENABLED ?? 'true')) === 'true';
// Optional explicit WS URL override, e.g. wss://lionfish-app-nmodi.ondigitalocean.app/ws
const WHATSAPP_WS_URL: string | undefined = (import.meta as any).env?.VITE_WHATSAPP_WS_URL;
// Verbose logging for WebSocket diagnostics
const WHATSAPP_WS_DEBUG = String(((import.meta as any).env?.VITE_WHATSAPP_WS_DEBUG ?? 'true')) === 'true';

const apiUrl = (path: string, query?: Record<string, string | number | undefined>) => {
  const url = new URL(WHATSAPP_API_PREFIX + path, WHATSAPP_API_BASE_URL);
  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    });
  }
  return url.toString();
};

const buildHeaders = async (base?: Record<string, string>): Promise<HeadersInit> => {
  const headers: Record<string, string> = { ...(base || {}) };
  // Prefer cached token if fresh
  const now = Date.now();
  if (_authCache.token && now - _authCache.fetchedAt < 60_000) {
    headers['Authorization'] = `Bearer ${_authCache.token}`;
    return headers;
  }
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || null;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  _authCache.token = token;
  _authCache.userId = session?.user?.id || _authCache.userId;
  _authCache.fetchedAt = now;
  return headers;
};

export interface WhatsAppConnectionStatus {
  success: boolean;
  isConnected: boolean;
  phoneNumber?: string;
  sessionId?: string;
  message?: string;
  qrCode?: string;
  lastActivity?: string;
}

export interface MessageResult {
  success: boolean;
  messageId?: string;
  message: string;
  error?: string;
}

export interface MessageHistoryItem {
  id: string;
  to_number: string;
  message_text?: string;
  message_type: 'text' | 'document' | 'image';
  file_name?: string;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  patient_name?: string;
  test_name?: string;
  created_at: string;
  sent_at?: string;
  delivered_at?: string;
}

export interface MessageFilters {
  status?: string;
  messageType?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export class WhatsAppAPI {
  // Generic function invoker for Supabase Edge Functions
  private static async invokeFunction<T = any>(
    name: string,
    body?: any
  ): Promise<{ data?: T; error?: any; response?: Response }> {
    const { data, error } = await supabase.functions.invoke(name, {
      body: body || {},
    });
    return { data, error };
  }

  // Get current user's session information
  static async getCurrentUserSession(): Promise<{ userId: string | null; user: any }> {
    const now = Date.now();
    // Return cached user quickly if recent
    if (_authCache.userId && now - _authCache.fetchedAt < 60_000) {
      return { userId: _authCache.userId, user: { id: _authCache.userId } };
    }
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user || null;
    _authCache.userId = user?.id || null;
    _authCache.token = session?.access_token || _authCache.token;
    _authCache.fetchedAt = now;
    return {
      userId: user?.id || null,
      user
    };
  }

  // Force-reset a user's WhatsApp session (DELETE /api/users/:userId/whatsapp/session)
  static async resetUserWhatsAppSession(): Promise<{ success: boolean; message?: string; error?: string; status?: number }> {
    try {
      const { userId } = await this.getCurrentUserSession();
      if (!userId) {
        return { success: false, message: 'User not authenticated' };
      }

      const url = new URL(`/api/users/${encodeURIComponent(userId)}/whatsapp/session`, WHATSAPP_API_BASE_URL);
      const response = await fetch(url.toString(), {
        method: 'DELETE',
        headers: await buildHeaders({ 'Content-Type': 'application/json' }),
      });

      let data: any = null;
      try {
        data = await response.json();
      } catch (e) {
        // Non-JSON response; proceed with status only
      }

      return {
        success: response.ok && (data?.success ?? true),
        message: data?.message || (response.ok ? 'Session reset' : 'Failed to reset session'),
        error: data?.error,
        status: response.status,
      };
    } catch (error) {
      console.error('Reset session error:', error);
      return { success: false, error: String(error), message: 'Failed to reset session' };
    }
  }

  // Get WhatsApp session ID for current user
  static async getWhatsAppSessionId(): Promise<string | null> {
    try {
      const { userId } = await this.getCurrentUserSession();
      if (!userId) return null;

      // Use the active WhatsApp session ID
      const activeSessionId = 'f1e86dc8-fd5a-4719-a94a-e49729d6ac14';
      
      // Optional: Check if this session exists in backend
      // This could be enhanced to create a new session if needed
      return activeSessionId;
    } catch (error) {
      console.error('Error getting WhatsApp session ID:', error);
      return null;
    }
  }

  // Connection Management
  static async connectWhatsApp(): Promise<WhatsAppConnectionStatus> {
    try {
      const { userId } = await this.getCurrentUserSession();
      const labId = await database.getCurrentUserLabId();
      if (!userId || !labId) {
        return {
          success: false,
          isConnected: false,
          message: 'User or lab not available'
        };
      }

      if (WHATSAPP_API_MODE === 'supabase-functions') {
        const { data, error } = await this.invokeFunction<WhatsAppConnectionStatus>('whatsapp-connect', { labId });
        if (error) throw error;
        return data as WhatsAppConnectionStatus;
      } else if (WHATSAPP_API_MODE === 'netlify-functions') {
        const headers = await buildHeaders({ 'Content-Type': 'application/json' });
        const { userId } = await this.getCurrentUserSession();
        if (!userId) throw new Error('User not authenticated');
        const response = await fetch('/.netlify/functions/whatsapp-connect', {
          method: 'POST',
          headers,
          body: JSON.stringify({ labId, userId })
        });
        const result = await response.json();
        // Handle nested response structure: { success: true, data: { qrCode: "..." } }
        if (result?.data && typeof result.data === 'object') {
          return { ...result.data, success: result.success };
        }
        return result;
      } else {
        const headers = await buildHeaders({ 'Content-Type': 'application/json' });
        const response = await fetch(
          apiUrl('/connect'),
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ labId })
          }
        );
        const result = await response.json();
        return result;
      }
    } catch (error) {
      console.error('WhatsApp connect error:', error);
      return {
        success: false,
        isConnected: false,
        message: 'Connection failed: ' + (error as Error).message
      };
    }
  }

  static async getConnectionStatus(): Promise<WhatsAppConnectionStatus> {
    try {
      const { userId } = await this.getCurrentUserSession();
      const labId = await database.getCurrentUserLabId();
      if (!userId || !labId) {
        return {
          success: false,
          isConnected: false,
          message: 'User or lab not available'
        };
      }

      if (WHATSAPP_API_MODE === 'supabase-functions') {
        const { data, error } = await this.invokeFunction<WhatsAppConnectionStatus>('whatsapp-status', { labId });
        if (error) throw error;
        return data as WhatsAppConnectionStatus;
      } else if (WHATSAPP_API_MODE === 'netlify-functions') {
        const { userId } = await this.getCurrentUserSession();
        if (!userId) throw new Error('User not authenticated');
        const qs = new URLSearchParams({ userId, labId });
        const response = await fetch(`/.netlify/functions/whatsapp-status?${qs.toString()}`, { headers: await buildHeaders() });
        const result = await response.json();
        
        // Handle backend response format: { success: true, data: { sessions: [...] } }
        if (result?.data?.sessions && Array.isArray(result.data.sessions)) {
          const activeSession = result.data.sessions.find((s: any) => s.isConnected);
          return {
            success: result.success,
            isConnected: !!activeSession,
            message: activeSession ? `Connected: ${activeSession.phoneNumber}` : 'No active session',
            sessionId: activeSession?.sessionId,
            phoneNumber: activeSession?.phoneNumber,
            lastActivity: activeSession?.lastActivity
          };
        }
        
        return result;
      } else {
        const response = await fetch(apiUrl('/status', { labId }), {
          headers: await buildHeaders(),
        });
        const result = await response.json();
        
        // Handle backend response format: { success: true, data: { sessions: [...] } }
        if (result?.data?.sessions && Array.isArray(result.data.sessions)) {
          const activeSession = result.data.sessions.find((s: any) => s.isConnected);
          return {
            success: result.success,
            isConnected: !!activeSession,
            message: activeSession ? `Connected: ${activeSession.phoneNumber}` : 'No active session',
            sessionId: activeSession?.sessionId,
            phoneNumber: activeSession?.phoneNumber,
            lastActivity: activeSession?.lastActivity
          };
        }
        
        return result;
      }
    } catch (error) {
      console.error('WhatsApp status error:', error);
      return {
        success: false,
        isConnected: false,
        message: 'Failed to get status: ' + (error as Error).message
      };
    }
  }

  // Fetch latest QR via HTTP (for HTTP-only deployments). Returns any available qrCode or rawQR.
  static async getLatestQr(): Promise<{ qrCode?: string; rawQR?: string } | null> {
    try {
      const { userId } = await this.getCurrentUserSession();
      const labId = await database.getCurrentUserLabId();
      if (!userId || !labId) return null;

      if (WHATSAPP_API_MODE === 'netlify-functions') {
        const qs = new URLSearchParams({ userId, labId });
        const resp = await fetch(`/.netlify/functions/whatsapp-qr?${qs.toString()}`, {
          headers: await buildHeaders(),
        });
        if (!resp.ok) return null;
        const json = await resp.json();
        return { qrCode: (json as any)?.qrCode, rawQR: (json as any)?.rawQR };
      }

      // REST fallback: try dedicated /qr then status?includeQr=1
      const resp1 = await fetch(apiUrl('/qr', { labId }), { headers: await buildHeaders() });
      if (resp1.ok) {
        const j = await resp1.json();
        return { qrCode: (j as any)?.qrCode, rawQR: (j as any)?.rawQR };
      }
      const resp2 = await fetch(apiUrl('/status', { labId, includeQr: 1 as any }), { headers: await buildHeaders() });
      if (resp2.ok) {
        const j = await resp2.json();
        return { qrCode: (j as any)?.qrCode, rawQR: (j as any)?.rawQR };
      }
      return null;
    } catch {
      return null;
    }
  }

  static async disconnectWhatsApp(): Promise<WhatsAppConnectionStatus> {
    try {
      const { userId } = await this.getCurrentUserSession();
      const labId = await database.getCurrentUserLabId();
      if (!userId || !labId) {
        return {
          success: false,
          isConnected: false,
          message: 'User or lab not available'
        };
      }

      if (WHATSAPP_API_MODE === 'supabase-functions') {
        const { data, error } = await this.invokeFunction<WhatsAppConnectionStatus>('whatsapp-disconnect', { labId });
        if (error) throw error;
        return data as WhatsAppConnectionStatus;
      } else if (WHATSAPP_API_MODE === 'netlify-functions') {
        const { userId } = await this.getCurrentUserSession();
        if (!userId) throw new Error('User not authenticated');
        const response = await fetch('/.netlify/functions/whatsapp-disconnect', {
          method: 'POST',
          headers: await buildHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ labId, userId })
        });
        const result = await response.json();
        return result;
      } else {
        const response = await fetch(apiUrl('/disconnect'), {
          method: 'POST',
          headers: await buildHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ labId })
        });
        const result = await response.json();
        return result;
      }
    } catch (error) {
      console.error('WhatsApp disconnect error:', error);
      return {
        success: false,
        isConnected: false,
        message: 'Disconnect failed: ' + (error as Error).message
      };
    }
  }

  // Message Sending
  static async sendTextMessage(
    phoneNumber: string, 
    message: string,
    templateData?: Record<string, string>
  ): Promise<MessageResult> {
    try {
      const { userId } = await this.getCurrentUserSession();
      const labId = await database.getCurrentUserLabId();
      if (!userId || !labId) {
        return {
          success: false,
          message: 'User or lab not available'
        };
      }

      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      if (!this.validatePhoneNumber(phoneNumber)) {
        return {
          success: false,
          message: 'Invalid phone number format'
        };
      }
      // For message sends, backend expects plain digits (no leading +)
      const plainPhone = formattedPhone.startsWith('+') ? formattedPhone.substring(1) : formattedPhone;

      if (WHATSAPP_API_MODE === 'supabase-functions') {
        const { data, error } = await this.invokeFunction<MessageResult>('whatsapp-send-message', {
          labId,
          phone: plainPhone,
          message,
          templateData,
        });
        if (error) throw error;
        return data as MessageResult;
      } else if (WHATSAPP_API_MODE === 'netlify-functions') {
        const { userId } = await this.getCurrentUserSession();
        if (!userId) throw new Error('User not authenticated');
        const response = await fetch('/.netlify/functions/whatsapp-send-message', {
          method: 'POST',
          headers: await buildHeaders({ 'Content-Type': 'application/json' }),
          // Netlify function expects `phoneNumber`, not `phone`
          body: JSON.stringify({ labId, userId, phoneNumber: plainPhone, message, templateData })
        });
        const result = await response.json();
        return result;
      } else {
        const response = await fetch(apiUrl('/send-message'), {
          method: 'POST',
          headers: await buildHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            labId,
            to: plainPhone,
            message,
            templateData
          }),
        });
        const result = await response.json();
        return result;
      }
    } catch (error) {
      console.error('Send message error:', error);
      return {
        success: false,
        message: 'Failed to send message: ' + (error as Error).message
      };
    }
  }

  static async sendReport(
    phoneNumber: string,
    reportFile: File,
    caption?: string,
    patientName?: string,
    testName?: string
  ): Promise<MessageResult> {
    // Use the new sendDocument method which handles all modes properly
    return await this.sendDocument(phoneNumber, reportFile, {
      caption,
      patientName,
      testName
    });
  }

  static async sendReportFromUrl(
    phoneNumber: string,
    reportUrl: string,
    caption?: string,
    patientName?: string,
    testName?: string
  ): Promise<MessageResult> {
    try {
      const { userId } = await this.getCurrentUserSession();
      const labId = await database.getCurrentUserLabId();
      if (!userId || !labId) {
        return { success: false, message: 'User or lab not available' };
      }

      // Prefer backend to fetch from URL (avoids CORS and big downloads in browser)
      if (WHATSAPP_API_MODE === 'supabase-functions') {
        const { data, error } = await this.invokeFunction<MessageResult>('whatsapp-send-message', {
          labId,
          phone: phoneNumber,
          message: caption || '',
          url: reportUrl,
          patientName,
          testName,
          type: 'document'
        });
        if (!error && data) return data as MessageResult;
        // Fallback to REST URL endpoint if available
      } else if (WHATSAPP_API_MODE === 'netlify-functions') {
        const { userId } = await this.getCurrentUserSession();
        if (!userId) throw new Error('User not authenticated');
        const formattedPhone = this.formatPhoneNumber(phoneNumber);
        if (!this.validatePhoneNumber(phoneNumber)) {
          return { success: false, message: 'Invalid phone number format' };
        }
        const e164Phone = `+${formattedPhone}`;
        const fileName = reportUrl.split('/').pop() || `${patientName || 'Patient'}_Report.pdf`;
        const templatePayload: Record<string, string> = {};
        if (patientName) templatePayload.PatientName = patientName;
        if (testName) templatePayload.TestName = testName;
        const captionText = caption || `Your report for ${patientName || 'Patient'} is ready`;

        const response = await fetch('/.netlify/functions/send-report-url', {
          method: 'POST',
          headers: await buildHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            userId,
            fileUrl: reportUrl,
            fileName,
            caption: captionText,
            phoneNumber: e164Phone,
            templateData: Object.keys(templatePayload).length ? templatePayload : undefined,
          })
        });
        const raw = await response.text();
        let data: any = null;
        try {
          data = raw ? JSON.parse(raw) : null;
        } catch (parseError) {
          console.warn('send-report-url non-JSON response:', raw);
        }

        if (response.ok) {
          return data ?? { success: true, message: 'Report sent successfully' };
        }

        const failureMessage = data?.message || data?.error || `Failed to send report (status ${response.status})`;
        return {
          success: false,
          message: failureMessage,
          error: data || raw || 'Unknown error',
        } as MessageResult;
      } else {
        try {
          const fileName = reportUrl.split('/').pop() || `${patientName || 'Patient'}_Report.pdf`;
          const response = await fetch(apiUrl('/send-file-url'), {
            method: 'POST',
            headers: await buildHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ 
              fileUrl: reportUrl,  // Backend expects 'fileUrl', not 'url'
              to: phoneNumber, 
              caption, 
              fileName,
              patientName, 
              testName 
            })
          });
          const raw = await response.text();
          let data: any = null;
          try {
            data = raw ? JSON.parse(raw) : null;
          } catch (parseError) {
            console.warn('REST send-file-url non-JSON response:', raw);
          }

          if (response.ok) {
            return data ?? { success: true, message: 'Report sent successfully' };
          }

          const failureMessage = data?.message || data?.error || `Failed to send report (status ${response.status})`;
          return {
            success: false,
            message: failureMessage,
            error: data || raw || 'Unknown error',
          } as MessageResult;
        } catch (error) {
          console.error('Direct backend call failed:', error);
          return {
            success: false,
            message: 'Failed to send report: ' + (error as Error).message,
          };
        }
      }
      return {
        success: false,
        message: 'Unsupported WhatsApp API mode',
      };
    } catch (error) {
      console.error('Send report from URL error:', error);
      return {
        success: false,
        message: 'Failed to send report: ' + (error as Error).message
      };
    }
  }

  // Message History
  static async getMessageHistory(filters?: MessageFilters): Promise<MessageHistoryItem[]> {
    try {
      const { userId } = await this.getCurrentUserSession();
      const labId = await database.getCurrentUserLabId();
      if (!userId || !labId) {
        return [];
      }

      const queryParams = new URLSearchParams();
      queryParams.append('labId', labId);
      if (filters?.status) queryParams.append('status', filters.status);
      if (filters?.messageType) queryParams.append('messageType', filters.messageType);
      if (filters?.dateFrom) queryParams.append('dateFrom', filters.dateFrom);
      if (filters?.dateTo) queryParams.append('dateTo', filters.dateTo);
      if (filters?.limit) queryParams.append('limit', filters.limit.toString());

      // For now, message history is available via REST endpoint only
      const response = await fetch(apiUrl('/messages') + `?${queryParams.toString()}`, {
        headers: await buildHeaders(),
      });
      if (!response.ok) {
        throw new Error('Failed to fetch message history');
      }
      const result = await response.json();
      return result.data || [];
    } catch (error) {
      console.error('Get message history error:', error);
      return [];
    }
  }

  // WebSocket connection for real-time updates
  static createWebSocketConnection(onMessage: (data: any) => void): WebSocket | null {
    // Allow disabling WS from env if backend isn't ready; rely on polling fallback
    if (!WHATSAPP_WS_ENABLED) {
      if (WHATSAPP_WS_DEBUG) console.info('[WA-WS] Disabled by VITE_WHATSAPP_WS_ENABLED=false');
      return null;
    }
    try {
      const base = new URL(WHATSAPP_API_BASE_URL);
      const wsProtocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
      if (WHATSAPP_WS_DEBUG) {
        console.info('[WA-WS] Base:', WHATSAPP_API_BASE_URL, '| Proto:', wsProtocol);
      }

      const attachHandlers = (socket: WebSocket) => {
        socket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (WHATSAPP_WS_DEBUG) {
              const evt = (data && (data.event || data.type)) ? (data.event || data.type) : 'message';
              console.info('[WA-WS] ← msg:', evt, data);
            }
            onMessage(data);
          } catch (error) {
            console.error('WebSocket message parse error:', error);
          }
        };
        socket.onerror = (error) => {
          console.error('[WA-WS] Error:', error);
        };
        socket.onclose = () => {
          if (WHATSAPP_WS_DEBUG) console.info('[WA-WS] Closed');
        };
      };

      // Build candidate endpoints (user-scoped first), try sequentially
      const buildCandidates = async (): Promise<{ url: string; protocols?: string[] }[]> => {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token || '';
        const userId = sessionData.session?.user?.id || '';
        const labId = await database.getCurrentUserLabId();

        const toUrl = (path: string, withToken = true, withUserLab = true) => {
          const u = new URL(path, `${base.protocol}//${base.host}`);
          if (withUserLab) {
            if (userId) u.searchParams.set('userId', userId);
            if (labId) u.searchParams.set('labId', labId);
          }
          if (withToken && token) u.searchParams.set('token', token);
          return `${wsProtocol}//${u.host}${u.pathname}${u.search ? `?${u.searchParams.toString()}` : ''}`;
        };

        const urls: { url: string; protocols?: string[] }[] = [];

        const push = (url: string, withProtocols = false) => {
          if (withProtocols && token) {
            urls.push({ url, protocols: [token] });
            urls.push({ url, protocols: [`Bearer ${token}`] });
            urls.push({ url, protocols: [`jwt.${token}`] });
          }
          urls.push({ url });
        };

        // If explicit WS URL is provided, try it first (no params by default)
        if (WHATSAPP_WS_URL) {
          push(WHATSAPP_WS_URL, true);
        }

        // Try root /ws first, as used by the other app
        push(`${wsProtocol}//${base.host}/ws`, true);

        // New user-scoped
        push(toUrl(`/api/users/${encodeURIComponent(userId)}/whatsapp/status-updates`, true, true), true);
        push(toUrl(`/api/users/${encodeURIComponent(userId)}/whatsapp/status-updates`, false, true), true);

        // Legacy with explicit userId
        push(toUrl(`/api/whatsapp/status-updates`, true, true), true);
        push(toUrl(`/api/whatsapp/status-updates`, false, true), true);

        // Pure legacy without params
        push(`${wsProtocol}//${base.host}${WHATSAPP_API_PREFIX}/status-updates`, true);
        push(`${wsProtocol}//${base.host}/api/whatsapp/ws`, true);
        push(toUrl(`/api/users/${encodeURIComponent(userId)}/whatsapp/ws`, true, true), true);

        // Try access_token param variant
        const withAccessToken = (path: string) => {
          const u = new URL(path, `${base.protocol}//${base.host}`);
          if (userId) u.searchParams.set('userId', userId);
          if (labId) u.searchParams.set('labId', labId);
          if (token) u.searchParams.set('access_token', token);
          return `${wsProtocol}//${u.host}${u.pathname}?${u.searchParams.toString()}`;
        };
        push(withAccessToken(`/api/users/${encodeURIComponent(userId)}/whatsapp/status-updates`), false);
        push(withAccessToken(`/api/whatsapp/status-updates`), false);

        if (WHATSAPP_WS_DEBUG) {
          console.info('[WA-WS] Candidates (ordered):');
          urls.forEach((c, i) => console.info(`  [${i}]`, c.url, c.protocols ? '(with subprotocols)' : ''));
        }
        return urls;
      };

      let active: WebSocket | null = null;

      const tryConnect = (url: string, protocols?: string[]): Promise<WebSocket> => new Promise((resolve, reject) => {
        try {
          if (WHATSAPP_WS_DEBUG) console.info('[WA-WS] → trying', url, protocols?.length ? `with ${protocols.length} protocol(s)` : '');
          const s = protocols?.length ? new WebSocket(url, protocols) : new WebSocket(url);
          let settled = false;
          const timer = setTimeout(() => {
            if (settled) return;
            try { s.close(); } catch {}
            reject(new Error('WS open timeout'));
          }, 1500);
          s.onopen = () => {
            if (settled) return;
            clearTimeout(timer);
            settled = true;
            if (WHATSAPP_WS_DEBUG) console.info('[WA-WS] ✅ connected', url);
            resolve(s);
          };
          s.onerror = () => {
            if (settled) return;
            clearTimeout(timer);
            settled = true;
            if (WHATSAPP_WS_DEBUG) console.info('[WA-WS] ❌ error', url);
            reject(new Error('WS error'));
          };
        } catch (e) {
          reject(e);
        }
      });

      // Kick off sequential attempts
      (async () => {
        const candidates = await buildCandidates();
        for (const c of candidates) {
          try {
            const s = await tryConnect(c.url, c.protocols);
            // Close any previous
            if (active && active.readyState === WebSocket.OPEN) {
              try { active.close(); } catch {}
            }
            active = s;
            attachHandlers(active);
            break;
          } catch (e) {
            if (WHATSAPP_WS_DEBUG) console.info('[WA-WS] next candidate due to error:', (e as any)?.message || e);
          }
        }
        if (!active && WHATSAPP_WS_DEBUG) console.info('[WA-WS] All WS candidates failed; relying on HTTP polling only');
      })();

      return active;
    } catch (error) {
      console.error('WebSocket connection error:', error);
      return null;
    }
  }

  // Send document/PDF via WhatsApp
  static async sendDocument(
    to: string, 
    file: File, 
    options: {
      caption?: string;
      patientName?: string;
      testName?: string;
    } = {}
  ): Promise<MessageResult> {
    try {
      const { userId } = await this.getCurrentUserSession();
      const labId = await database.getCurrentUserLabId();
      if (!userId || !labId) {
        return {
          success: false,
          message: 'User or lab not available'
        };
      }

      // Format phone number
      const formattedPhone = this.formatPhoneNumber(to);
      if (!this.validatePhoneNumber(formattedPhone)) {
        return {
          success: false,
          message: 'Invalid phone number format'
        };
      }

      let whatsappSessionId: string | null = null;
      if (WHATSAPP_API_MODE === 'rest') {
        whatsappSessionId = await this.getWhatsAppSessionId();
        if (!whatsappSessionId) throw new Error('WhatsApp session not available');
      }

      // Create FormData
      const formData = new FormData();
      if (whatsappSessionId) formData.append('sessionId', whatsappSessionId);
      formData.append('userId', userId);
      formData.append('labId', labId);
      formData.append('phoneNumber', `+${formattedPhone}`);
      formData.append('file', file);
      
      if (options.caption) formData.append('caption', options.caption);
      if (options.patientName) formData.append('patientName', options.patientName);
      if (options.testName) formData.append('testName', options.testName);

      if (WHATSAPP_API_MODE === 'supabase-functions') {
        // Note: Supabase functions might need special handling for multipart/form-data
        return {
          success: false,
          message: 'Document sending via Supabase functions not implemented yet'
        };
      } else if (WHATSAPP_API_MODE === 'netlify-functions') {
        const response = await fetch('/.netlify/functions/send-report', {
          method: 'POST',
          body: formData,
          headers: {
            'Authorization': await this.getAuthHeader()
          }
        });
        const result = await response.json();
        return result;
      } else {
        const response = await fetch(
          apiUrl(`/users/${userId}/whatsapp/send-document`),
          {
            method: 'POST',
            body: formData,
            headers: {
              'Authorization': await this.getAuthHeader()
            }
          }
        );
        const result = await response.json();
        return result;
      }
    } catch (error) {
      console.error('WhatsApp send document error:', error);
      return {
        success: false,
        message: 'Failed to send document: ' + (error as Error).message
      };
    }
  }

  // Get auth header for requests
  private static async getAuthHeader(): Promise<string> {
    const now = Date.now();
    if (_authCache.token && now - _authCache.fetchedAt < 60_000) {
      return `Bearer ${_authCache.token}`;
    }
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    _authCache.token = token || null;
    _authCache.fetchedAt = now;
    return token ? `Bearer ${token}` : '';
  }

  // Utility functions
  static formatPhoneNumber(phone: string): string {
    // Remove all non-digits
    const digits = phone.replace(/\D/g, '');
    
    // Add country code if not present (assuming +91 for India)
    if (digits.length === 10) {
      return '91' + digits;
    } else if (digits.length === 12 && digits.startsWith('91')) {
      return digits;
    } else if (digits.length === 13 && digits.startsWith('091')) {
      return digits.substring(1);
    }
    
    return digits;
  }

  static validatePhoneNumber(phone: string): boolean {
    const formatted = this.formatPhoneNumber(phone);
    return /^91\d{10}$/.test(formatted);
  }
}

export default WhatsAppAPI;