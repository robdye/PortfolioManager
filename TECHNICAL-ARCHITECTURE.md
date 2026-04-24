# Portfolio Manager Agent — Technical Architecture Reference

---

## Technology Stack by Component

### 1. Declarative Agent (M365 Copilot)
| | |
|---|---|
| **Runtime** | M365 Copilot platform (hosted by Microsoft) |
| **Language** | JSON configuration (no code — declarative) |
| **Schema** | Declarative Agent v1.6 (`declarativeAgent.json`) |
| **Plugin Protocol** | OpenAI Actions with Remote MCP Server runtime |
| **Widget Rendering** | OpenAI Apps SDK `outputTemplate` with inline HTML5/CSS/JS |
| **Capabilities API** | M365 Graph Connectors: CodeInterpreter, People, Email, TeamsMessages, OneDriveAndSharePoint |
| **Manifest** | Teams App Manifest v1.24 |

### 2. MCP Server (Backend for Declarative Agent)
| | |
|---|---|
| **Language** | TypeScript |
| **Runtime** | Node.js 20 |
| **Framework** | Express.js 5 + `@modelcontextprotocol/sdk` v1.12 |
| **Protocol** | Model Context Protocol (MCP) over Streamable HTTP |
| **Hosting** | Azure Container Apps (containerised) |
| **Container** | Docker (node:20-slim base) |
| **Registry** | Azure Container Registry (`portfolioagentacr.azurecr.io`) |
| **Data Sources** | Finnhub REST API, Microsoft Dataverse Web API, Dynamics 365 CRM OData |
| **Auth to Dataverse** | OAuth2 client credentials via `@azure/identity` |
| **Auth to Finnhub** | API key |
| **Infrastructure-as-Code** | Bicep (`containerapp.bicep`) |

### 3. Digital Worker (Autonomous A365 Agent)
| | |
|---|---|
| **Language** | TypeScript |
| **Runtime** | Node.js 20 |
| **Agent Framework** | `@microsoft/agents-hosting` v1.2.2 (Microsoft Agents SDK) |
| **LLM Orchestration** | `@openai/agents` v0.7 (OpenAI Agents SDK with function tool calling) |
| **LLM** | Azure OpenAI Service — GPT-4o |
| **HTTP Server** | Express.js 5 |
| **MCP Client** | `@modelcontextprotocol/sdk` (StreamableHTTP transport for calling own MCP servers) |
| **A365 Tooling** | `@microsoft/agents-a365-tooling` + `@microsoft/agents-a365-tooling-extensions-openai` |
| **A365 Notifications** | `@microsoft/agents-a365-notifications` (email, Word comment triggers) |
| **Observability** | `@microsoft/agents-a365-observability` + `@microsoft/agents-a365-observability-extensions-openai` |
| **Auth** | Agentic OAuth2 (OBO flow for interactive), Client credentials (Graph API for scheduled) |
| **Identity** | Microsoft Entra ID — own app registration, own user mailbox, own Teams presence |
| **Graph API** | Email (`Mail.Send`), Users (`User.Read.All`), Chat (`Chat.ReadWrite`) |
| **Hosting** | Azure Container Apps |
| **Scheduling** | Azure Container App Jobs (cron-triggered HTTP calls) |
| **Teams Channel** | Power Automate Workflows webhook (Adaptive Cards) |
| **Parameter Validation** | Zod v4 (runtime schema validation for function tools) |
| **Container** | Docker (node:20-slim) |
| **Infrastructure** | ARM templates (`containerapp.json`, `scheduler-jobs.json`) |

### 4. Voice Interface
| | |
|---|---|
| **API** | Azure Voice Live (Azure AI Services) |
| **Protocol** | WebSocket (browser ↔ server ↔ Azure Voice Live) |
| **Server-side** | Node.js WebSocket proxy (`ws` library) |
| **Client-side** | HTML5 + vanilla JavaScript (AudioWorklet for mic capture) |
| **Voice Model** | GPT-4o via Voice Live |
| **Speech Output** | HD Neural Voice |
| **Auth** | `DefaultAzureCredential` → `https://cognitiveservices.azure.com/.default` |
| **Tool Calling** | Same function tools as Digital Worker, executed server-side |

---

## Dependencies (package.json)

```
@microsoft/agents-hosting          1.2.2    — Agent runtime (activity handling, auth)
@microsoft/agents-activity         1.2.2    — Activity types
@microsoft/agents-a365-tooling     0.1.0    — MCP tool server discovery
@microsoft/agents-a365-tooling-extensions-openai  0.1.0  — OpenAI agent integration
@microsoft/agents-a365-notifications  0.1.0  — Email/notification handling
@microsoft/agents-a365-observability   0.1.0  — Telemetry & tracing
@microsoft/agents-a365-runtime    0.1.0    — A365 runtime utilities
@openai/agents                     0.7.2    — LLM agent orchestration & function tools
@modelcontextprotocol/sdk          1.12.1   — MCP client (StreamableHTTP)
@azure/identity                    4.13.1   — Azure auth (managed identity, client creds)
openai                             4.77.0   — OpenAI API client
express                            5.1.0    — HTTP server
ws                                 8.18.1   — WebSocket (voice proxy)
dotenv                             17.2.2   — Environment config
zod                                4.3.6    — Schema validation (transitive from @openai/agents)
```

---

## Languages Breakdown

| Language | Usage | % of Codebase |
|---|---|---|
| **TypeScript** | All backend logic (MCP server, Digital Worker, voice proxy) | ~81% |
| **HTML/CSS/JS** | 12 interactive widgets + voice UI page | ~16% |
| **JSON** | Manifests, configs, ARM templates, Bicep | ~3% |

---

## Platform & Runtime Layer

| Component | Microsoft Service | SKU/Tier | Region | Resource Name | URL/Endpoint |
|---|---|---|---|---|---|
| MCP Server Container | Azure Container Apps | 0.5 CPU / 1Gi | East US | `portfolio-agent-app` | `portfolio-agent-app.jollysand-88b78b02.eastus.azurecontainerapps.io` |
| Digital Worker Container | Azure Container Apps | 0.5 CPU / 1Gi | East US | `portfolio-manager-worker` | `portfolio-manager-worker.jollysand-88b78b02.eastus.azurecontainerapps.io` |
| Container Environment | Azure Container Apps Environment | — | East US | `portfolio-agent-mcp-cae` | — |
| Docker Images | Azure Container Registry | Standard | East US | `portfolioagentacr` | `portfolioagentacr.azurecr.io` |
| Scheduled Jobs (×5) | Azure Container App Jobs | Cron trigger | East US | `pm-job-briefing`, `pm-job-monitor`, `pm-job-fx`, `pm-job-compliance`, `pm-job-earnings` | — |

---

## AI & Intelligence Layer

| Component | Microsoft Service | Model/Version | Purpose |
|---|---|---|---|
| LLM Inference (all agents) | Azure OpenAI Service | GPT-4o | Text generation, tool calling, briefing generation |
| Voice Speech-to-Speech | Azure AI Services (Voice Live) | GPT-4o + HD Neural Voice | Real-time voice interface |
| Declarative Agent | M365 Copilot Platform | Declarative Agent v1.6 | Interactive UI in M365 Copilot chat |

---

## Identity & Auth Layer

| Component | Microsoft Service | App/Object ID | Purpose |
|---|---|---|---|
| Agent Blueprint (Digital Worker) | Microsoft Entra ID — App Registration | `f474b197-7795-4c14-a01f-4ac8517145eb` | Agentic identity, Teams presence, messaging |
| Graph API App (Email/Users) | Microsoft Entra ID — App Registration | `29ca5af0-0a0b-4a00-8025-e7ad0bfd67d8` | Mail.Send, User.Read.All, Chat.ReadWrite.All |
| Agent User (Mailbox) | Microsoft Entra ID — User | `PortfolioManagerAgent05ad11@ABSx68251802.onmicrosoft.com` | Sender email identity |
| Teams App | Teams App Registration | `$TEAMS_APP_ID` | Declarative Agent in M365 Copilot |
| Service Connection | A365 Agentic Auth | Client credentials + OBO flow | M365 MCP tools access |

---

## Data Layer

| Component | Microsoft Service | Table/Entity | Purpose |
|---|---|---|---|
| Portfolio Holdings | Microsoft Dataverse | `pm_portfolioholdings` (23 rows) | Company, Ticker, Shares, Cost, Sector, Type, FX, Compliance |
| Deal Tracker | Microsoft Dataverse | `pm_dealtracker` | M&A, Capital Raise, FX Hedging, Follow-on, Exit deals |
| CRM Accounts | Dynamics 365 CRM | `account` | Company profiles — industry, revenue, relationship status |
| CRM Contacts | Dynamics 365 CRM | `contact` | Key contacts — IR directors, CFOs, VP IR |
| CRM Opportunities | Dynamics 365 CRM | `opportunity` | Deal pipeline — stage, value, close date, win probability |
| CRM Activities | Dynamics 365 CRM | `activitypointer` | Calls, meetings, emails — touchpoint history |
| Documents | SharePoint | Shared Documents library | Excel migration source, document storage |

---

## Communication Layer

| Component | Microsoft Service | Mechanism | Target |
|---|---|---|---|
| Email (scheduled tasks) | Microsoft Graph — Mail API | `POST /users/{id}/sendMail` (client credentials) | Manager inbox |
| Email (interactive) | Microsoft Graph — Mail API | Same via `send_email` tool | Any user (resolved via `lookup_person`) |
| Teams Channel Alerts | Power Automate — Workflows | Webhook POST → Adaptive Card | Finance > Portfolio Alerts channel |
| Teams Chat (interactive) | Microsoft Teams — A365 Messaging | `POST /api/messages` (agentic auth) | Direct DM with Digital Worker |
| Voice | Azure AI Services — Voice Live | WebSocket: browser → server → Voice Live | Browser voice page |

---

## MCP Protocol Layer

| MCP Server | Hosting | Endpoint Path | Tool Count | Data Source |
|---|---|---|---|---|
| Finnhub MCP | Azure Container Apps | `/finnhub/mcp` | 23 | Finnhub REST API |
| Portfolio MCP | Azure Container Apps | `/portfolio/mcp` | 6 | Microsoft Dataverse |
| CRM MCP | Azure Container Apps | `/crm/mcp` | 11 | Dynamics 365 CRM |

---

## M365 Platform MCP Servers (Declared in ToolingManifest.json)

| Server Name | Scope | Purpose | Status |
|---|---|---|---|
| `mcp_MailTools` | `McpServers.Mail.All` | Send/read email | Declared (not active — Invalid URL bug) |
| `mcp_TeamsServer` | `McpServers.Teams.All` | Teams messaging | Declared (not active) |
| `mcp_CalendarTools` | `McpServers.Calendar.All` | Calendar access | Declared (not active) |
| `mcp_SharePointRemoteServer` | `McpServers.SharePoint.All` | SharePoint files | Declared (not active) |
| `mcp_SharePointListsTools` | `McpServers.SharepointLists.All` | SharePoint lists | Declared |
| `mcp_ODSPRemoteServer` | `McpServers.OneDriveSharepoint.All` | OneDrive/SP | Declared |
| `mcp_OneDriveRemoteServer` | `McpServers.OneDrive.All` | OneDrive files | Declared |
| `mcp_WordServer` | `McpServers.Word.All` | Word documents | Declared |
| `mcp_ExcelServer` | `McpServers.Excel.All` | Excel operations | Declared |
| `mcp_PlannerTools` | `McpServers.Planner.All` | Planner/To-Do | Declared |
| `mcp_KnowledgeTools` | `McpServers.Knowledge.All` | Knowledge/Search | Declared |

---

## External APIs

| API | Provider | Auth | Purpose |
|---|---|---|---|
| Finnhub | Finnhub.io | API Key | Real-time quotes, news, analyst consensus, SEC filings, earnings calendar, FX rates, IPOs, insider transactions |

---

## Azure Services Used

| Service | Purpose |
|---|---|
| **Azure OpenAI Service** | GPT-4o inference for all agents |
| **Azure Container Apps** | Hosting MCP server + Digital Worker |
| **Azure Container Registry** | Docker image storage |
| **Azure Container App Jobs** | Cron-triggered scheduled tasks |
| **Azure AI Services** | Voice Live API (speech-to-speech) |
| **Microsoft Entra ID** | App registrations, managed identity, agentic auth |
| **Microsoft Dataverse** | Portfolio holdings data store |
| **Dynamics 365 CRM** | Accounts, Contacts, Opportunities |
| **Microsoft Graph** | Email, Users, Teams Chat |
| **Power Automate** | Workflows webhook for Teams channel posting |

---

## Tenant & Subscription

| | |
|---|---|
| **Tenant** | `ee6a68ea-3123-4f78-b587-822d823c4f56` (ABSx68251802) |
| **Subscription** | `afae635b-b494-4d71-b5b8-91d2d6a61860` |
| **Resource Group (MCP + Worker)** | `rg-portfolio-agent` |
| **Resource Group (A365 setup)** | `rg-portfolio-manager-worker` |
| **Location** | East US |

---

## Architecture Diagram Relationships

```
User → M365 Copilot → Declarative Agent → MCP Servers (Container App #1)
                                              ├── /finnhub/mcp → Finnhub API
                                              ├── /portfolio/mcp → Dataverse
                                              └── /crm/mcp → D365 CRM

User → Teams Chat → Digital Worker (Container App #2) → Azure OpenAI (GPT-4o)
                         ├── @openai/agents (26 function tools)
                         ├── MCP Client → same MCP Servers above
                         ├── Graph API → Email + User Lookup
                         └── Webhook → Teams Channel (Portfolio Alerts)

User → Browser → Voice WebSocket → Digital Worker → Azure Voice Live → GPT-4o
                                        └── Voice Tools → MCP Servers

Container App Jobs (cron) → HTTP POST → Digital Worker /api/scheduled/*
                                            ├── /briefing → MCP + OpenAI → Email + Teams
                                            ├── /monitor → MCP → Teams Channel
                                            ├── /fx → MCP → Teams + Email
                                            ├── /compliance → MCP + OpenAI → Email + Teams
                                            └── /earnings → MCP → Teams + Email
```
