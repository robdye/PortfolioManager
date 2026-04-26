// ──────────────────────────────────────────────────────────────
// Data Services Module – Cosmos DB, Redis, Service Bus, AI Search, Storage
// Portfolio Manager domain adaptation
// ──────────────────────────────────────────────────────────────

@description('Environment name used in resource naming')
param environmentName string

@description('Azure region for all resources')
param location string

@description('Tags applied to every resource')
param tags object

// ── Cosmos DB (serverless, SQL API) ─────────────────────────
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: 'pm-${environmentName}-cosmos'
  location: location
  kind: 'GlobalDocumentDB'
  tags: tags
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    capabilities: [
      {
        name: 'EnableServerless'
      }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    disableLocalAuth: true
  }
}

resource cosmosDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmosAccount
  name: 'portfolio-manager'
  properties: {
    resource: {
      id: 'portfolio-manager'
    }
  }
}

// Conversations container – stores agent chat history
resource containerConversations 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDatabase
  name: 'conversations'
  properties: {
    resource: {
      id: 'conversations'
      partitionKey: {
        paths: ['/conversationId']
        kind: 'Hash'
      }
      indexingPolicy: {
        automatic: true
        indexingMode: 'consistent'
      }
    }
  }
}

// Memory container – PM preferences, convictions, past outcomes
resource containerMemory 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDatabase
  name: 'memory'
  properties: {
    resource: {
      id: 'memory'
      partitionKey: {
        paths: ['/userId']
        kind: 'Hash'
      }
      indexingPolicy: {
        automatic: true
        indexingMode: 'consistent'
      }
    }
  }
}

// Reasoning traces container – LLM chain-of-thought logs
resource containerReasoningTraces 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDatabase
  name: 'reasoning-traces'
  properties: {
    resource: {
      id: 'reasoning-traces'
      partitionKey: {
        paths: ['/traceId']
        kind: 'Hash'
      }
      indexingPolicy: {
        automatic: true
        indexingMode: 'consistent'
      }
    }
  }
}

// ── Redis Cache (Basic C0) ──────────────────────────────────
resource redis 'Microsoft.Cache/redis@2024-03-01' = {
  name: 'pm-${environmentName}-redis'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'Basic'
      family: 'C'
      capacity: 0
    }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
}

// ── Service Bus Namespace (Standard) ────────────────────────
resource serviceBus 'Microsoft.ServiceBus/namespaces@2022-10-01-preview' = {
  name: 'pm-${environmentName}-sb'
  location: location
  tags: tags
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
}

// PM-specific topics for inter-worker messaging
var topics = [
  'pm-signals'
  'pm-trades'
  'pm-compliance'
  'pm-notifications'
]

resource serviceBusTopics 'Microsoft.ServiceBus/namespaces/topics@2022-10-01-preview' = [
  for topic in topics: {
    parent: serviceBus
    name: topic
    properties: {
      maxSizeInMegabytes: 1024
      defaultMessageTimeToLive: 'P14D'
    }
  }
]

resource serviceBusSubscriptions 'Microsoft.ServiceBus/namespaces/topics/subscriptions@2022-10-01-preview' = [
  for (topic, i) in topics: {
    parent: serviceBusTopics[i]
    name: '${topic}-sub'
    properties: {
      maxDeliveryCount: 10
      lockDuration: 'PT1M'
      defaultMessageTimeToLive: 'P14D'
    }
  }
]

// ── Azure AI Search (free tier, for research retrieval) ──────
resource aiSearch 'Microsoft.Search/searchServices@2024-03-01-preview' = {
  name: 'pm-${environmentName}-search'
  location: location
  tags: tags
  sku: {
    name: 'free'
  }
  properties: {
    replicaCount: 1
    partitionCount: 1
    hostingMode: 'default'
    publicNetworkAccess: 'enabled'
  }
}

// ── Storage Account (for AI Foundry) ────────────────────────
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'pm${environmentName}st'
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    defaultToOAuthAuthentication: true
  }
}

// ── Outputs ─────────────────────────────────────────────────
output cosmosAccountId string = cosmosAccount.id
output cosmosAccountName string = cosmosAccount.name
output cosmosEndpoint string = cosmosAccount.properties.documentEndpoint
output redisId string = redis.id
output redisName string = redis.name
output redisHostName string = redis.properties.hostName
output serviceBusId string = serviceBus.id
output serviceBusName string = serviceBus.name
output serviceBusEndpoint string = serviceBus.properties.serviceBusEndpoint
output aiSearchId string = aiSearch.id
output aiSearchName string = aiSearch.name
output aiSearchEndpoint string = 'https://${aiSearch.name}.search.windows.net'
output storageAccountId string = storageAccount.id
output storageAccountName string = storageAccount.name
