// ──────────────────────────────────────────────────────────────
// Portfolio Manager Digital Worker – Main Bicep Orchestration
// Deploys ALL Azure infrastructure for the Portfolio Manager platform
// ──────────────────────────────────────────────────────────────

targetScope = 'resourceGroup'

// ── Parameters ──────────────────────────────────────────────

@description('Environment name (used as suffix for all resource names)')
param environmentName string

@description('Azure region for resource deployment')
param location string = resourceGroup().location

@description('Agent Blueprint App ID (Microsoft Entra application)')
param agentAppId string = '871592dc-ffa9-42d0-aa31-46a679817d26'

@description('Finnhub API key (stored in Key Vault)')
@secure()
param finnhubApiKey string = ''

@description('Dataverse client secret (stored in Key Vault)')
@secure()
param dataverseClientSecret string = ''

// ── Tags ────────────────────────────────────────────────────
var tags = {
  project: 'portfolio-manager'
  environment: environmentName
}

// ── Derived resource names ──────────────────────────────────
var logAnalyticsName = 'pm-${environmentName}-law'
var storageAccountName = 'pm${environmentName}st'

// ──────────────────────────────────────────────────────────────
// 1. Container Registry (ACR)
// ──────────────────────────────────────────────────────────────
resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: 'pm${environmentName}acr'
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
  }
}

// ──────────────────────────────────────────────────────────────
// 2. Key Vault (secrets store)
// ──────────────────────────────────────────────────────────────
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'pm-${environmentName}-kv'
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: {
      name: 'standard'
      family: 'A'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enabledForDeployment: false
    enabledForDiskEncryption: false
    enabledForTemplateDeployment: true
  }
}

resource secretFinnhubApiKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(finnhubApiKey)) {
  parent: keyVault
  name: 'finnhub-api-key'
  properties: {
    value: finnhubApiKey
  }
}

resource secretDataverseClientSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(dataverseClientSecret)) {
  parent: keyVault
  name: 'dataverse-client-secret'
  properties: {
    value: dataverseClientSecret
  }
}

// ──────────────────────────────────────────────────────────────
// 3. Monitoring (Log Analytics + App Insights + KQL Alerts)
// ──────────────────────────────────────────────────────────────
module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring-deployment'
  params: {
    environmentName: environmentName
    location: location
    tags: tags
  }
}

// ──────────────────────────────────────────────────────────────
// 4. Cognitive Services (OpenAI + Content Safety + Speech)
// ──────────────────────────────────────────────────────────────
module cognitiveServices 'modules/cognitive-services.bicep' = {
  name: 'cognitive-services-deployment'
  params: {
    environmentName: environmentName
    location: location
    tags: tags
  }
}

// ──────────────────────────────────────────────────────────────
// 5. Data Services (Cosmos DB + Redis + Service Bus + AI Search + Storage)
// ──────────────────────────────────────────────────────────────
module dataServices 'modules/data-services.bicep' = {
  name: 'data-services-deployment'
  params: {
    environmentName: environmentName
    location: location
    tags: tags
  }
}

resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: logAnalyticsName
  dependsOn: [
    monitoring
  ]
}

resource storageAccountRef 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
  dependsOn: [
    dataServices
  ]
}

// ──────────────────────────────────────────────────────────────
// 6. Container Apps (Environment + Digital Worker + MCP Server)
// ──────────────────────────────────────────────────────────────
module containerApps 'modules/container-apps.bicep' = {
  name: 'container-apps-deployment'
  params: {
    environmentName: environmentName
    location: location
    tags: tags
    logAnalyticsCustomerId: monitoring.outputs.logAnalyticsCustomerId
    logAnalyticsSharedKey: logAnalyticsWorkspace.listKeys().primarySharedKey
    acrLoginServer: acr.properties.loginServer
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
    openaiEndpoint: cognitiveServices.outputs.openaiEndpoint
    cosmosEndpoint: dataServices.outputs.cosmosEndpoint
    redisHostName: dataServices.outputs.redisHostName
    serviceBusEndpoint: dataServices.outputs.serviceBusEndpoint
    keyVaultName: keyVault.name
    contentSafetyEndpoint: cognitiveServices.outputs.contentSafetyEndpoint
    speechEndpoint: cognitiveServices.outputs.speechEndpoint
    speechRegion: cognitiveServices.outputs.speechRegion
    aiSearchEndpoint: dataServices.outputs.aiSearchEndpoint
    agentAppId: agentAppId
  }
}

// ──────────────────────────────────────────────────────────────
// 7. AI Foundry (Hub + Project + OpenAI Connection)
// ──────────────────────────────────────────────────────────────
module aiFoundry 'modules/ai-foundry.bicep' = {
  name: 'ai-foundry-deployment'
  params: {
    environmentName: environmentName
    location: location
    tags: tags
    storageAccountId: dataServices.outputs.storageAccountId
    keyVaultId: keyVault.id
    appInsightsId: monitoring.outputs.appInsightsId
    openaiResourceId: cognitiveServices.outputs.openaiId
    openaiEndpoint: cognitiveServices.outputs.openaiEndpoint
  }
}

// ──────────────────────────────────────────────────────────────
// 8. Identity (User-Assigned MIs + RBAC Role Assignments)
// ──────────────────────────────────────────────────────────────
module identity 'modules/identity.bicep' = {
  name: 'identity-deployment'
  params: {
    environmentName: environmentName
    location: location
    tags: tags
    digitalWorkerPrincipalId: containerApps.outputs.digitalWorkerPrincipalId
    keyVaultId: keyVault.id
    openaiId: cognitiveServices.outputs.openaiId
    contentSafetyId: cognitiveServices.outputs.contentSafetyId
    speechId: cognitiveServices.outputs.speechId
    cosmosAccountId: dataServices.outputs.cosmosAccountId
    serviceBusId: dataServices.outputs.serviceBusId
  }
}

// ── ACR Pull role for Digital Worker & MCP Server system MIs ─
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource acrPullWorker 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, 'digital-worker', acrPullRoleId)
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: containerApps.outputs.digitalWorkerPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource acrPullMcp 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, 'mcp-server', acrPullRoleId)
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: containerApps.outputs.mcpServerPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// ──────────────────────────────────────────────────────────────
// Outputs
// ──────────────────────────────────────────────────────────────

output digitalWorkerUrl string = 'https://${containerApps.outputs.digitalWorkerFqdn}'
output mcpServerUrl string = 'https://${containerApps.outputs.mcpServerFqdn}'
output containerAppsEnvironment string = containerApps.outputs.containerAppsEnvName
output acrLoginServer string = acr.properties.loginServer
output openaiEndpoint string = cognitiveServices.outputs.openaiEndpoint
output contentSafetyEndpoint string = cognitiveServices.outputs.contentSafetyEndpoint
output speechEndpoint string = cognitiveServices.outputs.speechEndpoint
output cosmosEndpoint string = dataServices.outputs.cosmosEndpoint
output redisHostName string = dataServices.outputs.redisHostName
output serviceBusEndpoint string = dataServices.outputs.serviceBusEndpoint
output aiSearchEndpoint string = dataServices.outputs.aiSearchEndpoint
output appInsightsConnectionString string = monitoring.outputs.appInsightsConnectionString
output logAnalyticsWorkspaceId string = monitoring.outputs.logAnalyticsWorkspaceId
output keyVaultName string = keyVault.name
output keyVaultUri string = keyVault.properties.vaultUri
output aiHubName string = aiFoundry.outputs.aiHubName
output aiProjectName string = aiFoundry.outputs.aiProjectName
output marketReaderPrincipalId string = identity.outputs.marketReaderPrincipalId
output tradeExecutorPrincipalId string = identity.outputs.tradeExecutorPrincipalId
output commsPrincipalId string = identity.outputs.commsPrincipalId
