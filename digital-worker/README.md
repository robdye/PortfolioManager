# Portfolio Manager Digital Worker

An **Agent 365 Digital Worker** that operates as an autonomous Portfolio Manager within your Microsoft 365 organization. Built on the Microsoft Agent 365 SDK with OpenAI Agents, it connects to your existing Finnhub, CRM, and Portfolio MCP servers.

## What It Does

| Capability | Description |
|---|---|
| **Morning Briefing** | Every weekday at 09:00, emails a comprehensive portfolio briefing with market overview, P&L, top movers, risk alerts, and CRM pipeline |
| **Live Monitoring** | Polls portfolio holdings and alerts you on significant price movements (configurable threshold) |
| **Email Handling** | Receives and responds to emails using its own mailbox via agentic identity |
| **Meeting Summaries** | When included in meetings, sends structured post-meeting summaries with action items |
| **On-demand Analysis** | Responds to direct messages in Teams with portfolio data and analysis |

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                Portfolio Manager Digital Worker                 │
│                   (Agent 365 + OpenAI Agents)                  │
├────────────────────────────────────────────────────────────────┤
│  agent.ts          │ Core agent — notifications, messages      │
│  morning-briefing  │ Cron scheduler → gather data → email      │
│  portfolio-monitor │ Price polling → threshold alerts           │
│  mcp-client        │ Direct HTTP to your existing MCPs          │
│  client.ts         │ OpenAI Agent + A365 observability          │
├────────────────────────────────────────────────────────────────┤
│              Agent 365 SDK (Identity, Notifications,           │
│          Observability, Tooling — Mail/Calendar/Teams)          │
├────────────────────────────────────────────────────────────────┤
│  ┌──────────┐    ┌──────────┐    ┌──────────────────┐          │
│  │ Finnhub  │    │   CRM    │    │   Portfolio       │          │
│  │ MCP      │    │   MCP    │    │   MCP             │          │
│  │(market)  │    │ (D365)   │    │  (holdings)       │          │
│  └──────────┘    └──────────┘    └──────────────────┘          │
│   portfolio-agent-app.jollysand-88b78b02.eastus...             │
└────────────────────────────────────────────────────────────────┘
```

## Prerequisites

- Node.js 18.x or higher
- .NET 8.0 SDK (for Agent 365 CLI)
- Azure subscription with contributor access
- **Agent 365 Frontier preview** program access
- Global Administrator or Agent ID Administrator role in your tenant
- Your existing Portfolio Agent MCP servers running

## Quick Start

### 1. Install Dependencies

```bash
cd digital-worker
npm install
```

### 2. Configure Environment

```bash
cp .env.template .env
# Edit .env with your OpenAI keys and MCP endpoints
```

### 3. Local Development

```bash
# Start in development mode (auth disabled)
npm run dev

# Open Agents Playground for testing
npm run test-tool
```

### 4. Deploy with Agent 365 CLI

```powershell
# Install Agent 365 CLI
dotnet tool install --global Microsoft.Agents.A365.DevTools.Cli --prerelease

# Authenticate
az login

# Initialize configuration (interactive wizard)
a365 config init

# Add MCP server permissions (Mail, Calendar, Teams)
a365 develop add-mcp-servers mcp_MailTools
a365 develop add-mcp-servers mcp_CalendarTools
a365 develop add-mcp-servers mcp_TeamsTools

# Add custom Graph permissions for autonomous operation
a365 config permissions `
  --resource-app-id 00000003-0000-0000-c000-000000000000 `
  --scopes Mail.Read,Mail.Send,Calendars.Read,Calendars.ReadWrite,Chat.Create,Chat.ReadWrite,User.Read

# Setup agent blueprint (creates Azure resources + agent identity)
a365 setup all

# Build and deploy
npm run build
a365 deploy

# Publish to Microsoft 365 admin center
a365 publish
```

### 5. Create Agent Instance

1. Open **Microsoft Teams**
2. Go to **Apps**
3. Search for **Portfolio Manager**
4. Select **Add** to hire the digital worker

The agent will appear in your org chart reporting to you. It gets its own mailbox, OneDrive, and is @mentionable across M365.

## Configuration

| Variable | Description | Default |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI API key | - |
| `MCP_FINNHUB_ENDPOINT` | Finnhub MCP server URL | Container App URL |
| `MCP_CRM_ENDPOINT` | CRM MCP server URL | Container App URL |
| `MCP_PORTFOLIO_ENDPOINT` | Portfolio MCP server URL | Container App URL |
| `MANAGER_EMAIL` | Your email for briefings/alerts | - |
| `MANAGER_NAME` | Your display name | - |
| `PRICE_CHANGE_THRESHOLD` | Alert threshold (%) | `2.0` |
| `FX_CHANGE_THRESHOLD` | FX rate alert threshold (%) | `1.0` |
| `SCHEDULED_SECRET` | Secret for scheduler API endpoints | - |
| `USE_AGENTIC_AUTH` | Enable agentic identity | `false` |

## Agent 365 Features Used

- **Agent Identity** — Entra-backed agentic user with own mailbox and Teams presence
- **Notifications** — Email notification handler for incoming messages
- **Tooling** — Mail, Calendar, and Teams MCP servers for M365 actions
- **Observability** — OpenTelemetry tracing for all agent operations

## Project Structure

```
digital-worker/
├── src/
│   ├── index.ts              # Express server with API scheduler endpoints
│   ├── agent.ts              # PortfolioManagerAgent (A365 AgentApplication)
│   ├── client.ts             # OpenAI Agent wrapper with A365 observability
│   ├── mcp-client.ts         # Direct HTTP client for MCP servers (Finnhub, CRM, Portfolio)
│   ├── morning-briefing.ts   # Morning briefing generator (API-triggered)
│   ├── portfolio-monitor.ts  # Price monitoring with alerts (API-triggered)
│   ├── fx-monitor.ts         # FX rate monitoring with alerts (API-triggered)
│   ├── compliance-digest.ts  # Weekly compliance digest (API-triggered)
│   ├── earnings-tracker.ts   # Earnings calendar + IPO tracker (API-triggered)
│   ├── openai-config.ts      # OpenAI/Azure OpenAI configuration
│   └── token-cache.ts        # Observability token cache
├── a365.config.json           # Agent 365 CLI configuration
├── ToolingManifest.json       # A365 MCP server manifest
├── .env.template              # Environment variable template
├── scripts/
│   └── setup-deploy.ps1       # Setup and deployment script
├── package.json
└── tsconfig.json
```

## License

MIT
