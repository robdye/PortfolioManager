// Copyright (c) Microsoft Corporation. Licensed under the MIT License.
// Portfolio Manager Digital Worker — Conversation memory

/**
 * Simple in-memory conversation history per user.
 * Keeps the last N messages for context continuity.
 */
const MAX_HISTORY = 10;

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

const conversations = new Map<string, Message[]>();

export function addMessage(userId: string, role: 'user' | 'assistant', content: string): void {
  if (!conversations.has(userId)) {
    conversations.set(userId, []);
  }
  const history = conversations.get(userId)!;
  history.push({ role, content, timestamp: Date.now() });
  // Keep only the last MAX_HISTORY messages
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
}

export function getHistory(userId: string): string {
  const history = conversations.get(userId);
  if (!history || history.length === 0) return '';

  return history.map(m => `${m.role === 'user' ? 'User' : 'PM Agent'}: ${m.content.substring(0, 300)}`).join('\n');
}

export function clearHistory(userId: string): void {
  conversations.delete(userId);
}
