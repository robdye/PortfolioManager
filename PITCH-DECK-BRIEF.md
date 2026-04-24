# Portfolio Manager Agent — Architecture & Pitch Deck Brief
## Input for Microsoft Coworker / Copilot Presentation Generation

---

## EXECUTIVE SUMMARY

**Product Name:** Portfolio Manager — Alpha Intelligence Platform  
**Tagline:** "The AI-native investment banking platform — built entirely on Microsoft's AI stack"  
**Built By:** Microsoft AI ISV Engineering (ABSx68251802 tenant)  
**Demo Duration:** 10 minutes  
**Target Audience:** Investment Banking Portfolio Managers, CIOs, CTOs, Microsoft Partners, Financial Services ISVs

### The One-Liner
A fully autonomous AI Portfolio Manager that reads live market data, manages CRM relationships, monitors risk in real-time, and takes action — all from natural language, inside Microsoft 365 Copilot, with a Digital Worker that operates 24/7 and a hands-free Voice interface.

### Key Metrics
- **40+ MCP tools** across 3 custom servers + 11 M365 platform MCP servers
- **12 interactive UI widgets** rendered inside M365 Copilot via OpenAI Apps SDK
- **6 autonomous scheduled tasks** running 24/7 on Azure Container Apps
- **21+ portfolio holdings** tracked in Dataverse with full CRUD
- **Real-time market data** from Finnhub (quotes, news, analyst consensus, SEC filings)
- **Dynamics 365 CRM** integration (accounts, contacts, opportunities, deal pipeline)
- **HD Voice interface** with real-time tool calling via Azure Voice Live

---

## THE THREE PILLARS (Architecture Overview)

### Pillar 1: Declarative Agent (M365 Copilot Frontend)
- **Runtime:** M365 Copilot chat interface
- **Framework:** Declarative Agent v1.6 with OpenAI Apps SDK widget protocol
- **Capabilities:** CodeInterpreter, People, Email, TeamsMessages, OneDriveAndSharePoint
- **Plugins:** 3 MCP action plugins (Finnhub, Portfolio, CRM)
- **Total Tools:** 40 (23 Finnhub + 6 Portfolio CRUD + 11 CRM)
- **Interactive Widgets:** 12 HTML5 dashboards rendered in-chat
- **Persona:** "Alpha" — elite investment banking analyst

### Pillar 2: Digital Worker (Autonomous A365 Agent)
- **Runtime:** Azure Container Apps (Express.js on Node.js 20)
- **Framework:** Microsoft Agents SDK (@microsoft/agents-hosting) + @openai/agents
- **Identity:** Own Entra ID, own mailbox (portfoliomanager@tenant), own Teams presence
- **M365 MCP Integration:** 11 platform MCP servers (Mail, Teams, Calendar, SharePoint, OneDrive, Word, Excel, Planner, Knowledge)
- **Custom Tools:** 24 function tools registered on the OpenAI Agent
- **Scheduled Tasks:** 6 API-driven endpoints triggered by Azure Logic Apps
- **Communication:** Webhook to Teams channel + Graph API email for scheduled tasks; M365 MCP for interactive
- **Observability:** A365 Observability SDK with telemetry export

### Pillar 3: Voice Interface (Azure Voice Live)
- **Runtime:** WebSocket proxy on the Digital Worker container
- **Framework:** Azure Voice Live with real-time tool calling
- **Tools:** 18 voice-optimised function tools (same MCP backend)
- **Use Case:** Hands-free portfolio management on the trading floor

---

## ARCHITECTURE DIAGRAM (Mermaid — for rendering in presentations)

```
Use this description to generate a Microsoft-standard architecture diagram:

Top Layer: "User Interfaces"
- M365 Copilot (Declarative Agent + 12 Widgets)
- Microsoft Teams (Digital Worker chat + Channel alerts)
- Voice Interface (Azure Voice Live WebSocket)

Middle Layer: "AI Orchestration"
- OpenAI GPT-4o (Azure OpenAI Service)
- @openai/agents SDK (function tool calling)
- M365 Platform MCP Servers (Mail, Teams, Calendar, SharePoint, OneDrive, Word, Excel, Planner, Knowledge)

Integration Layer: "MCP Servers" (Azure Container Apps)
- Finnhub MCP Server (23 tools — quotes, news, analyst consensus, SEC, earnings, FX, stress test, concentration risk)
- Portfolio MCP Server (6 tools — Dataverse CRUD for holdings)
- CRM MCP Server (11 tools — D365 accounts, contacts, opportunities, deal tracker, compliance, IC calendar)

Data Layer: "Enterprise Data"
- Microsoft Dataverse (pm_portfolioholdings table — 21+ holdings)
- Dynamics 365 CRM (Accounts, Contacts, Opportunities, Activities)
- Finnhub API (Real-time market data, SEC EDGAR, earnings calendar)
- SharePoint (Document storage, Excel migration source)

Infrastructure Layer: "Azure Platform"
- Azure Container Apps (2 containers: MCP server + Digital Worker)
- Azure Container Registry (portfolioagentacr.azurecr.io)
- Microsoft Entra ID (Agent identity + agentic OAuth)
- Azure Logic Apps (Scheduled task triggers)
- Power Automate Workflows (Teams channel webhook)

Security & Auth:
- Agentic OAuth2 (on-behalf-of flow for M365 MCP)
- Client credentials (Graph API for scheduled email)
- Workflows webhook (Teams channel posting — no permissions needed)
- SCHEDULED_SECRET header (API endpoint protection)
```

---

## WIDGET GALLERY (12 Interactive Dashboards)

| # | Widget | Description | Key Features |
|---|--------|-------------|--------------|
| 1 | **Portfolio Command Center** | Full portfolio treemap with live prices | Clients/Prospects tabs, sector allocation, drill-down to fundamentals, compliance badges, FX exposure |
| 2 | **Morning Briefing** | Daily intelligence briefing | Portfolio Pulse (4 KPIs), Market Movers, Client Alerts (risk/earnings tags), Prospect Watch, AI Executive Commentary |
| 3 | **Macro Stress Test** | Scenario analysis dashboard | S&P -20%, Rates +100bps, Oil +50% scenarios, waterfall charts, per-holding beta impact |
| 4 | **Concentration Risk** | HHI index & sector exposure | Sector allocation bars, single-name limits, geographic & supply chain risk, diversification score |
| 5 | **Relative Value** | P/E vs Revenue Growth scatter | Opportunity signals, peer comparison, dividend yield ranking |
| 6 | **Client 360 View** | Unified market + CRM profile | Stock fundamentals + CRM contacts + deal pipeline + recent activities in one view |
| 7 | **CRM Pipeline** | Investment funnel dashboard | Stage funnel (Qualify→Close), deal type badges (M&A/Capital Raise/Exit), weighted revenue KPI |
| 8 | **CRM Account** | Company profile card | Key contacts with mailto links, opportunity cards with D365 deep links, activity timeline |
| 9 | **Stock Quote** | Detailed quote card | Price, change, 52-week range, analyst consensus bars, recent headlines |
| 10 | **Analyst Consensus** | Buy/Hold/Sell breakdown | Recommendation trends over time, target price vs current |
| 11 | **News Feed** | Market intelligence feed | Categorised headlines (risk/earnings/catalyst), source attribution, sentiment indicators |
| 12 | **CRUD Form** | Portfolio management form | Add/update holdings with pre-filled fields, holding type dropdown, currency exposure, submit to Dataverse |

---

## SCHEDULED TASKS (Digital Worker Autonomous Operations)

| Task | Schedule | What It Does | Output |
|------|----------|--------------|--------|
| **Morning Briefing** | Weekdays 09:00 | Reads portfolio → fetches quotes for top 8 holdings → generates AI briefing → emails PM → posts to Teams | HTML email + Teams channel summary |
| **Portfolio Monitor** | Every 5 min (market hours) | Checks all 18 active holdings → alerts on >2% moves | Teams channel price alert table |
| **FX Monitor** | Every 15 min | Monitors 10 currency pairs → alerts on >1% moves → maps to portfolio exposure | Teams alert + email |
| **Compliance Digest** | Monday 08:00 | Queries flagged/pending deals → IC calendar → revenue impact → AI digest | HTML email + Teams post |
| **Earnings Tracker** | Daily 07:00 | Cross-references Finnhub earnings calendar with holdings → 2-day advance alerts | Teams alert + email |
| **Run All** | On-demand | Executes all 5 tasks sequentially | Combined results JSON |

---

## TECHNOLOGY STACK

### Microsoft AI & Platform
- **M365 Copilot** — Declarative Agent v1.6 with OpenAI Apps SDK widget protocol
- **Microsoft Agents SDK** — @microsoft/agents-hosting v1.2.2 for Digital Worker
- **A365 Agent Runtime** — Agentic user identity, observability, MCP tooling
- **Azure OpenAI Service** — GPT-4o for all LLM inference
- **Model Context Protocol (MCP)** — Tool calling standard for all 3 custom servers + 11 M365 servers
- **Microsoft Dataverse** — Enterprise data store for portfolio holdings (pm_portfolioholdings)
- **Dynamics 365 CRM** — Accounts, Contacts, Opportunities, Activities
- **Microsoft Graph** — Email (Mail.Send), Teams (Chat.ReadWrite), Users (User.Read.All)
- **Power Automate Workflows** — Teams channel webhook for alerts
- **Microsoft Entra ID** — Agent identity, agentic OAuth, service connections

### Azure Infrastructure
- **Azure Container Apps** — 2 containers (MCP server + Digital Worker), East US
- **Azure Container Registry** — portfolioagentacr.azurecr.io
- **Azure Logic Apps** — Scheduled task triggers (cron)
- **Azure Voice Live** — HD voice with real-time tool calling

### Open Source & APIs
- **@openai/agents SDK** v0.7 — Function tool calling, agent orchestration
- **Finnhub API** — Real-time quotes, news, analyst consensus, SEC filings, earnings, FX, IPOs
- **Express.js 5** — Digital Worker HTTP server
- **TypeScript** — Entire codebase
- **Zod** — Runtime parameter validation for tool schemas

---

## DEMO FLOW (10-Minute Story Arc)

### Prologue — Setting the Scene (30s)
*"It's Monday morning at an investment bank. You're a PM running 21 holdings worth millions. Three years ago, this morning needed five systems and a junior analyst pulling overnight data. Today, you open Copilot."*

### Act 1 — Morning Briefing (2 min)
Prompt: `Read my portfolio and generate my Morning Briefing`
Shows: Portfolio Pulse, Market Movers, Client Alerts, Prospect Watch, AI Executive Commentary

### Act 2 — Command Center (90s)
Prompt: `Read my portfolio and show me the Portfolio Command Center`
Shows: Total AUM, Clients/Prospects tabs, compliance badges, FX exposure, sector allocation, drill-down

### Act 3 — Stress Testing (90s)
Prompt: `Read my portfolio and show me the Macro Stress Test dashboard`
Shows: S&P -20% scenario, waterfall chart, per-holding beta impact, rate shock comparison

### Act 4 — CRM & Deal Intelligence (2 min)
Prompts: `Show me the investment pipeline from CRM` → `Show me the CRM profile for NVDA`
Shows: Pipeline funnel, deal types, compliance badges, NVIDIA contacts, opportunity deep links

### Act 5 — Compliance & Governance (1 min)
Prompts: `Are there any deals flagged for compliance review?` → `What's the pipeline-weighted revenue forecast?`
Shows: Flagged deals, concentration limits, $2.3M weighted forecast

### Act 6 — Taking Action (1 min)
Prompt: `Add Tesla as a prospect to my portfolio`
Shows: Pre-filled CRUD form, submit to Dataverse, auto-create CRM account

### Act 7 — Digital Worker (90s)
Show: /api/scheduled endpoint list, trigger monitor live, show Teams channel alerts
*"It watches the markets so you don't have to."*

### Act 8 — Voice Interface (1 min)
Voice commands: "What's my portfolio value?" → "How's NVIDIA doing?" → "Send a quick email about NVIDIA"
*"No screen, no keyboard. Decisions by voice on the trading floor."*

### Epilogue — Architecture (30s)
Three pillars: Declarative Agent + Digital Worker + Voice Interface
*"This is what an AI-native enterprise application looks like."*

---

## PITCH DECK SLIDE STRUCTURE (Recommended)

### For Non-Technical Audience
1. **Title Slide** — "Portfolio Manager: AI That Manages Your Investments"
2. **The Problem** — 5 systems, manual data, delayed decisions, compliance risk
3. **The Solution** — One sentence to Copilot: "Read my portfolio and generate my Morning Briefing"
4. **Demo Highlights** — Screenshots of 4 key widgets (Briefing, Command Center, Stress Test, CRM Pipeline)
5. **The Digital Worker** — "It works while you sleep" — autonomous monitoring & alerts
6. **Voice Interface** — "Decisions on the move" — hands-free on the trading floor
7. **Business Impact** — Hours saved, faster decisions, compliance automation, risk reduction
8. **Architecture (Simplified)** — 3 pillars diagram with Microsoft logos
9. **Built on Microsoft** — Logo cloud: M365 Copilot, Azure OpenAI, Dataverse, D365, Graph, Container Apps
10. **Call to Action** — "Build your AI-native enterprise application on Microsoft's AI stack"

### For Technical Audience
1. **Title Slide** — "Portfolio Manager: Full-Stack AI Agent Architecture"
2. **Architecture Diagram** — Microsoft-standard diagram with all layers (see above)
3. **MCP Tool Inventory** — 40+ tools across 3 custom + 11 M365 platform servers
4. **Widget Protocol** — OpenAI Apps SDK outputTemplate with HTML5 dashboards
5. **Declarative Agent** — v1.6 schema, capabilities, plugin structure
6. **Digital Worker** — A365 agentic user, @openai/agents SDK, function tools, M365 MCP
7. **Scheduled Operations** — API-driven scheduler, webhook architecture, Graph client credentials
8. **Data Architecture** — Dataverse schema, D365 CRM entities, Finnhub API integration
9. **Auth & Security** — Agentic OAuth, service connections, SCHEDULED_SECRET, Entra ID
10. **Voice Architecture** — Azure Voice Live WebSocket proxy, real-time tool calling
11. **Observability** — A365 Observability SDK, telemetry, inference tracing
12. **DevOps** — Azure Container Registry, Container Apps, Dockerfile, CI/CD

---

## KEY DIFFERENTIATORS (vs. Traditional Chatbot / Copilot Wrapper)

| Traditional Chatbot | Portfolio Manager Agent |
|---------------------|----------------------|
| Text-only responses | 12 interactive UI widgets rendered in-chat |
| Manual data retrieval | 40+ MCP tools called autonomously |
| Reactive (user must ask) | Proactive (Digital Worker monitors 24/7) |
| Single interface | 3 interfaces: Copilot + Teams Worker + Voice |
| No enterprise data | Dataverse + D365 CRM + Finnhub live market data |
| No compliance | Built-in compliance tracking, IC calendar, deal governance |
| No actions | CRUD operations, email, Teams messaging, trade simulation |
| Static prompts | Context-aware: remembers conversation, enriches with real data |

---

## PERSONAS & USE CASES

### Primary: Portfolio Manager
- Morning routine: Open Copilot → briefing → review alerts → check compliance → act
- Throughout the day: Digital Worker sends price alerts, FX moves, earnings warnings
- On the floor: Voice interface for quick checks and email composition

### Secondary: Risk Analyst
- Stress test any scenario in seconds
- Concentration risk analysis with HHI index
- FX exposure mapping with hedge status

### Secondary: Investment Committee
- Pipeline-weighted revenue forecast
- Compliance status dashboard
- IC calendar with deal summaries
- Deal type breakdown (M&A, Capital Raise, Exit)

### Secondary: Client Relationship Manager
- Client 360 View combining market + CRM data
- Contact lookup with mailto links
- Activity timeline and touchpoint tracking
- D365 deep links for deal records

---

## NUMBERS FOR THE DECK

- **3** AI interfaces (Copilot, Digital Worker, Voice)
- **12** interactive widget dashboards
- **40+** MCP tools across 3 custom servers
- **11** M365 platform MCP servers connected
- **6** autonomous scheduled tasks
- **21** portfolio holdings tracked
- **10** currency pairs monitored
- **5** deal types tracked (M&A, Capital Raise, FX Hedging, Follow-on, Exit)
- **4** compliance statuses (Pending, Approved, Flagged, Escalated)
- **8** seconds — time to generate a morning briefing that takes an analyst team 1 hour
- **24/7** — autonomous monitoring with no human intervention
- **0** spreadsheets — everything in Dataverse and D365

---

## MICROSOFT BRANDING & LOGOS TO INCLUDE

- Microsoft 365 Copilot
- Azure OpenAI Service
- Microsoft Dataverse
- Dynamics 365
- Microsoft Graph
- Azure Container Apps
- Microsoft Entra ID
- Microsoft Teams
- Power Automate
- Azure Voice Live
- Model Context Protocol (MCP)
- OpenAI Apps SDK
