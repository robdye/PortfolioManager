# Portfolio Manager — Full Platform Demo
## Declarative Agent · Digital Worker · Voice Interface
### *~12 minutes · Told as a story*

---

## Before You Begin

**Open in advance:**
- [M365 Copilot](https://m365.cloud.microsoft/chat) — select **Portfolio Manager** from the agent sidebar
- [Digital Worker health](https://your-worker-url/api/health) — confirm status is healthy
- [Voice page](https://your-worker-url/voice) — have voice tab ready but hidden
- D365 CRM in another tab (for deep links)
- Stable internet connection — all market data is live

---

## Prologue — Setting the Scene (30 sec)

> *"Picture this. It's Monday morning at an investment bank. You're a Portfolio Manager running 21 holdings — pharmaceuticals, tech, energy, luxury goods, REITs — worth millions. Some are active Client positions. Others are Prospect companies in your pipeline.*

> *You've got earnings calls this week, an FX exposure question from the risk desk, a compliance review due on your NVIDIA exit strategy, and the Investment Committee meeting on Thursday.*

> *Three years ago, this morning would have started with five different systems, a junior analyst pulling overnight data, and a prayer that nothing moved while you slept.*

> *Today, you don't even need to open anything. Your Digital Worker has already been watching the markets overnight. It's detected three relative value shifts, flagged a position it thinks you should challenge, and drafted your morning briefing — leading with what has changed, not a data dump.*

> *You open Copilot."*

---

## Act 1 — The Morning Briefing (2 min)
### *"Your AI analyst has already done the overnight shift — and it leads with what has changed."*

**[PROMPT]**
```
Read my portfolio and generate my Morning Briefing
```

> *"One sentence. That's all it takes. The agent reads every holding from Dataverse — not a spreadsheet, not a file share — a proper enterprise database. It classifies each as Client or Prospect, then queries Finnhub for live news, prices, and analyst moves across every single company. But here's what's different from a typical dashboard — it runs the Decision Engine first, detecting what has actually changed since yesterday."*

**[POINT OUT as widget loads]**
- **⚡ What Has Changed** — *"This is new. The briefing leads with RV shifts, analyst rating changes, and overnight price moves. Not 'here's your portfolio' — 'here's what moved while you slept.'"*
- **Portfolio Pulse** — *"21 companies, how many have news, gainers vs losers, C-suite moves — the vital signs in four numbers."*
- **Market Movers** — *"The biggest moves today, at a glance."*
- **Client Alerts** — *"Red is risk — a lawsuit, a recall. Gold is earnings. The agent categorises news automatically so I know what needs attention first."*
- **Prospect Watch** — *"Pipeline companies. Timing signals — is there a dip for entry? A catalyst approaching?"*
- Scroll to **AI Executive Commentary** — *"And this is the 'Alpha' layer. The AI synthesises everything into themes, client alerts, prospect signals, and — critically — action items for today. But notice: the commentary is opinionated. It says 'I think' and 'I recommend'. This isn't a data dump — it's a senior analyst giving you their view."*

---

## Act 2 — The Command Center (90 sec)
### *"Now let me show you the cockpit."*

**[PROMPT]**
```
Read my portfolio and show me the Portfolio Command Center
```

> *"This is where data becomes decisions."*

**[INTERACTIVE — move quickly]**
1. **Portfolio Value** — *"Total AUM, day change, P&L — live."*
2. Click **Clients** tab — *"My active positions. Each tile shows price, daily move, analyst consensus."*
3. Click **Prospects** tab — *"Pipeline companies. P/E, yield, market cap — all the screening metrics."*
4. Point to a tile with a **⚠ Flagged** badge — *"See that? Compliance status — pulled from Dataverse. NVIDIA has a compliance flag on it. We'll come back to that."*
5. Point to a **💱 GBP/USD** badge — *"Currency exposure, with a checkmark if it's hedged. The PM sees FX risk at a glance."*
6. **Sector Allocation** — *"Pharma at 43% — that's a concentration warning right there."*
7. **Click NVDA tile** — *"Drill into full fundamentals, 52-week range, analyst bars, headlines — without leaving Copilot."*

---

## Act 3 — Risk & Stress Testing (90 sec)
### *"The risk desk calls. 'What happens if the S&P drops 20%?'"*

**[PROMPT]**
```
Read my portfolio and show me the Macro Stress Test dashboard
```

> *"Instead of calling a quant team and waiting an hour, I ask the question. The agent stress-tests every holding using real betas, real correlations."*

**[INTERACTIVE]**
1. Click **"S&P 500 -20%"** — *"Watch the waterfall chart. Pharma is my biggest pain point. Technology second."*
2. Scroll to **Per-Holding Impact** — *"NVIDIA, beta 1.7, takes the hardest hit. Realty Income at 0.78 is the safe haven."*
3. Click **"Rates +100bps"** — *"Different shock, different winners. The agent re-prices instantly."*

> *"Scenario analysis that would take a quant team a morning — done in seconds, inside Copilot."*

---

## Act 4 — Change Detection & Holdings Challenge (2 min)
### *"A chatbot answers questions. A digital employee challenges your assumptions."*

**[PROMPT]**
```
Read my portfolio and show me the RV Shift Detection dashboard — what has changed in relative valuations this week?
```

> *"This is the heart of the upgrade. Most portfolio tools show you where things are. This shows you where things are moving. The agent compares today's PE, analyst ratings, and price performance against a week ago, and surfaces what has shifted."*

**[POINT OUT as widget loads]**
- **Summary Cards** — *"Three numbers: how many holdings became expensive, how many became cheap, and how many had analyst rating changes. Immediately tells me where to focus."*
- **Shift Alerts** — *"These call out the biggest moves — 'NVDA PE shifted +15% in 7 days'. That's not a price move, that's a valuation move. Different signal entirely."*
- **Sector RV Movement** — *"Bar chart showing which sectors are drifting. If tech is getting uniformly expensive, that's a sector call, not a stock call."*

**[PROMPT]**
```
Read my portfolio and challenge my holdings
```

> *"Now watch this. I'm asking the agent to argue against my own portfolio. 'Why are you still holding this?' — backed by data."*

**[POINT OUT as widget loads]**
- **Challenge Cards** — *"Each card flags a position with severity dots — red is urgent. Multiple reasons per holding: expensive PE, negative momentum, analyst downgrades, overweight."*
- **Metrics Row** — *"PE, total return, weight, sector rank — the evidence behind each challenge."*
- Point to a **high-severity** card — *"This one has three reasons to sell. The agent isn't saying 'sell it' — it's saying 'justify why you're still holding it'. That's what a good analyst does."*

**[PROMPT]**
```
Read my portfolio and show me the benchmark comparison
```

> *"And finally — where am I versus the benchmark? Active share, tracking error, sector over/underweights."*

**[POINT OUT]**
- **Sector Drift Bars** — *"Fund weight vs benchmark weight, side by side. Immediately see where I'm making active bets."*
- **Impact Cards** — *"Not just 'you're overweight tech' but 'here's how that overweight contributed or detracted from performance'."*

> *"Three tools that transform the agent from a data retriever into an investment analyst. It detects change, challenges assumptions, and measures deviation from benchmark — the three things a PM actually needs."*

---

## Act 5 — CRM & Deal Intelligence (2 min)
### *"Market data is half the story. The other half is relationships."*

**[PROMPT]**
```
Show me the investment pipeline from CRM
```

> *"The agent connects straight to Dynamics 365. But this isn't just a list of opportunities. Look at what's been enriched."*

**[POINT OUT]**
- **Weighted Revenue KPI** — *"Pipeline value weighted by win probability. The number that actually matters."*
- **Deal type badges** — *"M&A in purple. Capital Raise in blue. FX Hedging in gold. Exit in red. Every deal classified."*
- **Risk rating** — *"Green, amber, red — RAG status on every deal."*
- **Compliance badges** — *"⚠ Flagged and ⚠ Pending — the deals that need attention before IC."*

**[PROMPT]**
```
Show me the CRM profile for NVDA
```

> *"Let me pull up NVIDIA — the one with the compliance flag."*

**[INTERACTIVE]**
1. **Key contacts** — *"Robert Kim, Head of IR. Rachel Adams, VP Corporate Strategy. Click any name to email them."*
2. **Opportunity card** — *"Semiconductor Cycle Top-up, $800K, Develop stage. Deal type: Follow-on. Win probability: 70%. Risk: Medium. And there it is — Compliance: ⚠ Flagged."*
3. **Click the opportunity** — *"Deep link straight into the live D365 record."*
4. **Recent Activities** — *"H200 Supply Chain Update call six days ago. GTC Conference Debrief. Every touchpoint tracked."*

> *"Market intelligence and relationship data — unified. No switching between Bloomberg and CRM."*

---

## Act 6 — Compliance & Deal Governance (1 min)
### *"That compliance flag. Let's deal with it."*

**[PROMPT]**
```
Are there any deals flagged for compliance review?
```

> *"The agent queries the deal tracker and compliance review logs. NVIDIA's position exceeds the single-name concentration limit. The compliance team flagged it before IC."*

**[PROMPT]**
```
What's the pipeline-weighted revenue forecast?
```

> *"$2.3M weighted, broken down by stage and deal type. This is the number the Investment Committee needs on Thursday."*

---

## Act 7 — Taking Action (1 min)
### *"Enough analysis. Let's act."*

**[PROMPT]**
```
Add Tesla as a prospect to my portfolio
```

> *"Watch — the agent opens an interactive form, pre-filled. Company name, ticker, sector, holding type set to Prospect, shares set to zero. I can set the currency exposure, review everything, and submit. It writes directly to Dataverse. And it auto-creates the CRM account."*

**[POINT OUT]**
- Pre-filled form with new fields: **Holding Type** dropdown, **Currency Exposure**
- Submit button → writes to Dataverse, not Excel
- *"No spreadsheets. No copy-paste. Enterprise-grade data management from natural language."*

---

## Act 8 — The Digital Worker (2 min)
### *"Everything you've seen so far runs in M365 Copilot. But what happens when you're not looking?"*

> *"This is where the Digital Worker takes over. It's an autonomous A365 agent running on Azure — with its own identity, its own mailbox, its own Teams presence. And this isn't a chatbot waiting for questions. It's a digital employee that thinks, prioritises, and acts independently."*

**[SHOW the scheduler API — open /api/health in browser]**

> *"Eight scheduled endpoints, each triggered by Container App Jobs on a cron schedule. Let me walk you through what makes this different from a monitoring dashboard."*

**[WALK THROUGH the endpoint list]**
- `/api/scheduled/briefing` — *"Weekdays at 9am. But the briefing now runs the Decision Engine first — it detects what changed overnight and leads with that. Not 'here's your portfolio' but 'here's what moved while you slept'."*
- `/api/scheduled/decision` — *"This is the brain. Every 30 minutes during market hours, it gathers signals from five sources: price moves over 3%, relative value shifts over 10%, analyst rating changes, earnings approaching within 3 days, and challenged positions. Then it filters — if it already alerted you about NVDA an hour ago, it suppresses the repeat. Smart cooldown, not noise."*
- `/api/scheduled/monitor` — *"Every 5 minutes. The legacy price-only monitor — but now it also feeds the Decision Engine results back."*
- `/api/scheduled/fx` — *"Every 15 minutes. Monitors 10 major currency pairs."*
- `/api/scheduled/compliance` — *"Monday mornings. Weekly compliance digest."*
- `/api/scheduled/earnings` — *"Daily at 7am. Cross-references earnings calendar with holdings. Two days before a call, the PM gets analyst estimates."*
- `/api/scheduled/challenge` — *"Friday at 4pm. The weekly holdings challenge. It scans every position and asks: expensive PE, negative momentum, analyst downgrades, overweight? If yes, it generates a narrative — 'I recommend trimming X because...' — and emails the PM."*
- `/api/scheduled/commentary` — *"First business day of each month. Generates a 600-word fund commentary draft — market environment, contributors, detractors, outlook — in institutional tone, ready for client reports. Emails it to the PM for review."*

> *"The key insight: this agent doesn't just monitor — it decides what's worth your attention. Critical signals get emailed. Medium signals go to Teams. Low signals are logged but suppressed. That's the difference between a digital worker and a monitoring dashboard."*

> *"It also handles incoming messages. When someone emails the agent or messages it in Teams, it responds conversationally with full access to portfolio data, CRM, and market intelligence. And its persona is opinionated — it says 'I think' and 'I recommend', not 'the data shows'."*

---

## Act 9 — The Voice Interface (1 min)
### *"And for the PM on the trading floor who can't type..."*

**[Open the Voice tab]**

> *"This is Azure Voice Live — HD voice, real-time, with full tool-calling. The agent has the same 29 tools available by voice as it does in chat."*

**[VOICE DEMO — speak naturally]**

*"What's my portfolio value today?"*
→ Agent reads portfolio, gives total value and day change

*"How's NVIDIA doing?"*
→ Agent calls stock quote, reads back price and change

*"What's in my CRM pipeline?"*
→ Agent queries D365, summarises deal stages and values

*"Send a quick email to the team about NVIDIA's position"*
→ Agent composes and sends via Graph API

> *"No screen, no keyboard. The PM is making decisions by voice while walking the trading floor."*

---

## Epilogue — The Architecture (30 sec)

> *"Let me step back and show you what's under the hood.*

> *Three components working together:*
>
> 1. **Declarative Agent** — runs in M365 Copilot. 12 interactive widgets, 3 MCP plugins, 30+ tools. Handles all the visual, interactive workflows.
>
> 2. **Digital Worker** — runs autonomously on Azure Container Apps. API-driven scheduler — briefings, monitoring, FX alerts, compliance digests, earnings tracking. Its own Entra identity, its own mailbox.
>
> 3. **Voice Interface** — Azure Voice Live with real-time tool calling. Same capabilities, hands-free.
>
> *All powered by the **Model Context Protocol**, the **OpenAI Apps SDK widget protocol**, **Dataverse** for portfolio data, **D365** for CRM, **Finnhub** for live market data, and **Microsoft Graph** for email, Teams, and calendar.*
>
> *This is what an AI-native enterprise application looks like. Not a chatbot. Not a copilot wrapper. A full autonomous investment banking platform — built on Microsoft's AI stack."*

---

## Backup Prompts (if time permits or Q&A)

| Scenario | Prompt |
|----------|--------|
| FX Exposure | `Show me the FX rates for GBP/USD and EUR/USD` |
| Earnings Calendar | `What earnings are coming up in the next 2 weeks for my portfolio?` |
| SEC Filings | `Show me the latest SEC filings for MSFT` |
| Insider Activity | `Get insider transactions and sentiment for NVDA` |
| Concentration Risk | `Read my portfolio and show me the Concentration Risk dashboard` |
| Relative Value | `Read my portfolio and show me the Relative Value Analysis` |
| Deal Tracker | `Show me all M&A deals in the pipeline` |
| IC Calendar | `What deals have upcoming Investment Committee dates?` |
| Client 360 | `Read my portfolio and show me the Client 360 View for NVDA` |
| Stock Deep Dive | `Show me a detailed stock quote and analyst consensus for MSFT` |
| Company News | `Show me the latest news for BP` |
| CRM Contacts | `Who are my contacts at AstraZeneca?` |
| IPO Calendar | `Show me upcoming IPOs in the next 30 days` |
| Reported Financials | `Get the reported annual financials for AAPL` |
| Update Holding | `Update BP shares to 5000` |
| Delete Holding | `Remove Tesla from my portfolio` |
| Peer Comparison | `Get peers for MSFT and compare` |
| Update Holding | `Update my BP position to 5000 shares` |

---

## Architecture Slide (if needed)

```
┌─────────────────────────────────────────────┐
│           M365 Copilot (Frontend)           │
│  Declarative Agent + OpenAI Apps SDK        │
│  12 Interactive UI Widgets                  │
├─────────────┬──────────────┬────────────────┤
│ Finnhub MCP │ Portfolio MCP│   CRM MCP      │
│ /finnhub/mcp│ /portfolio/  │  /crm/mcp      │
│ 16 tools    │  5 tools     │  6 tools       │
├─────────────┼──────────────┼────────────────┤
│ Finnhub API │ Graph API    │ Dataverse API  │
│ Market Data │ SharePoint   │ D365 CRM       │
│ Quotes,News │ Excel CRUD   │ Accounts,      │
│ Consensus   │ Portfolio    │ Contacts,      │
│ Financials  │ Holdings     │ Opportunities  │
└─────────────┴──────────────┴────────────────┘
         Azure Container Apps (Express.js)
         <YOUR_ACR_NAME>.azurecr.io
```
