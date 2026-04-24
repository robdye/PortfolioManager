/**
 * D365 CRM Data Enrichment Script
 * Adds contacts, opportunities, and activities for all portfolio accounts.
 * Run: node --import tsx scripts/enrich-crm.ts
 */

const CRM_URL = "https://orge2a9a349.crm.dynamics.com";
const API = `${CRM_URL}/api/data/v9.2`;

async function getToken(): Promise<string> {
  const { execSync } = await import("child_process");
  return execSync(`az account get-access-token --resource "${CRM_URL}" --query accessToken -o tsv`, { encoding: "utf8" }).trim();
}

let TOKEN = "";
const headers = () => ({
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
  Accept: "application/json",
  "OData-MaxVersion": "4.0",
  "OData-Version": "4.0",
});

async function get(path: string) {
  const url = path.startsWith("http") ? path : `${API}${path}`;
  const r = await fetch(url, { headers: headers() });
  if (!r.ok) throw new Error(`GET ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function post(path: string, body: any) {
  const r = await fetch(`${API}${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  if (!r.ok) { const t = await r.text(); console.error(`  FAIL POST ${path}: ${r.status} ${t.substring(0, 200)}`); return null; }
  return true;
}

// ── Contact data ──
const CONTACTS: Record<string, Array<{ first: string; last: string; title: string; phone: string }>> = {
  AZN: [
    { first: "Sarah", last: "Chen", title: "Head of Investor Relations", phone: "+44 20 7604 8100" },
    { first: "Marcus", last: "Webb", title: "CFO Office - VP Finance", phone: "+44 20 7604 8200" },
    { first: "Fiona", last: "Gallagher", title: "Director of Corporate Strategy", phone: "+44 20 7604 8300" },
  ],
  BP: [
    { first: "James", last: "Harrison", title: "Director of Investor Relations", phone: "+44 20 7496 4100" },
    { first: "Emma", last: "Thornton", title: "Head of Treasury", phone: "+44 20 7496 4200" },
    { first: "Raj", last: "Patel", title: "VP Corporate Development", phone: "+44 20 7496 4300" },
  ],
  RIO: [
    { first: "Andrew", last: "McLeod", title: "IR Manager", phone: "+44 20 7781 2100" },
    { first: "Helen", last: "Fraser", title: "Chief Sustainability Officer", phone: "+44 20 7781 2200" },
    { first: "Tom", last: "Blackwood", title: "Head of M&A", phone: "+44 20 7781 2300" },
  ],
  GLNCY: [
    { first: "Thomas", last: "Berger", title: "Head of Investor Relations", phone: "+41 41 709 2100" },
    { first: "Claudia", last: "Meier", title: "Group Treasurer", phone: "+41 41 709 2200" },
  ],
  GSK: [
    { first: "Priya", last: "Sharma", title: "Head of IR", phone: "+44 20 8047 5100" },
    { first: "Richard", last: "Blackwell", title: "VP Pipeline Strategy", phone: "+44 20 8047 5200" },
    { first: "Natasha", last: "Collins", title: "Director External Affairs", phone: "+44 20 8047 5300" },
  ],
  CMPGY: [
    { first: "Sophie", last: "Lambert", title: "Investor Relations Manager", phone: "+44 1932 573 100" },
    { first: "George", last: "Whitfield", title: "CFO - Group Finance", phone: "+44 1932 573 200" },
  ],
  RYCEY: [
    { first: "William", last: "Hughes", title: "Head of IR", phone: "+44 20 7222 9100" },
    { first: "Rebecca", last: "Shaw", title: "Director Defence Strategy", phone: "+44 20 7222 9200" },
  ],
  MSFT: [
    { first: "David", last: "Park", title: "VP Investor Relations", phone: "+1 425 882 8100" },
    { first: "Lisa", last: "Zhang", title: "Corporate Development Director", phone: "+1 425 882 8200" },
    { first: "Kevin", last: "O'Brien", title: "Chief Economist", phone: "+1 425 882 8300" },
  ],
  JNJ: [
    { first: "Michael", last: "Torres", title: "Investor Relations Director", phone: "+1 732 524 0500" },
    { first: "Angela", last: "Russo", title: "VP Medical Affairs", phone: "+1 732 524 0600" },
    { first: "Scott", last: "Henderson", title: "Head of Business Development", phone: "+1 732 524 0700" },
  ],
  PG: [
    { first: "Jennifer", last: "Walsh", title: "VP Investor Relations", phone: "+1 513 983 1200" },
    { first: "Derek", last: "Nguyen", title: "Head of Digital Transformation", phone: "+1 513 983 1300" },
  ],
  LVMUY: [
    { first: "Pierre", last: "Dubois", title: "Directeur Relations Investisseurs", phone: "+33 1 44 13 2300" },
    { first: "Isabelle", last: "Moreau", title: "VP Brand Strategy", phone: "+33 1 44 13 2400" },
    { first: "Jean-Claude", last: "Martin", title: "Group CFO Office", phone: "+33 1 44 13 2500" },
  ],
  NSRGY: [
    { first: "Hans", last: "Mueller", title: "Head of IR", phone: "+41 21 924 2200" },
    { first: "Katarina", last: "Vogt", title: "Director of Sustainability", phone: "+41 21 924 2300" },
  ],
  VZ: [
    { first: "Karen", last: "Sullivan", title: "SVP Investor Relations", phone: "+1 212 395 1100" },
    { first: "Marcus", last: "Johnson", title: "VP Network Strategy", phone: "+1 212 395 1200" },
    { first: "Diana", last: "Reyes", title: "Head of Enterprise Sales", phone: "+1 212 395 1300" },
  ],
  O: [
    { first: "Daniel", last: "Cruz", title: "VP Capital Markets", phone: "+1 858 284 5100" },
    { first: "Samantha", last: "Gold", title: "Director of Acquisitions", phone: "+1 858 284 5200" },
  ],
  NVDA: [
    { first: "Robert", last: "Kim", title: "Head of IR", phone: "+1 408 486 2100" },
    { first: "Rachel", last: "Adams", title: "VP Corporate Strategy", phone: "+1 408 486 2200" },
    { first: "Alex", last: "Petrova", title: "Director AI Partnerships", phone: "+1 408 486 2300" },
  ],
  CE: [
    { first: "Amanda", last: "Foster", title: "Director IR", phone: "+1 972 443 4100" },
    { first: "Brian", last: "Hartley", title: "VP Operations", phone: "+1 972 443 4200" },
  ],
  UL: [
    { first: "Charlotte", last: "Price", title: "IR Director", phone: "+44 20 7822 5300" },
    { first: "Aiden", last: "McCarthy", title: "Head of ESG", phone: "+44 20 7822 5400" },
    { first: "Lena", last: "Johansson", title: "VP Beauty & Personal Care", phone: "+44 20 7822 5500" },
  ],
  DEO: [
    { first: "Oliver", last: "Grant", title: "Head of IR", phone: "+44 20 8978 6100" },
    { first: "Maya", last: "Krishnan", title: "Director Premium Brands", phone: "+44 20 8978 6200" },
  ],
  RELX: [
    { first: "Catherine", last: "Bell", title: "VP Investor Relations", phone: "+44 20 7166 5600" },
    { first: "Niall", last: "Fitzgerald", title: "Head of Data Analytics", phone: "+44 20 7166 5700" },
  ],
  AAPL: [
    { first: "Steven", last: "Nakamura", title: "Director IR", phone: "+1 408 996 1100" },
    { first: "Grace", last: "Lin", title: "VP Services Strategy", phone: "+1 408 996 1200" },
    { first: "Jonathan", last: "Rivera", title: "Head of Enterprise", phone: "+1 408 996 1300" },
  ],
  JPM: [
    { first: "Victoria", last: "Hernandez", title: "Managing Director IR", phone: "+1 212 270 6100" },
    { first: "Charles", last: "Worthington", title: "Head of Wealth Management", phone: "+1 212 270 6200" },
    { first: "Mei", last: "Tanaka", title: "VP Fixed Income Strategy", phone: "+1 212 270 6300" },
  ],
};

// Email domain per ticker
const EMAIL_DOMAIN: Record<string, string> = {
  AZN: "astrazeneca-ir.alphaportal.io", BP: "bp-ir.alphaportal.io", RIO: "riotinto-ir.alphaportal.io",
  GLNCY: "glencore-ir.alphaportal.io", GSK: "gsk-ir.alphaportal.io", CMPGY: "compass-ir.alphaportal.io",
  RYCEY: "rollsroyce-ir.alphaportal.io", MSFT: "microsoft-ir.alphaportal.io", JNJ: "jnj-ir.alphaportal.io",
  PG: "pg-ir.alphaportal.io", LVMUY: "lvmh-ir.alphaportal.io", NSRGY: "nestle-ir.alphaportal.io",
  VZ: "verizon-ir.alphaportal.io", O: "realtyincome-ir.alphaportal.io", NVDA: "nvidia-ir.alphaportal.io",
  CE: "celanese-ir.alphaportal.io", UL: "unilever-ir.alphaportal.io", DEO: "diageo-ir.alphaportal.io",
  RELX: "relx-ir.alphaportal.io", AAPL: "apple-ir.alphaportal.io", JPM: "jpmorgan-ir.alphaportal.io",
};

// ── Client Opportunities (enriched with deal fields) ──
const CLIENT_OPPS = [
  { ticker: "AZN", name: "AstraZeneca - Position Increase Review", value: 300000, stage: "2-Develop", close: "2026-06-15", desc: "Reviewing potential 500-share increase following strong oncology pipeline readout. Phase 3 data catalysts in Q3.", dealType: 4, winProb: 65, revForecast: 75000, margin: 18, compliance: 2, risk: 2, exit: "3-year strategic hold", currency: "GBP/USD" },
  { ticker: "AZN", name: "AstraZeneca - Dividend Reinvestment Plan", value: 50000, stage: "3-Propose", close: "2026-04-30", desc: "DRIP enrollment for AZN position. Annual dividend yield ~2.1%. Board approval pending.", dealType: 4, winProb: 85, revForecast: 12000, margin: 22, compliance: 2, risk: 1, exit: "", currency: "" },
  { ticker: "BP", name: "BP - Energy Transition Allocation", value: 200000, stage: "2-Develop", close: "2026-08-31", desc: "Increasing BP position aligned with energy transition thesis. Renewables capex up 40% YoY.", dealType: 2, winProb: 40, revForecast: 45000, margin: 15, compliance: 1, risk: 3, exit: "", currency: "GBP/USD, EUR/USD" },
  { ticker: "MSFT", name: "Microsoft - AI Infrastructure Play", value: 500000, stage: "1-Qualify", close: "2026-09-30", desc: "Evaluating additional MSFT allocation to capture Azure AI + Copilot revenue growth. Cloud margin expanding.", dealType: 4, winProb: 55, revForecast: 120000, margin: 28, compliance: 2, risk: 1, exit: "", currency: "" },
  { ticker: "NVDA", name: "NVIDIA - Semiconductor Cycle Top-up", value: 800000, stage: "2-Develop", close: "2026-07-31", desc: "Adding 50 shares on data center GPU demand acceleration. H200/Blackwell ramp underway.", dealType: 4, winProb: 70, revForecast: 200000, margin: 35, compliance: 3, risk: 2, exit: "Partial exit if P/E exceeds 45", currency: "" },
  { ticker: "JNJ", name: "Johnson & Johnson - Healthcare Rebalance", value: 150000, stage: "3-Propose", close: "2026-05-15", desc: "Portfolio rebalance to increase healthcare weight. JNJ MedTech segment growing 7% organic.", dealType: 4, winProb: 80, revForecast: 35000, margin: 20, compliance: 2, risk: 1, exit: "", currency: "" },
  { ticker: "GSK", name: "GSK - Vaccine Portfolio Thesis", value: 250000, stage: "1-Qualify", close: "2026-10-31", desc: "Evaluating GSK vaccine franchise value. Shingrix and new RSV vaccine driving growth.", dealType: 1, winProb: 35, revForecast: 60000, margin: 16, compliance: 1, risk: 2, exit: "Trade sale to pharma buyer", currency: "GBP/USD" },
  { ticker: "VZ", name: "Verizon - Yield Enhancement", value: 100000, stage: "3-Propose", close: "2026-04-15", desc: "Adding 500 shares for dividend yield optimization. Current yield ~6.5%. Fixed wireless gaining subscribers.", dealType: 4, winProb: 90, revForecast: 28000, margin: 25, compliance: 2, risk: 1, exit: "", currency: "" },
  { ticker: "LVMUY", name: "LVMH - Luxury Sector Expansion", value: 350000, stage: "1-Qualify", close: "2026-11-30", desc: "China reopening thesis. LVMH leather goods + spirits showing sequential improvement in APAC.", dealType: 2, winProb: 30, revForecast: 80000, margin: 20, compliance: 1, risk: 2, exit: "", currency: "EUR/USD" },
  { ticker: "PG", name: "Procter & Gamble - Defensive Anchor", value: 120000, stage: "2-Develop", close: "2026-06-30", desc: "Increasing consumer staples weight. P&G pricing power thesis - 5 consecutive quarters of organic growth.", dealType: 4, winProb: 75, revForecast: 30000, margin: 22, compliance: 2, risk: 1, exit: "", currency: "" },
  { ticker: "RIO", name: "Rio Tinto - Commodity Supercycle Thesis", value: 280000, stage: "1-Qualify", close: "2026-12-31", desc: "Copper demand from electrification. Rio Tinto Oyu Tolgoi ramp-up supporting long-term FCF growth.", dealType: 2, winProb: 25, revForecast: 55000, margin: 14, compliance: 1, risk: 3, exit: "", currency: "AUD/USD, GBP/USD" },
];

// ── Activities ──
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

const ACTIVITIES: Array<{ticker: string; type: string; subject: string; desc: string; daysAgo: number}> = [
  // AZN
  { ticker: "AZN", type: "phonecall", subject: "Q4 Earnings Follow-up Call - Sarah Chen", desc: "Discussed oncology pipeline progress. Tagrisso China approvals ahead of schedule.", daysAgo: 3 },
  { ticker: "AZN", type: "appointment", subject: "IR Day Attendance - London", desc: "Attended AZN Capital Markets Day. Management guided 2027 revenue $55B+.", daysAgo: 14 },
  { ticker: "AZN", type: "email", subject: "Position Increase Proposal Draft", desc: "Sent draft proposal for 500-share increase to investment committee.", daysAgo: 7 },
  // BP
  { ticker: "BP", type: "phonecall", subject: "Energy Transition Strategy Call", desc: "Call with James Harrison re: BP renewable energy targets and capex allocation.", daysAgo: 5 },
  { ticker: "BP", type: "appointment", subject: "BP Annual Strategy Review", desc: "Reviewed BP's integrated energy strategy with Raj Patel. Focus on hydrogen and CCS.", daysAgo: 21 },
  { ticker: "BP", type: "email", subject: "Dividend Analysis Shared", desc: "Shared BP dividend sustainability analysis with the team.", daysAgo: 2 },
  // MSFT
  { ticker: "MSFT", type: "appointment", subject: "Azure AI Briefing - Redmond", desc: "Deep dive on Azure OpenAI Service adoption metrics. Enterprise pipeline strong.", daysAgo: 10 },
  { ticker: "MSFT", type: "phonecall", subject: "Copilot Revenue Discussion - David Park", desc: "M365 Copilot seat growth tracking ahead of plan. 50K+ enterprise customers.", daysAgo: 4 },
  { ticker: "MSFT", type: "email", subject: "AI CapEx Research Note", desc: "Distributed research note on MSFT AI infrastructure spending and ROI timeline.", daysAgo: 1 },
  // NVDA
  { ticker: "NVDA", type: "phonecall", subject: "H200 Supply Chain Update - Robert Kim", desc: "TSMC CoWoS capacity increasing. H200 allocation improving for Q3.", daysAgo: 6 },
  { ticker: "NVDA", type: "appointment", subject: "GTC Conference Debrief", desc: "Internal debrief on GTC announcements. Blackwell Ultra on track for 2027.", daysAgo: 18 },
  { ticker: "NVDA", type: "email", subject: "Competitive Analysis: NVDA vs AMD", desc: "Shared GPU compute benchmarks and market share analysis.", daysAgo: 8 },
  // JNJ
  { ticker: "JNJ", type: "phonecall", subject: "MedTech Pipeline Review - Michael Torres", desc: "Discussed orthopedics recovery and robotic surgery platform expansion.", daysAgo: 9 },
  { ticker: "JNJ", type: "email", subject: "JNJ Spin-off Impact Analysis", desc: "Shared post-Kenvue separation valuation analysis.", daysAgo: 12 },
  // GSK
  { ticker: "GSK", type: "appointment", subject: "Vaccine Franchise Deep Dive", desc: "Met with Priya Sharma. RSV vaccine Arexvy launch tracking well.", daysAgo: 15 },
  { ticker: "GSK", type: "phonecall", subject: "Pipeline Catalyst Calendar Review", desc: "Reviewed upcoming Phase 3 readouts and regulatory filings.", daysAgo: 4 },
  // PG
  { ticker: "PG", type: "phonecall", subject: "Q3 Organic Growth Discussion", desc: "Jennifer Walsh confirmed pricing power holding. Volume turning positive.", daysAgo: 7 },
  { ticker: "PG", type: "email", subject: "Consumer Staples Sector Comparison", desc: "Sent P&G vs Unilever margin comparison.", daysAgo: 3 },
  // LVMUY
  { ticker: "LVMUY", type: "appointment", subject: "Paris Meeting - Pierre Dubois", desc: "Met IR team in Paris. China travel retail rebounding. Japan tourism boost.", daysAgo: 20 },
  { ticker: "LVMUY", type: "email", subject: "Luxury Index Performance Review", desc: "Shared LVMH relative performance vs luxury sector peers.", daysAgo: 5 },
  // VZ
  { ticker: "VZ", type: "phonecall", subject: "Fixed Wireless Update - Karen Sullivan", desc: "Fixed wireless subscriber adds accelerating. Target 5M by 2026 on track.", daysAgo: 8 },
  { ticker: "VZ", type: "email", subject: "Dividend Yield Comparison", desc: "Shared telecom dividend sustainability scorecard.", daysAgo: 2 },
  // NSRGY
  { ticker: "NSRGY", type: "phonecall", subject: "Portfolio Optimization Discussion", desc: "Hans Mueller discussed Nestle's brand portfolio pruning strategy.", daysAgo: 11 },
  // O
  { ticker: "O", type: "phonecall", subject: "REIT Market Update - Daniel Cruz", desc: "Discussed rate environment impact on REIT valuations and cap rates.", daysAgo: 6 },
  { ticker: "O", type: "email", subject: "Monthly Dividend Track Record", desc: "Updated Realty Income dividend growth history and coverage ratios.", daysAgo: 1 },
  // CE
  { ticker: "CE", type: "phonecall", subject: "Acetyl Chain Update", desc: "Amanda Foster reviewed acetyl chain pricing and demand trends.", daysAgo: 13 },
  // RIO
  { ticker: "RIO", type: "appointment", subject: "Mining Sector Roundtable", desc: "Industry roundtable with Rio Tinto, BHP. Copper supply deficit thesis confirmed.", daysAgo: 25 },
  { ticker: "RIO", type: "email", subject: "Oyu Tolgoi Production Forecast", desc: "Shared updated copper production ramp model.", daysAgo: 9 },
  // GLNCY
  { ticker: "GLNCY", type: "phonecall", subject: "Commodity Trading Update", desc: "Thomas Berger reviewed Glencore marketing division performance.", daysAgo: 16 },
  // CMPGY
  { ticker: "CMPGY", type: "email", subject: "Contract Pipeline Analysis", desc: "Compass Group new contract wins analysis shared.", daysAgo: 7 },
  // RYCEY
  { ticker: "RYCEY", type: "appointment", subject: "Defence Division Briefing", desc: "William Hughes briefed on Rolls-Royce defence order book growth.", daysAgo: 19 },
  { ticker: "RYCEY", type: "phonecall", subject: "Engine Flight Hours Recovery", desc: "Discussed widebody engine flight hour recovery and aftermarket revenue.", daysAgo: 5 },
  // Prospects
  { ticker: "UL", type: "phonecall", subject: "Initial Research Call - Charlotte Price", desc: "Introductory call on Unilever's growth strategy and margin recovery plan.", daysAgo: 8 },
  { ticker: "UL", type: "email", subject: "Unilever ESG Scorecard", desc: "Reviewed Unilever sustainability metrics vs peers.", daysAgo: 3 },
  { ticker: "DEO", type: "appointment", subject: "Diageo Tasting & Strategy Session", desc: "Met Oliver Grant. Discussed premium spirits market share gains and pricing power.", daysAgo: 12 },
  { ticker: "DEO", type: "phonecall", subject: "Valuation Discussion", desc: "Follow-up on entry price targets. Watching for pullback below $155.", daysAgo: 4 },
  { ticker: "RELX", type: "phonecall", subject: "Data Analytics Platform Demo", desc: "Catherine Bell demonstrated LexisNexis Risk Solutions growth drivers.", daysAgo: 10 },
  { ticker: "AAPL", type: "email", subject: "Services Revenue Deep Dive", desc: "Shared Apple Services (App Store, iCloud, Apple TV+) growth model.", daysAgo: 6 },
  { ticker: "AAPL", type: "appointment", subject: "Apple Ecosystem Analysis", desc: "Internal review of Apple's installed base monetization thesis.", daysAgo: 22 },
  { ticker: "JPM", type: "phonecall", subject: "NIM Outlook Discussion - Victoria Hernandez", desc: "Discussed JPM net interest margin trajectory in current rate environment.", daysAgo: 7 },
  { ticker: "JPM", type: "appointment", subject: "JPM Investor Day Notes", desc: "Attended JPM investor day. CIB technology spend driving efficiency gains.", daysAgo: 30 },
  { ticker: "JPM", type: "email", subject: "Banking Sector Rate Sensitivity Model", desc: "Shared rate sensitivity analysis for top-4 US banks.", daysAgo: 2 },
];

async function main() {
  TOKEN = await getToken();
  console.log("Token acquired");

  // Get all portfolio accounts
  const acctResp = await get("/accounts?$filter=tickersymbol ne null&$select=accountid,name,tickersymbol&$orderby=name");
  const accounts: any[] = acctResp.value;
  const acctMap: Record<string, string> = {};
  accounts.forEach((a: any) => { acctMap[a.tickersymbol] = a.accountid; });
  console.log(`Found ${accounts.length} portfolio accounts`);

  // Delete existing portfolio contacts and recreate
  console.log("\n--- Deleting existing portfolio contacts ---");
  const existingContacts = await get("/contacts?$select=contactid&$expand=parentcustomerid_account($select=tickersymbol)&$filter=parentcustomerid_account/tickersymbol ne null&$top=100");
  for (const c of existingContacts.value) {
    await fetch(`${API}/contacts(${c.contactid})`, { method: "DELETE", headers: headers() });
  }
  console.log(`Deleted ${existingContacts.value.length} contacts`);

  // Create contacts
  console.log("\n--- Creating contacts ---");
  let contactCount = 0;
  for (const [ticker, contactList] of Object.entries(CONTACTS)) {
    const aid = acctMap[ticker];
    if (!aid) { console.log(`  SKIP ${ticker} - no account`); continue; }
    const domain = EMAIL_DOMAIN[ticker] || "alphaportal.io";
    for (const c of contactList) {
      const email = `${c.first.toLowerCase()}.${c.last.toLowerCase()}@${domain}`;
      const ok = await post("/contacts", {
        firstname: c.first, lastname: c.last, jobtitle: c.title,
        emailaddress1: email, telephone1: c.phone,
        "parentcustomerid_account@odata.bind": `/accounts(${aid})`,
      });
      if (ok) { contactCount++; console.log(`  OK ${ticker} - ${c.first} ${c.last} <${email}>`); }
    }
  }
  console.log(`Created ${contactCount} contacts`);

  // Create client opportunities
  console.log("\n--- Creating client opportunities ---");
  let oppCount = 0;
  for (const opp of CLIENT_OPPS) {
    const aid = acctMap[opp.ticker];
    if (!aid) continue;
    const body: any = {
      name: opp.name, estimatedvalue: opp.value, estimatedclosedate: opp.close,
      description: opp.desc, stepname: opp.stage,
      "customerid_account@odata.bind": `/accounts(${aid})`,
    };
    // Enriched deal fields (custom columns on Opportunity)
    if (opp.dealType) body.new_dealtype = opp.dealType;
    if (opp.winProb != null) body.new_winprobability = opp.winProb;
    if (opp.revForecast) body.new_revenueforecast = opp.revForecast;
    if (opp.margin) body.new_marginpercent = opp.margin;
    if (opp.compliance) body.new_compliancestatus = opp.compliance;
    if (opp.risk) body.new_riskrating = opp.risk;
    if (opp.exit) body.new_exitstrategy = opp.exit;
    if (opp.currency) body.new_currencyexposure = opp.currency;

    const ok = await post("/opportunities", body);
    if (ok) { oppCount++; console.log(`  OK ${opp.ticker} - ${opp.name} ($${opp.value}) [${['','M&A','Cap Raise','FX Hedge','Follow-on','Exit'][opp.dealType]||''}]`); }
  }
  console.log(`Created ${oppCount} client opportunities`);

  // Create activities
  console.log("\n--- Creating activities ---");
  let actCount = 0;
  for (const act of ACTIVITIES) {
    const aid = acctMap[act.ticker];
    if (!aid) continue;
    const scheduledstart = daysAgo(act.daysAgo) + "T09:00:00Z";
    const scheduledend = daysAgo(act.daysAgo) + "T10:00:00Z";

    let endpoint = "";
    let body: any = {};
    if (act.type === "phonecall") {
      endpoint = "/phonecalls";
      body = { subject: act.subject, description: act.desc, phonenumber: "+44 20 7604 8000",
        scheduledstart, scheduledend, "regardingobjectid_account@odata.bind": `/accounts(${aid})` };
    } else if (act.type === "email") {
      endpoint = "/emails";
      body = { subject: act.subject, description: act.desc, directioncode: true,
        scheduledstart, scheduledend, "regardingobjectid_account@odata.bind": `/accounts(${aid})` };
    } else if (act.type === "appointment") {
      endpoint = "/appointments";
      body = { subject: act.subject, description: act.desc, location: "London / Virtual",
        scheduledstart, scheduledend, "regardingobjectid_account@odata.bind": `/accounts(${aid})` };
    }

    const ok = await post(endpoint, body);
    if (ok) { actCount++; console.log(`  OK ${act.ticker} - [${act.type}] ${act.subject}`); }
  }
  console.log(`Created ${actCount} activities`);

  console.log("\n=== DONE ===");
  console.log(`Contacts: ${contactCount} | Client Opps: ${oppCount} | Activities: ${actCount}`);
}

main().catch(console.error);
