// Copyright (c) Microsoft Corporation. Licensed under the MIT License.
// Portfolio Manager Digital Worker — Token cache for observability

import { configDotenv } from 'dotenv';
configDotenv();

const cache = new Map<string, string>();

export function createAgenticTokenCacheKey(agentId: string, tenantId: string): string {
  return `${agentId}:${tenantId}`;
}

export function tokenResolver(agentId: string, tenantId: string): string {
  const key = createAgenticTokenCacheKey(agentId, tenantId);
  return cache.get(key) || '';
}

export default cache;
