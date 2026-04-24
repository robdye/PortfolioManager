// Copyright (c) Microsoft Corporation. Licensed under the MIT License.
// Portfolio Manager Digital Worker — OpenAI configuration

import { configDotenv } from 'dotenv';
configDotenv();

import OpenAI from 'openai';
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';

let openaiClient: OpenAI | undefined;

export function isAzureOpenAI(): boolean {
  return !!process.env.AZURE_OPENAI_ENDPOINT;
}

export function getModelName(): string {
  if (isAzureOpenAI()) {
    return process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o';
  }
  return process.env.OPENAI_MODEL || 'gpt-4o';
}

export function configureOpenAIClient(): void {
  if (isAzureOpenAI()) {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT!;
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o';
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-10-21';

    if (process.env.AZURE_OPENAI_API_KEY) {
      // Use API key if available
      openaiClient = new OpenAI({
        apiKey: process.env.AZURE_OPENAI_API_KEY,
        baseURL: `${endpoint}openai/deployments/${deployment}`,
        defaultQuery: { 'api-version': apiVersion },
        defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY },
      });
      console.log('[OpenAI] Configured with Azure OpenAI API key');
    } else {
      // Use Managed Identity (DefaultAzureCredential)
      const credential = new DefaultAzureCredential();
      const scope = 'https://cognitiveservices.azure.com/.default';
      const azureADTokenProvider = getBearerTokenProvider(credential, scope);

      openaiClient = new OpenAI({
        apiKey: '',
        baseURL: `${endpoint}openai/deployments/${deployment}`,
        defaultQuery: { 'api-version': apiVersion },
        fetch: async (url: any, init: any) => {
          const token = await azureADTokenProvider();
          const headers = new Headers(init?.headers);
          headers.set('Authorization', `Bearer ${token}`);
          return fetch(url, { ...init, headers });
        },
      });
      console.log('[OpenAI] Configured with Azure Managed Identity');
    }
  } else if (process.env.OPENAI_API_KEY) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log('[OpenAI] Configured with OpenAI API key');
  } else {
    console.warn('[OpenAI] No API key or Azure endpoint configured');
  }
}

export function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    configureOpenAIClient();
  }
  return openaiClient!;
}
