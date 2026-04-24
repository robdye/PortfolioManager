# Portfolio Manager — Development Agent

You are a development assistant for the **Portfolio Manager Agent** project — a financial portfolio management system built as a Microsoft 365 Copilot declarative agent with an autonomous digital worker backend.

## Architecture Overview

This project has three main components:

### 1. Declarative Agent (`appPackage/`)
- M365 Copilot declarative agent (JSON config, no code)
- Uses OpenAI Actions with Remote MCP Server runtime
- Renders interactive widgets via `outputTemplate` with HTML5/CSS/JS
- Teams App Manifest v1.24

### 2. MCP Server (`mcp-server/`)
- **TypeScript / Node.js 20 / Express 5**
- Protocol: MCP over Streamable HTTP
- 26 Finnhub financial data tools + 15 interactive widgets
- CRM tools backed by Microsoft Dataverse (Dynamics 365)
- Auth: OAuth2 client credentials (`@azure/identity`) for Dataverse, API key for Finnhub
- Deployed as Azure Container App: `portfolio-agent-mcp` (image: `portfolio-agent-mcp:v13`)
- URL: `https://<YOUR_MCP_APP>.azurecontainerapps.io`

### 3. Digital Worker (`digital-worker/`)
- **TypeScript / Node.js 20 / Express 5**
- Agent framework: `@microsoft/agents-hosting` v1.2.2 + `@openai/agents` v0.7
- LLM: Azure OpenAI GPT-4o
- Autonomous capabilities: morning briefings, portfolio monitoring, earnings tracking, FX monitoring, compliance digests, client engagement scheduling, trade simulation
- MCP Client: connects to the MCP server for financial data
- Graph API: calendar events, email, Teams chat
- Auth: OBO flow (interactive) + client credentials (scheduled tasks)
- Deployed as Azure Container App: `portfolio-manager-worker`
- URL: `https://<YOUR_WORKER_APP>.azurecontainerapps.io`

## Key Environment

| Key | Value |
|-----|-------|
| ACR | `<YOUR_ACR_NAME>.azurecr.io` |
| Resource Group | `<YOUR_RESOURCE_GROUP>` |
| Tenant | `<YOUR_TENANT_ID>` |
| CRM URL | `<YOUR_CRM_URL>` |
| Manager | `<YOUR_MANAGER_EMAIL>` |

## Build & Deploy

```bash
# Build worker (increment version each time)
az acr build --registry <YOUR_ACR_NAME> --image portfolio-manager-worker:vXX \
  --file digital-worker/Dockerfile digital-worker/

# Deploy worker
az containerapp update --name portfolio-manager-worker \
  --resource-group <YOUR_RESOURCE_GROUP> \
  --image <YOUR_ACR_NAME>.azurecr.io/portfolio-manager-worker:vXX

# Build MCP server
az acr build --registry <YOUR_ACR_NAME> --image portfolio-agent-mcp:vXX \
  --file mcp-server/Dockerfile mcp-server/

# Trigger workday init
curl -X POST -H "x-scheduled-secret: <YOUR_SCHEDULED_SECRET>" \
  -H "Content-Type: application/json" \
  https://<YOUR_WORKER_APP>.azurecontainerapps.io/api/scheduled/workday/init
```

## MCP Server Tools (available via `portfolio` MCP)

The portfolio MCP server exposes tools for:
- **Stock data**: quotes, company profiles, financials, peers, recommendations, earnings, price targets
- **Portfolio**: dashboard, holdings, concentration risk, stress tests, relative value analysis
- **CRM**: account lookup, contact management, pipeline, client 360 view
- **News**: company news, market news feed
- **Analyst**: consensus estimates, rating trends

## Coding Conventions
- TypeScript with ES modules (`"type": "module"` in package.json)
- Zod v4 for runtime parameter validation on function tools
- Express 5 with `express.json()` middleware
- Docker images based on `node:20-slim`
- Scheduled endpoints protected by `x-scheduled-secret` header
