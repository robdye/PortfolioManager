// ──────────────────────────────────────────────────────────────
// Identity Module – User-Assigned Managed Identities + RBAC Assignments
// Portfolio Manager domain adaptation: market-reader, trade-executor, comms
// ──────────────────────────────────────────────────────────────

@description('Environment name used in resource naming')
param environmentName string

@description('Azure region')
param location string

@description('Tags applied to every resource')
param tags object

@description('Principal ID of the Digital Worker Container App system MI')
param digitalWorkerPrincipalId string

@description('Key Vault resource ID for role scoping')
param keyVaultId string

@description('Azure OpenAI resource ID for role scoping')
param openaiId string

@description('Content Safety resource ID for role scoping')
param contentSafetyId string

@description('Speech resource ID for role scoping')
param speechId string

@description('Cosmos DB account resource ID for role scoping')
param cosmosAccountId string

@description('Service Bus namespace resource ID for role scoping')
param serviceBusId string

// ── Well-known Azure RBAC role definition IDs ───────────────
var roles = {
  keyVaultSecretsUser: '4633458b-17de-408a-b874-0445c86b69e6'
  cognitiveServicesUser: 'a97b65f3-24c7-4388-baec-2e87135dc908'
  cosmosDbDataContributor: '00000000-0000-0000-0000-000000000002'
  cosmosDbDataReader: '00000000-0000-0000-0000-000000000001'
  serviceBusDataOwner: '090c5cfd-751d-490a-894a-3ce6f1109419'
  monitoringMetricsPublisher: '3913510d-42f4-4e42-8a64-420c390055eb'
}

// ── User-Assigned Managed Identities ────────────────────────

// Market Reader – read-only access to market data APIs
resource marketReaderIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'pm-${environmentName}-mi-market-reader'
  location: location
  tags: tags
}

// Trade Executor – write access to Dataverse trade orders
resource tradeExecutorIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'pm-${environmentName}-mi-trade-executor'
  location: location
  tags: tags
}

// Communications – email/Teams outbound messaging
resource commsIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'pm-${environmentName}-mi-comms'
  location: location
  tags: tags
}

// ── RBAC Assignments for Digital Worker System MI ────────────

resource kvSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVaultId, digitalWorkerPrincipalId, roles.keyVaultSecretsUser)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.keyVaultSecretsUser)
    principalId: digitalWorkerPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource openaiCogUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(openaiId, digitalWorkerPrincipalId, roles.cognitiveServicesUser)
  scope: openaiAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.cognitiveServicesUser)
    principalId: digitalWorkerPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource safetyCogUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(contentSafetyId, digitalWorkerPrincipalId, roles.cognitiveServicesUser)
  scope: contentSafetyAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.cognitiveServicesUser)
    principalId: digitalWorkerPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource speechCogUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(speechId, digitalWorkerPrincipalId, roles.cognitiveServicesUser)
  scope: speechAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.cognitiveServicesUser)
    principalId: digitalWorkerPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource cosmosDataContributor 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  name: guid(cosmosAccountId, digitalWorkerPrincipalId, roles.cosmosDbDataContributor)
  parent: cosmosAccount
  properties: {
    roleDefinitionId: '${cosmosAccountId}/sqlRoleDefinitions/${roles.cosmosDbDataContributor}'
    principalId: digitalWorkerPrincipalId
    scope: cosmosAccountId
  }
}

resource cosmosDataReader 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  name: guid(cosmosAccountId, digitalWorkerPrincipalId, roles.cosmosDbDataReader)
  parent: cosmosAccount
  properties: {
    roleDefinitionId: '${cosmosAccountId}/sqlRoleDefinitions/${roles.cosmosDbDataReader}'
    principalId: digitalWorkerPrincipalId
    scope: cosmosAccountId
  }
}

resource sbDataOwner 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(serviceBusId, digitalWorkerPrincipalId, roles.serviceBusDataOwner)
  scope: serviceBusNamespace
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.serviceBusDataOwner)
    principalId: digitalWorkerPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource monitoringPublisher 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, digitalWorkerPrincipalId, roles.monitoringMetricsPublisher)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.monitoringMetricsPublisher)
    principalId: digitalWorkerPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// ── Existing resource references for scoping ────────────────
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: 'pm-${environmentName}-kv'
}

resource openaiAccount 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: 'pm-${environmentName}-openai'
}

resource contentSafetyAccount 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: 'pm-${environmentName}-safety'
}

resource speechAccount 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: 'pm-${environmentName}-speech'
}

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' existing = {
  name: 'pm-${environmentName}-cosmos'
}

resource serviceBusNamespace 'Microsoft.ServiceBus/namespaces@2022-10-01-preview' existing = {
  name: 'pm-${environmentName}-sb'
}

// ── Outputs ─────────────────────────────────────────────────
output marketReaderPrincipalId string = marketReaderIdentity.properties.principalId
output marketReaderClientId string = marketReaderIdentity.properties.clientId
output marketReaderResourceId string = marketReaderIdentity.id
output tradeExecutorPrincipalId string = tradeExecutorIdentity.properties.principalId
output tradeExecutorClientId string = tradeExecutorIdentity.properties.clientId
output tradeExecutorResourceId string = tradeExecutorIdentity.id
output commsPrincipalId string = commsIdentity.properties.principalId
output commsClientId string = commsIdentity.properties.clientId
output commsResourceId string = commsIdentity.id
