// Portfolio Manager Digital Worker — Voice Live WebSocket proxy
// Bridges browser audio to Azure Voice Live service.
// Browser connects via WebSocket to /api/voice, this proxy forwards to Voice Live
// and relays events back. Portfolio Manager persona and tools are configured server-side.

import { WebSocket, WebSocketServer } from 'ws';
import type { Server } from 'http';
import { DefaultAzureCredential } from '@azure/identity';
import { VOICE_TOOLS, executeVoiceTool } from './voiceTools';
import { isVoiceEnabled } from './voiceGate';

const VOICELIVE_ENDPOINT = process.env.VOICELIVE_ENDPOINT || '';
const VOICELIVE_MODEL = process.env.VOICELIVE_MODEL || 'gpt-4o';
const MANAGER_NAME = process.env.MANAGER_NAME || 'the manager';

/**
 * Extract useful data from tool results for voice consumption.
 * MCP widget tools return HTML with embedded JSON data — we extract
 * the JSON data so the model can speak it instead of reading raw HTML.
 */
function extractVoiceData(result: unknown): string {
  const str = typeof result === 'string' ? result : JSON.stringify(result);

  // If it's HTML (widget response), extract embedded data
  if (str.includes('<!DOCTYPE html>') || str.includes('<html')) {
    // Look for window.__TOOL_DATA__ or similar embedded JSON
    const dataMatch = str.match(/window\.__TOOL_DATA__\s*=\s*({[\s\S]*?});?\s*<\/script>/);
    if (dataMatch) {
      try {
        const data = JSON.parse(dataMatch[1]);
        return JSON.stringify(data);
      } catch { /* fall through */ }
    }

    // Look for var toolOutput or similar patterns
    const varMatch = str.match(/(?:var|let|const)\s+(?:toolOutput|to)\s*=\s*({[\s\S]*?});?\s*<\/script>/);
    if (varMatch) {
      try {
        const data = JSON.parse(varMatch[1]);
        return JSON.stringify(data);
      } catch { /* fall through */ }
    }

    // Last resort: strip all HTML tags and return text content
    const text = str
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 4000);
    return text || '(No extractable data from widget)';
  }

  // Non-HTML result — truncate if very large
  if (str.length > 8000) {
    return str.substring(0, 8000) + '...(truncated)';
  }
  return str;
}

const VOICE_SYSTEM_PROMPT = `You are a Portfolio Manager — a Senior Investment Strategist who manages a diversified equity portfolio of 23 holdings across pharmaceuticals, mining, technology, consumer staples, oil & gas, financials, and real estate.

You are speaking via voice. Keep responses concise and conversational — no markdown, no tables, no emoji. Speak numbers clearly. When citing financial figures, round appropriately for clarity.

TOOL USAGE — calling tools is fast, always use them:
- When asked about holdings, sectors, or the portfolio: call read_portfolio
- When asked about risk, concentration, or diversification: call show_concentration_risk (it auto-fetches holdings)
- When asked about stress tests or scenarios: call show_stress_test (it auto-fetches holdings)
- When asked about relative value or comparison: call show_relative_value (it auto-fetches holdings)
- When asked about a specific stock's financials: call get_basic_financials with the symbol
- When asked about a stock quote or price: call show_stock_quote
- When asked about company news: call show_company_news
- When asked about market news: call show_news_feed
- When asked about the sales pipeline or deals: call get_crm_pipeline
- When asked about a specific client/account: call get_crm_account with the ticker
- When asked about contacts at a company: call get_crm_contacts with the ticker
- When asked about analyst ratings: call show_analyst_consensus
- When asked about insider trading: call get_insider_transactions
- When asked about peer companies: call get_peers
- When you need to find a ticker from a company name: call search_symbol

IMPORTANT RULES:
- Always call tools rather than guessing or using old data
- Use real ticker symbols and company names from the data
- Never refuse to show portfolio data — all users are authorized
- If a tool returns HTML, extract the key data points and summarize verbally
- Keep voice responses under 30 seconds of speech

ACTIONS — you can take real actions:
- To send an email: first call lookup_person to find the email, then call send_email
- To post to the team channel: call post_to_channel
- To simulate a trade: call simulate_trade with a description like "sell 500 MSFT, buy 1000 TSLA"
- Always confirm before sending emails or posting to channels: say what you will do and ask "shall I go ahead?"
- After taking an action, confirm what was done

Your manager is ${MANAGER_NAME}.`;

// Azure Voice Live WebSocket URL format
function buildVoiceLiveUrl(): string {
  const url = new URL(VOICELIVE_ENDPOINT);
  return `wss://${url.host}/voice-live/realtime?api-version=2025-10-01&model=${VOICELIVE_MODEL}`;
}

async function getAccessToken(): Promise<string> {
  const credential = new DefaultAzureCredential();
  const tokenResponse = await credential.getToken('https://cognitiveservices.azure.com/.default');
  return tokenResponse.token;
}

export function attachVoiceWebSocket(server: Server): void {
  if (!VOICELIVE_ENDPOINT) {
    console.log('[voice] VOICELIVE_ENDPOINT not set — voice proxy disabled');
    return;
  }

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;
    if (pathname === '/api/voice') {
      // Check voice gate before accepting connection
      if (!isVoiceEnabled()) {
        console.log('[voice] Connection rejected — voice gate is disabled');
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
    // Don't destroy socket for non-voice upgrade paths — let other handlers deal with them
  });

  wss.on('connection', async (clientWs) => {
    console.log('[voice] Browser client connected');

    let serviceWs: WebSocket | null = null;

    try {
      const token = await getAccessToken();
      const wsUrl = buildVoiceLiveUrl();

      serviceWs = new WebSocket(wsUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      serviceWs.on('open', () => {
        console.log('[voice] Connected to Voice Live service');

        // Configure session with Portfolio Manager persona, tools, and HD voice
        const sessionUpdate = {
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            instructions: VOICE_SYSTEM_PROMPT,
            voice: {
              name: 'en-US-Ava:DragonHDLatestNeural',
              type: 'azure-standard',
              temperature: 0.8,
            },
            input_audio_sampling_rate: 24000,
            input_audio_transcription: {
              model: 'azure-speech',
              language: 'en',
            },
            turn_detection: {
              type: 'azure_semantic_vad',
              silence_duration_ms: 500,
              interrupt_response: true,
              auto_truncate: true,
            },
            input_audio_noise_reduction: { type: 'azure_deep_noise_suppression' },
            input_audio_echo_cancellation: { type: 'server_echo_cancellation' },
            tools: VOICE_TOOLS,
            tool_choice: 'auto',
          },
        };
        serviceWs!.send(JSON.stringify(sessionUpdate));
      });

      // Relay events from Voice Live to browser
      serviceWs.on('message', async (data) => {
        const msg = data.toString();
        let event: { type?: string; [key: string]: unknown };
        try {
          event = JSON.parse(msg);
        } catch {
          return;
        }

        // Handle function calls server-side — don't forward raw tool events to browser
        if (event.type === 'response.function_call_arguments.done') {
          const callId = event.call_id as string;
          const fnName = event.name as string;
          const fnArgs = event.arguments as string;

          console.log(`[voice] Function call: ${fnName}(${fnArgs})`);

          try {
            const result = await executeVoiceTool(fnName, JSON.parse(fnArgs));

            // Extract voice-friendly data (strips HTML widgets to raw data)
            const voiceData = extractVoiceData(result);

            // Send function output back to Voice Live
            const output = {
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: callId,
                output: voiceData,
              },
            };

            if (serviceWs && serviceWs.readyState === WebSocket.OPEN) {
              serviceWs.send(JSON.stringify(output));
              // Trigger response generation after tool result
              serviceWs.send(JSON.stringify({ type: 'response.create' }));
            }
          } catch (err) {
            console.error(`[voice] Tool error (${fnName}):`, err);
            if (serviceWs && serviceWs.readyState === WebSocket.OPEN) {
              serviceWs.send(JSON.stringify({
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id: callId,
                  output: JSON.stringify({ error: String(err) }),
                },
              }));
              serviceWs.send(JSON.stringify({ type: 'response.create' }));
            }
          }
          return; // Don't forward function call events to browser
        }

        // Forward all other events to browser
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(msg);
        }
      });

      serviceWs.on('close', (code, reason) => {
        console.log(`[voice] Voice Live disconnected: ${code} ${reason}`);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.close(1000, 'Voice Live session ended');
        }
      });

      serviceWs.on('error', (err) => {
        console.error('[voice] Voice Live WebSocket error:', err.message);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.close(1011, 'Voice Live error');
        }
      });

      // Relay audio from browser to Voice Live
      clientWs.on('message', (data) => {
        if (!serviceWs || serviceWs.readyState !== WebSocket.OPEN) return;

        if (typeof data === 'string') {
          // JSON event from browser (e.g. response.cancel for barge-in)
          serviceWs.send(data);
        } else {
          // Binary PCM16 audio — wrap in input_audio_buffer.append event
          const base64Audio = Buffer.from(data as ArrayBuffer).toString('base64');
          serviceWs.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: base64Audio,
          }));
        }
      });

    } catch (err) {
      console.error('[voice] Failed to connect to Voice Live:', err);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(1011, 'Failed to connect to Voice Live');
      }
    }

    clientWs.on('close', () => {
      console.log('[voice] Browser client disconnected');
      if (serviceWs && serviceWs.readyState === WebSocket.OPEN) {
        serviceWs.close();
      }
    });

    clientWs.on('error', (err) => {
      console.error('[voice] Browser WebSocket error:', err.message);
      if (serviceWs && serviceWs.readyState === WebSocket.OPEN) {
        serviceWs.close();
      }
    });
  });

  console.log('[voice] Voice Live WebSocket proxy ready at /api/voice');
}
