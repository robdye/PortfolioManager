/**
 * Portfolio Manager — Azure Service Bus
 * Event-driven inter-worker messaging for the investment desk.
 *
 * Topics:
 * - pm-signals: decision engine detections (consumed by all workers)
 * - pm-trades: trade proposals and executions
 * - pm-compliance: limit breaches, regulatory alerts
 * - pm-notifications: outbound alerts to Teams/email
 */

import crypto from 'crypto';
import { ServiceBusClient, ServiceBusSender, ServiceBusReceiver, ServiceBusReceivedMessage } from '@azure/service-bus';

// ── Configuration ──
const SERVICE_BUS_CONNECTION = process.env.SERVICE_BUS_CONNECTION_STRING || '';

let client: ServiceBusClient | null = null;
const senders = new Map<string, ServiceBusSender>();
const receivers = new Map<string, ServiceBusReceiver>();

// ── Topic Definitions ──
export const TOPICS = {
  SIGNALS: 'pm-signals',
  TRADES: 'pm-trades',
  COMPLIANCE: 'pm-compliance',
  NOTIFICATIONS: 'pm-notifications',
} as const;

export type TopicName = (typeof TOPICS)[keyof typeof TOPICS];

// ── Event Types ──
export interface ServiceBusEvent<T = Record<string, unknown>> {
  eventType: string;
  source: string;
  timestamp: string;
  correlationId: string;
  data: T;
}

export interface SignalEvent {
  signalType: string;
  symbols: string[];
  severity: 'critical' | 'warning' | 'info';
  detail: string;
  sourceWorker?: string;
}

export interface TradeEvent {
  tradeId: string;
  symbol: string;
  action: 'proposed' | 'approved' | 'rejected' | 'executed' | 'cancelled';
  side: 'buy' | 'sell';
  quantity: number;
  price?: number;
  workerId: string;
}

export interface ComplianceEvent {
  eventType: 'limit-breach' | 'restriction-hit' | 'mandate-violation' | 'audit-flag';
  detail: string;
  severity: 'critical' | 'warning';
  affectedSymbols?: string[];
}

export interface NotificationEvent {
  channel: 'teams' | 'email' | 'adaptive-card';
  recipient: string;
  subject: string;
  body: string;
  priority: 'high' | 'normal' | 'low';
}

// ── Initialization ──

export function isServiceBusEnabled(): boolean {
  return !!SERVICE_BUS_CONNECTION;
}

export async function initServiceBus(): Promise<void> {
  if (!isServiceBusEnabled()) {
    console.log('[ServiceBus] Not configured — using local event dispatch');
    return;
  }

  try {
    client = new ServiceBusClient(SERVICE_BUS_CONNECTION);
    console.log('[ServiceBus] Connected to Azure Service Bus');
  } catch (err) {
    console.error('[ServiceBus] Connection failed:', (err as Error).message);
  }
}

// ── Publishing ──

async function getSender(topic: TopicName): Promise<ServiceBusSender | null> {
  if (!client) return null;
  if (!senders.has(topic)) {
    senders.set(topic, client.createSender(topic));
  }
  return senders.get(topic)!;
}

export async function publishEvent<T>(
  topic: TopicName,
  eventType: string,
  data: T,
  correlationId?: string,
): Promise<void> {
  const event: ServiceBusEvent<T> = {
    eventType,
    source: 'pm-digital-worker',
    timestamp: new Date().toISOString(),
    correlationId: correlationId || crypto.randomUUID(),
    data,
  };

  const sender = await getSender(topic);
  if (sender) {
    try {
      await sender.sendMessages({
        body: event,
        subject: eventType,
        correlationId: event.correlationId,
        applicationProperties: { eventType, source: event.source },
      });
      console.log(`[ServiceBus] Published ${eventType} to ${topic}`);
    } catch (err) {
      console.error(`[ServiceBus] Publish failed for ${topic}:`, (err as Error).message);
      dispatchLocal(topic, event);
    }
  } else {
    dispatchLocal(topic, event);
  }
}

// ── Subscribing ──

type EventHandler = (event: ServiceBusEvent) => Promise<void>;
const localHandlers = new Map<string, EventHandler[]>();

export function subscribe(
  topic: TopicName,
  subscription: string,
  handler: EventHandler,
): void {
  const key = `${topic}:${subscription}`;
  if (!localHandlers.has(key)) localHandlers.set(key, []);
  localHandlers.get(key)!.push(handler);

  if (client) {
    try {
      const receiver = client.createReceiver(topic, subscription);
      receivers.set(key, receiver);

      receiver.subscribe({
        processMessage: async (message: ServiceBusReceivedMessage) => {
          try {
            await handler(message.body as ServiceBusEvent);
            await receiver.completeMessage(message);
          } catch (err) {
            console.error(`[ServiceBus] Handler error for ${key}:`, (err as Error).message);
          }
        },
        processError: async (args) => {
          console.error(`[ServiceBus] Receiver error for ${key}:`, args.error.message);
        },
      });

      console.log(`[ServiceBus] Subscribed: ${subscription} on ${topic}`);
    } catch (err) {
      console.error(`[ServiceBus] Subscribe failed for ${key}:`, (err as Error).message);
    }
  }
}

// ── Local Fallback ──

function dispatchLocal<T>(topic: TopicName, event: ServiceBusEvent<T>): void {
  for (const [key, handlers] of localHandlers.entries()) {
    if (key.startsWith(topic)) {
      for (const handler of handlers) {
        handler(event as ServiceBusEvent).catch(err =>
          console.error(`[ServiceBus:Local] Handler error:`, (err as Error).message)
        );
      }
    }
  }
}

// ── Convenience Publishers ──

export const publishSignalEvent = (data: SignalEvent, correlationId?: string) =>
  publishEvent(TOPICS.SIGNALS, `signal.${data.signalType}`, data, correlationId);

export const publishTradeEvent = (data: TradeEvent, correlationId?: string) =>
  publishEvent(TOPICS.TRADES, `trade.${data.action}`, data, correlationId);

export const publishComplianceEvent = (data: ComplianceEvent, correlationId?: string) =>
  publishEvent(TOPICS.COMPLIANCE, `compliance.${data.eventType}`, data, correlationId);

export const publishNotificationEvent = (data: NotificationEvent, correlationId?: string) =>
  publishEvent(TOPICS.NOTIFICATIONS, `notification.${data.channel}`, data, correlationId);

// ── Cleanup ──

export async function closeServiceBus(): Promise<void> {
  for (const [, receiver] of receivers) {
    await receiver.close().catch(() => {});
  }
  for (const [, sender] of senders) {
    await sender.close().catch(() => {});
  }
  await client?.close();
  receivers.clear();
  senders.clear();
  client = null;
  console.log('[ServiceBus] Closed all connections');
}

// ── Status ──

export function getServiceBusStatus(): {
  enabled: boolean;
  connected: boolean;
  topics: string[];
  activeSubscriptions: number;
} {
  return {
    enabled: isServiceBusEnabled(),
    connected: client !== null,
    topics: Object.values(TOPICS),
    activeSubscriptions: receivers.size,
  };
}
