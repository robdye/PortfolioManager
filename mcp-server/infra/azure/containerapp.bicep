@description('Azure region.')
param location string
@description('Environment base name.')
param environmentName string
@description('Container App name.')
param containerAppName string
@description('Container image reference.')
param containerImage string
@description('Container registry server.')
param containerRegistryServer string

@minValue(0)
param minReplicas int = 1

@minValue(1)
param maxReplicas int = 2

param envVars array = []

var logAnalyticsName = '${environmentName}-law'
var containerEnvName = '${environmentName}-cae'
var publicEnvVars = [for item in envVars: { name: item.name, value: item.value }]

resource logWorkspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: logAnalyticsName
  location: location
  properties: { retentionInDays: 30, sku: { name: 'PerGB2018' } }
}

resource managedEnv 'Microsoft.App/managedEnvironments@2024-02-02-preview' = {
  name: containerEnvName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: { customerId: logWorkspace.properties.customerId, sharedKey: logWorkspace.listKeys().primarySharedKey }
    }
  }
}

resource userIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${containerAppName}-id'
  location: location
}

resource containerApp 'Microsoft.App/containerApps@2024-02-02-preview' = {
  name: containerAppName
  location: location
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${userIdentity.id}': {} } }
  properties: {
    managedEnvironmentId: managedEnv.id
    configuration: {
      ingress: { external: true, targetPort: 3001, transport: 'auto', traffic: [{ weight: 100, latestRevision: true }] }
      registries: [{ server: containerRegistryServer, identity: userIdentity.id }]
    }
    template: {
      containers: [{ image: containerImage, name: 'portfolio-agent', resources: { cpu: 1, memory: '2Gi' }, env: publicEnvVars }]
      scale: { minReplicas: minReplicas, maxReplicas: maxReplicas, rules: [{ name: 'http', custom: { type: 'http', metadata: { concurrentRequests: '100' } } }] }
    }
  }
}

output containerAppUri string = containerApp.properties.configuration.ingress.fqdn
output managedIdentityClientId string = userIdentity.properties.clientId
