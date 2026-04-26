// Portfolio Manager — Secret Resolver
// Resolves secrets from Azure Key Vault at startup, falls back to env vars.
// Ported from ITSM Ops pattern, adapted for PM domain secrets.

import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';

let secretClient: SecretClient | null = null;

/** Map of Key Vault secret names → environment variable names they populate */
const SECRET_MAP: Record<string, string[]> = {
  'agent-blueprint-client-secret': [
    'connections__service_connection__settings__clientSecret',
    'agent365Observability__clientSecret',
  ],
  'finnhub-api-key': ['FINNHUB_API_KEY'],
  'dataverse-client-secret': ['DATAVERSE_CLIENT_SECRET'],
  'graph-app-secret': ['GRAPH_APP_SECRET'],
  'cosmos-connection-string': ['COSMOS_CONNECTION_STRING'],
  'redis-connection-string': ['REDIS_CONNECTION_STRING'],
  'service-bus-connection-string': ['SERVICE_BUS_CONNECTION_STRING'],
};

/**
 * Resolve secrets from Azure Key Vault and set them as process.env values.
 * Falls back to environment variables when KEY_VAULT_NAME is not configured.
 */
export async function resolveSecrets(): Promise<void> {
  const vaultName = process.env.KEY_VAULT_NAME;

  if (!vaultName) {
    console.log('[SecretResolver] KEY_VAULT_NAME not set — secrets loaded from environment variables');
    return;
  }

  const vaultUrl = `https://${vaultName}.vault.azure.net`;
  console.log(`[SecretResolver] Resolving secrets from Key Vault: ${vaultUrl}`);

  const credential = new DefaultAzureCredential();
  secretClient = new SecretClient(vaultUrl, credential);

  for (const [secretName, envVars] of Object.entries(SECRET_MAP)) {
    try {
      const secret = await secretClient.getSecret(secretName);
      const value = secret.value || '';
      for (const envVar of envVars) {
        process.env[envVar] = value;
      }
      console.log(`[SecretResolver] ✓ ${secretName} → ${envVars.join(', ')} (${value.length} chars)`);
    } catch (err) {
      console.error(`[SecretResolver] ✗ Failed to resolve ${secretName}:`, (err as Error).message);
    }
  }
}

/**
 * Retrieve a secret on-demand from Key Vault.
 * Returns the secret value, or undefined if Key Vault is not configured.
 */
export async function getSecret(name: string): Promise<string | undefined> {
  if (!secretClient) {
    return process.env[name];
  }

  try {
    const secret = await secretClient.getSecret(name);
    return secret.value || undefined;
  } catch (err) {
    console.error(`[SecretResolver] Failed to get secret "${name}":`, (err as Error).message);
    return undefined;
  }
}
