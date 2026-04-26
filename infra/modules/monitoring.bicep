// ──────────────────────────────────────────────────────────────
// Monitoring Module – Log Analytics, Application Insights, KQL Alert Rules
// Portfolio Manager domain adaptation
// ──────────────────────────────────────────────────────────────

@description('Environment name used in resource naming')
param environmentName string

@description('Azure region for all resources')
param location string

@description('Tags applied to every resource')
param tags object

// ── Log Analytics Workspace ─────────────────────────────────
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'pm-${environmentName}-law'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 90
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

// ── Application Insights ────────────────────────────────────
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'pm-${environmentName}-ai'
  location: location
  kind: 'web'
  tags: tags
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    IngestionMode: 'LogAnalytics'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

// ── Action Group ────────────────────────────────────────────
resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'pm-${environmentName}-ag'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: 'PMAlerts'
    enabled: true
    emailReceivers: []
  }
}

// ── KQL Alert Rules ─────────────────────────────────────────

// Alert 1: Agent Error Rate > 5% (Critical)
resource alertAgentErrorRate 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'PM-DigitalWorker-AgentErrorRate-Critical'
  location: location
  tags: tags
  properties: {
    displayName: 'PM Agent Error Rate > 5% (Critical)'
    description: 'Fires when the Portfolio Manager digital worker error rate exceeds 5% over the last hour.'
    severity: 0
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT1H'
    scopes: [logAnalytics.id]
    criteria: {
      allOf: [
        {
          query: 'let total = toscalar(customEvents | where timestamp > ago(1h) and name startswith \'pm.\' | count); exceptions | where timestamp > ago(1h) | where customDimensions has \'pm\' | summarize errorCount = count() | extend errorRate = round(todouble(errorCount) / todouble(total) * 100, 2) | where errorRate > 5'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 }
        }
      ]
    }
    actions: { actionGroups: [actionGroup.id] }
  }
}

// Alert 2: Tool Call P95 Latency > 10s (Warning)
resource alertToolLatency 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'PM-DigitalWorker-ToolLatencyP95-Warning'
  location: location
  tags: tags
  properties: {
    displayName: 'PM Tool Call P95 Latency > 10s (Warning)'
    description: 'Fires when the P95 tool call latency exceeds 10 seconds.'
    severity: 2
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    scopes: [logAnalytics.id]
    criteria: {
      allOf: [
        {
          query: 'customEvents | where name == \'pm.tool.call.completed\' | where timestamp > ago(15m) | extend durationMs = todouble(customDimensions.durationMs) | summarize p95 = percentile(durationMs, 95) by bin(timestamp, 5m) | where p95 > 10000'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 }
        }
      ]
    }
    actions: { actionGroups: [actionGroup.id] }
  }
}

// Alert 3: Finnhub API Failures > 10 in 5 min (Critical)
resource alertFinnhubFailures 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'PM-DigitalWorker-FinnhubFailures-Critical'
  location: location
  tags: tags
  properties: {
    displayName: 'Finnhub API Failures > 10 in 5 min (Critical)'
    description: 'Fires when Finnhub API failures exceed 10 within a 5-minute window.'
    severity: 0
    enabled: true
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    scopes: [logAnalytics.id]
    criteria: {
      allOf: [
        {
          query: 'dependencies | where type == \'HTTP\' and target contains \'finnhub.io\' | where timestamp > ago(5m) | where success == false | summarize failureCount = count() | where failureCount > 10'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 }
        }
      ]
    }
    actions: { actionGroups: [actionGroup.id] }
  }
}

// Alert 4: Token Usage Spike > 3x Baseline (Warning)
resource alertTokenSpike 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'PM-DigitalWorker-TokenUsageSpike-Warning'
  location: location
  tags: tags
  properties: {
    displayName: 'Token Usage Spike > 3x Baseline (Warning)'
    description: 'Fires when current token usage exceeds 3x the 7-day rolling baseline average.'
    severity: 2
    enabled: true
    evaluationFrequency: 'PT15M'
    windowSize: 'PT1H'
    scopes: [logAnalytics.id]
    criteria: {
      allOf: [
        {
          query: 'let baseline = toscalar(customMetrics | where name == \'gen_ai.client.token.usage\' | where timestamp between (ago(7d) .. ago(1d)) | summarize avg(value)); customMetrics | where name == \'gen_ai.client.token.usage\' | where timestamp > ago(1h) | summarize currentAvg = avg(value) | where currentAvg > baseline * 3'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 }
        }
      ]
    }
    actions: { actionGroups: [actionGroup.id] }
  }
}

// Alert 5: HITL Approvals Pending > 30 min (Info)
resource alertHitlPending 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'PM-DigitalWorker-HitlPendingApprovals-Info'
  location: location
  tags: tags
  properties: {
    displayName: 'HITL Approvals Pending > 30 min (Info)'
    description: 'Fires when human-in-the-loop approvals have been pending for more than 30 minutes.'
    severity: 3
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT1H'
    scopes: [logAnalytics.id]
    criteria: {
      allOf: [
        {
          query: 'customEvents | where name == \'pm.hitl.requested\' | where timestamp > ago(24h) | extend approvalId = tostring(customDimensions.approvalId) | join kind=leftanti (customEvents | where name == \'pm.hitl.completed\' | where timestamp > ago(24h) | extend approvalId = tostring(customDimensions.approvalId)) on approvalId | where timestamp < ago(30m) | summarize pendingCount = count() | where pendingCount > 0'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 }
        }
      ]
    }
    actions: { actionGroups: [actionGroup.id] }
  }
}

// ── Outputs ─────────────────────────────────────────────────
output logAnalyticsWorkspaceId string = logAnalytics.id
output logAnalyticsWorkspaceName string = logAnalytics.name
output logAnalyticsCustomerId string = logAnalytics.properties.customerId
output appInsightsId string = appInsights.id
output appInsightsName string = appInsights.name
output appInsightsConnectionString string = appInsights.properties.ConnectionString
output appInsightsInstrumentationKey string = appInsights.properties.InstrumentationKey
