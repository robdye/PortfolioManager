// ──────────────────────────────────────────────────────────────
// Cognitive Services Module – Azure OpenAI, Content Safety, Speech
// Portfolio Manager domain adaptation
// ──────────────────────────────────────────────────────────────

@description('Environment name used in resource naming')
param environmentName string

@description('Azure region for OpenAI and Content Safety')
param location string

@description('Tags applied to every resource')
param tags object

// ── Azure OpenAI Service ────────────────────────────────────
resource openai 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: 'pm-${environmentName}-openai'
  location: location
  kind: 'OpenAI'
  tags: tags
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: 'pm-${environmentName}-openai'
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: true
  }
}

// GPT-4o deployment for primary agent reasoning
resource gpt4oDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: openai
  name: 'gpt-4o'
  sku: {
    name: 'Standard'
    capacity: 30
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-4o'
      version: '2024-11-20'
    }
    raiPolicyName: 'Microsoft.DefaultV2'
  }
}

// o4-mini deployment for reasoning-heavy tasks (stress tests, scenario analysis)
resource o4MiniDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: openai
  name: 'o4-mini'
  sku: {
    name: 'Standard'
    capacity: 30
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'o4-mini'
      version: '2025-04-16'
    }
    raiPolicyName: 'Microsoft.DefaultV2'
  }
  dependsOn: [
    gpt4oDeployment
  ]
}

// ── Content Safety ──────────────────────────────────────────
resource contentSafety 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: 'pm-${environmentName}-safety'
  location: location
  kind: 'ContentSafety'
  tags: tags
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: 'pm-${environmentName}-safety'
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: true
  }
}

// ── Speech Services (westus2 for avatar support) ────────────
resource speech 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: 'pm-${environmentName}-speech'
  location: 'westus2'
  kind: 'SpeechServices'
  tags: tags
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: 'pm-${environmentName}-speech'
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: true
  }
}

// ── Outputs ─────────────────────────────────────────────────
output openaiId string = openai.id
output openaiName string = openai.name
output openaiEndpoint string = openai.properties.endpoint
output contentSafetyId string = contentSafety.id
output contentSafetyName string = contentSafety.name
output contentSafetyEndpoint string = contentSafety.properties.endpoint
output speechId string = speech.id
output speechName string = speech.name
output speechEndpoint string = speech.properties.endpoint
output speechRegion string = speech.location
