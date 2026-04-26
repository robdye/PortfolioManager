// ──────────────────────────────────────────────────────────────
// Container Apps Module – Environment + Digital Worker + MCP Server
// Portfolio Manager domain adaptation
// ──────────────────────────────────────────────────────────────

@description('Environment name used in resource naming')
param environmentName string

@description('Azure region')
param location string

@description('Tags applied to every resource')
param tags object

@description('Log Analytics workspace customer ID')
param logAnalyticsCustomerId string

@description('Log Analytics workspace shared key')
@secure()
param logAnalyticsSharedKey string

@description('ACR login server')
param acrLoginServer string

@description('Application Insights connection string')
param appInsightsConnectionString string

@description('Azure OpenAI endpoint')
param openaiEndpoint string

@description('Cosmos DB endpoint')
param cosmosEndpoint string

@description('Redis hostname')
param redisHostName string

@description('Service Bus endpoint')
param serviceBusEndpoint string

@description('Key Vault name')
param keyVaultName string

@description('Content Safety endpoint')
param contentSafetyEndpoint string

@description('Speech endpoint')
param speechEndpoint string

@description('Speech region')
param speechRegion string

@description('AI Search endpoint')
param aiSearchEndpoint string

@description('Agent Blueprint App ID')
param agentAppId string

// ── Container Apps Environment ──────────────────────────────
resource containerAppsEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'pm-${environmentName}-cae'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsCustomerId
        sharedKey: logAnalyticsSharedKey
      }
    }
    zoneRedundant: false
  }
}

// ── Digital Worker Container App (port 3978) ────────────────
resource digitalWorker 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'pm-${environmentName}-worker'
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: containerAppsEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3978
        transport: 'http'
        allowInsecure: false
      }
      registries: [
        {
          server: acrLoginServer
          identity: 'system'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'digital-worker'
          image: '${acrLoginServer}/pm-digital-worker:latest'
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
          env: [
            { name: 'PORT', value: '3978' }
            { name: 'NODE_ENV', value: 'production' }
            { name: 'MicrosoftAppType', value: 'SingleTenant' }
            { name: 'MicrosoftAppId', value: agentAppId }
            { name: 'AZURE_OPENAI_ENDPOINT', value: openaiEndpoint }
            { name: 'AZURE_OPENAI_DEPLOYMENT', value: 'gpt-4o' }
            { name: 'AZURE_OPENAI_REASONING_DEPLOYMENT', value: 'o4-mini' }
            { name: 'AZURE_OPENAI_API_VERSION', value: '2024-12-01-preview' }
            { name: 'COSMOS_ENDPOINT', value: cosmosEndpoint }
            { name: 'COSMOS_DATABASE', value: 'portfolio-manager' }
            { name: 'REDIS_URL', value: 'rediss://${redisHostName}:6380' }
            { name: 'SERVICE_BUS_ENDPOINT', value: serviceBusEndpoint }
            { name: 'KEY_VAULT_NAME', value: keyVaultName }
            { name: 'CONTENT_SAFETY_ENDPOINT', value: contentSafetyEndpoint }
            { name: 'AZURE_SPEECH_ENDPOINT', value: speechEndpoint }
            { name: 'AZURE_SPEECH_REGION', value: speechRegion }
            { name: 'MCP_FINNHUB_ENDPOINT', value: 'https://pm-${environmentName}-mcp.${containerAppsEnv.properties.defaultDomain}' }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsightsConnectionString }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 5
        rules: [
          {
            name: 'http-scaling'
            http: {
              metadata: {
                concurrentRequests: '50'
              }
            }
          }
        ]
      }
    }
  }
}

// ── MCP Server Container App (port 3002) ────────────────────
resource mcpServer 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'pm-${environmentName}-mcp'
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: containerAppsEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3002
        transport: 'http'
        allowInsecure: false
      }
      registries: [
        {
          server: acrLoginServer
          identity: 'system'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'mcp-server'
          image: '${acrLoginServer}/pm-mcp-server:latest'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'PORT', value: '3002' }
            { name: 'SERVER_BASE_URL', value: 'https://pm-${environmentName}-mcp.${containerAppsEnv.properties.defaultDomain}' }
            { name: 'AZURE_SEARCH_ENDPOINT', value: aiSearchEndpoint }
            { name: 'KEY_VAULT_NAME', value: keyVaultName }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsightsConnectionString }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
}

// ── Outputs ─────────────────────────────────────────────────
output containerAppsEnvId string = containerAppsEnv.id
output containerAppsEnvName string = containerAppsEnv.name
output containerAppsEnvDomain string = containerAppsEnv.properties.defaultDomain
output digitalWorkerFqdn string = digitalWorker.properties.configuration.ingress.fqdn
output digitalWorkerPrincipalId string = digitalWorker.identity.principalId
output mcpServerFqdn string = mcpServer.properties.configuration.ingress.fqdn
output mcpServerPrincipalId string = mcpServer.identity.principalId
