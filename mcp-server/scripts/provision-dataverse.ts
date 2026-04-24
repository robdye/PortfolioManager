/**
 * Provision Dataverse custom tables + migrate portfolio data from Excel.
 * Uses client credentials (admin) to create tables, then populates them.
 *
 * Run: node --env-file=.env --import tsx scripts/provision-dataverse.ts
 */

const CRM_URL = process.env.CRM_URL || "";
const API = `${CRM_URL}/api/data/v9.2`;

async function getToken(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.GRAPH_CLIENT_ID!,
    client_secret: process.env.GRAPH_CLIENT_SECRET!,
    scope: `${CRM_URL}/.default`,
  });
  const res = await fetch(`https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  if (!res.ok) throw new Error(`Token error: ${res.status} ${await res.text()}`);
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

let TOKEN = "";
const hdrs = () => ({
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
  Accept: "application/json",
  "OData-MaxVersion": "4.0",
  "OData-Version": "4.0",
  Prefer: "return=representation",
});

async function apiPost(path: string, body: unknown): Promise<any> {
  const url = path.startsWith("http") ? path : `${API}${path}`;
  const r = await fetch(url, { method: "POST", headers: hdrs(), body: JSON.stringify(body) });
  if (!r.ok) {
    const t = await r.text();
    if (t.includes("already exists") || t.includes("DuplicateRecord")) {
      console.log(`    (already exists, skipping)`);
      return null;
    }
    throw new Error(`POST ${path}: ${r.status} ${t.substring(0, 300)}`);
  }
  if (r.status === 204) return null;
  return r.json();
}

async function apiGet(path: string): Promise<any> {
  const url = path.startsWith("http") ? path : `${API}${path}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" } });
  if (!r.ok) throw new Error(`GET ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

// ═══════════════════════════════════════════════════════════════
// Step 1: Create custom tables via Metadata API
// ═══════════════════════════════════════════════════════════════

async function createTable(schema: string, display: string, plural: string, desc: string, primaryAttr: string, primaryDisplay: string) {
  console.log(`  Creating table: ${schema}...`);
  try {
    await apiPost("/EntityDefinitions", {
      SchemaName: schema,
      DisplayName: { "@odata.type": "Microsoft.Dynamics.CRM.Label", LocalizedLabels: [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", Label: display, LanguageCode: 1033 }] },
      DisplayCollectionName: { "@odata.type": "Microsoft.Dynamics.CRM.Label", LocalizedLabels: [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", Label: plural, LanguageCode: 1033 }] },
      Description: { "@odata.type": "Microsoft.Dynamics.CRM.Label", LocalizedLabels: [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", Label: desc, LanguageCode: 1033 }] },
      HasActivities: false,
      HasNotes: false,
      OwnershipType: "UserOwned",
      IsActivity: false,
      PrimaryNameAttribute: primaryAttr,
      Attributes: [{
        "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
        SchemaName: primaryAttr,
        DisplayName: { "@odata.type": "Microsoft.Dynamics.CRM.Label", LocalizedLabels: [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", Label: primaryDisplay, LanguageCode: 1033 }] },
        MaxLength: 300,
        RequiredLevel: { Value: "ApplicationRequired" },
        AttributeType: "String",
        FormatName: { Value: "Text" },
      }],
    });
    console.log(`    ✓ ${schema} created`);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("already exists")) { console.log(`    ✓ ${schema} already exists`); return; }
    console.error(`    ✗ ${schema}: ${msg}`);
  }
}

async function addColumn(tableName: string, column: any) {
  try {
    await apiPost(`/EntityDefinitions(LogicalName='${tableName}')/Attributes`, column);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("already exists")) return;
    console.warn(`    ⚠ ${column.SchemaName}: ${msg.substring(0, 100)}`);
  }
}

function strCol(schema: string, display: string, maxLen = 200): any {
  return {
    "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
    SchemaName: schema,
    DisplayName: { "@odata.type": "Microsoft.Dynamics.CRM.Label", LocalizedLabels: [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", Label: display, LanguageCode: 1033 }] },
    MaxLength: maxLen,
    RequiredLevel: { Value: "None" },
    AttributeType: "String",
    FormatName: { Value: "Text" },
  };
}

function intCol(schema: string, display: string): any {
  return {
    "@odata.type": "Microsoft.Dynamics.CRM.IntegerAttributeMetadata",
    SchemaName: schema,
    DisplayName: { "@odata.type": "Microsoft.Dynamics.CRM.Label", LocalizedLabels: [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", Label: display, LanguageCode: 1033 }] },
    RequiredLevel: { Value: "None" },
    MinValue: 0, MaxValue: 999999999,
    AttributeType: "Integer",
  };
}

function decCol(schema: string, display: string, precision = 2): any {
  return {
    "@odata.type": "Microsoft.Dynamics.CRM.DecimalAttributeMetadata",
    SchemaName: schema,
    DisplayName: { "@odata.type": "Microsoft.Dynamics.CRM.Label", LocalizedLabels: [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", Label: display, LanguageCode: 1033 }] },
    RequiredLevel: { Value: "None" },
    Precision: precision,
    MinValue: -999999999, MaxValue: 999999999,
    AttributeType: "Decimal",
  };
}

function boolCol(schema: string, display: string): any {
  return {
    "@odata.type": "Microsoft.Dynamics.CRM.BooleanAttributeMetadata",
    SchemaName: schema,
    DisplayName: { "@odata.type": "Microsoft.Dynamics.CRM.Label", LocalizedLabels: [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", Label: display, LanguageCode: 1033 }] },
    RequiredLevel: { Value: "None" },
    AttributeType: "Boolean",
    OptionSet: {
      TrueOption: { Value: 1, Label: { "@odata.type": "Microsoft.Dynamics.CRM.Label", LocalizedLabels: [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", Label: "Yes", LanguageCode: 1033 }] } },
      FalseOption: { Value: 0, Label: { "@odata.type": "Microsoft.Dynamics.CRM.Label", LocalizedLabels: [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", Label: "No", LanguageCode: 1033 }] } },
    },
  };
}

function dtCol(schema: string, display: string): any {
  return {
    "@odata.type": "Microsoft.Dynamics.CRM.DateTimeAttributeMetadata",
    SchemaName: schema,
    DisplayName: { "@odata.type": "Microsoft.Dynamics.CRM.Label", LocalizedLabels: [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", Label: display, LanguageCode: 1033 }] },
    RequiredLevel: { Value: "None" },
    AttributeType: "DateTime",
    Format: "DateAndTime",
    DateTimeBehavior: { Value: "UserLocal" },
  };
}

async function provisionTables() {
  console.log("\n[1/3] Provisioning Dataverse tables...\n");

  // ── pm_portfolioholding ──
  await createTable("pm_portfolioholding", "Portfolio Holding", "Portfolio Holdings", "Portfolio holdings for Portfolio Manager agent", "pm_company", "Company");
  const ph = "pm_portfolioholding";
  console.log("  Adding columns to pm_portfolioholding...");
  await addColumn(ph, strCol("pm_ticker", "Ticker", 10));
  await addColumn(ph, strCol("pm_sector", "Sector", 100));
  await addColumn(ph, intCol("pm_shares", "Shares"));
  await addColumn(ph, decCol("pm_costpershare", "Cost Per Share"));
  await addColumn(ph, decCol("pm_totalcost", "Total Cost"));
  await addColumn(ph, intCol("pm_holdingtype", "Holding Type")); // 100000000=Client, 100000001=Prospect
  await addColumn(ph, strCol("pm_website", "Website", 500));
  await addColumn(ph, strCol("pm_mediapress", "Media Press", 500));
  await addColumn(ph, dtCol("pm_reviewedat", "Reviewed At"));
  await addColumn(ph, strCol("pm_currencyexposure", "Currency Exposure", 100));
  await addColumn(ph, boolCol("pm_fxhedged", "FX Hedged"));
  await addColumn(ph, decCol("pm_revenueattributed", "Revenue Attributed"));
  await addColumn(ph, decCol("pm_marginpercent", "Margin Percent"));
  await addColumn(ph, dtCol("pm_lastcompliancecheck", "Last Compliance Check"));
  await addColumn(ph, intCol("pm_compliancestatus", "Compliance Status")); // 0=Compliant, 1=Pending, 2=Flagged, 3=Escalated
  console.log("  ✓ pm_portfolioholding ready\n");

  // ── pm_dealtracker ──
  await createTable("pm_dealtracker", "Deal Tracker", "Deal Trackers", "M&A and deal pipeline tracking", "pm_name", "Deal Name");
  const dt = "pm_dealtracker";
  console.log("  Adding columns to pm_dealtracker...");
  await addColumn(dt, strCol("pm_ticker", "Ticker", 10));
  await addColumn(dt, intCol("pm_dealtype", "Deal Type"));
  await addColumn(dt, intCol("pm_dealstage", "Deal Stage"));
  await addColumn(dt, decCol("pm_estimatedvalue", "Estimated Value"));
  await addColumn(dt, decCol("pm_winprobability", "Win Probability"));
  await addColumn(dt, decCol("pm_revenueforecast", "Revenue Forecast"));
  await addColumn(dt, decCol("pm_marginpercent", "Margin Percent"));
  await addColumn(dt, intCol("pm_compliancestatus", "Compliance Status"));
  await addColumn(dt, intCol("pm_riskrating", "Risk Rating"));
  await addColumn(dt, strCol("pm_exitstrategy", "Exit Strategy", 500));
  await addColumn(dt, strCol("pm_currencyexposure", "Currency Exposure", 200));
  await addColumn(dt, dtCol("pm_nextICdate", "Next IC Date"));
  await addColumn(dt, strCol("pm_boardobserver", "Board Observer", 200));
  await addColumn(dt, strCol("pm_description", "Description", 2000));
  await addColumn(dt, dtCol("pm_lastcompliancereview", "Last Compliance Review"));
  await addColumn(dt, dtCol("pm_estimatedclosedate", "Estimated Close Date"));
  console.log("  ✓ pm_dealtracker ready\n");

  // ── pm_compliancereview ──
  await createTable("pm_compliancereview", "Compliance Review", "Compliance Reviews", "Compliance review log", "pm_ticker", "Ticker");
  const cr = "pm_compliancereview";
  console.log("  Adding columns to pm_compliancereview...");
  await addColumn(cr, strCol("pm_reviewtype", "Review Type", 100));
  await addColumn(cr, intCol("pm_status", "Status"));
  await addColumn(cr, strCol("pm_reviewer", "Reviewer", 200));
  await addColumn(cr, strCol("pm_notes", "Notes", 4000));
  await addColumn(cr, strCol("pm_riskfactors", "Risk Factors", 2000));
  await addColumn(cr, dtCol("pm_reviewdate", "Review Date"));
  await addColumn(cr, dtCol("pm_nextreviewdate", "Next Review Date"));
  console.log("  ✓ pm_compliancereview ready\n");

  // ── pm_revenueforecast ──
  await createTable("pm_revenueforecast", "Revenue Forecast", "Revenue Forecasts", "Revenue forecast snapshots", "pm_ticker", "Ticker");
  const rf = "pm_revenueforecast";
  console.log("  Adding columns to pm_revenueforecast...");
  await addColumn(rf, strCol("pm_period", "Period", 20));
  await addColumn(rf, decCol("pm_forecastrevenue", "Forecast Revenue"));
  await addColumn(rf, decCol("pm_actualrevenue", "Actual Revenue"));
  await addColumn(rf, decCol("pm_variance", "Variance"));
  await addColumn(rf, decCol("pm_walletshare", "Wallet Share"));
  await addColumn(rf, decCol("pm_marginpercent", "Margin Percent"));
  await addColumn(rf, dtCol("pm_forecastdate", "Forecast Date"));
  console.log("  ✓ pm_revenueforecast ready\n");
}

// ═══════════════════════════════════════════════════════════════
// Step 2: Migrate Excel data
// ═══════════════════════════════════════════════════════════════

async function migrateExcelData() {
  console.log("[2/3] Migrating portfolio data from Excel...\n");

  // Read Excel via Graph
  const graphToken = await getGraphToken();
  const excelData = await readExcelViaGraph(graphToken);

  if (!excelData.length) {
    console.log("  ⚠ No Excel data found — skipping migration");
    return;
  }

  console.log(`  Found ${excelData.length} rows in Excel`);

  let created = 0, skipped = 0;
  for (const row of excelData) {
    const ticker = (row.Ticker || "").toUpperCase();
    if (!ticker) continue;

    // Check if already exists
    try {
      const existing = await apiGet(`/pm_portfolioholdings?$filter=pm_ticker eq '${ticker}'&$top=1`);
      if (existing.value?.length > 0) { skipped++; continue; }
    } catch { /* continue */ }

    const shares = parseFloat(row.Shares || "0") || 0;
    try {
      await apiPost("/pm_portfolioholdings", {
        pm_company: row.Company || "",
        pm_ticker: ticker,
        pm_sector: row.Sector || "",
        pm_shares: shares,
        pm_costpershare: parseFloat(row["Cost/Share (USD)"] || "0") || 0,
        pm_totalcost: parseFloat(row["Total Cost (USD)"] || "0") || 0,
        pm_holdingtype: shares > 0 ? 100000000 : 100000001,
        pm_website: row.Website || "",
        pm_mediapress: row["Media/Press Release"] || "",
        pm_compliancestatus: 100000000, // Compliant
      });
      created++;
      console.log(`  ✓ ${ticker} — ${row.Company}`);
    } catch (e) {
      console.error(`  ✗ ${ticker}: ${(e as Error).message.substring(0, 100)}`);
    }
  }

  console.log(`\n  Created: ${created} | Skipped (exists): ${skipped}\n`);
}

async function getGraphToken(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.GRAPH_CLIENT_ID!,
    client_secret: process.env.GRAPH_CLIENT_SECRET!,
    scope: "https://graph.microsoft.com/.default",
  });
  const res = await fetch(`https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

async function readExcelViaGraph(token: string): Promise<Array<Record<string, any>>> {
  const host = process.env.SHAREPOINT_HOST || "";
  const filename = process.env.PORTFOLIO_FILENAME || "AlphaAnalyzer-Portfolio.xlsx";

  // Resolve site → drive → file
  const site = await (await fetch(`https://graph.microsoft.com/v1.0/sites/${host}`, { headers: { Authorization: `Bearer ${token}` } })).json() as any;
  const drives = await (await fetch(`https://graph.microsoft.com/v1.0/sites/${site.id}/drives`, { headers: { Authorization: `Bearer ${token}` } })).json() as any;
  const driveId = drives.value[0]?.id;
  const children = await (await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/root/children`, { headers: { Authorization: `Bearer ${token}` } })).json() as any;
  const file = children.value?.find((f: any) => f.name === filename);
  if (!file) throw new Error(`File ${filename} not found`);

  const worksheet = await (await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${file.id}/workbook/worksheets('Sheet1')/usedRange`, { headers: { Authorization: `Bearer ${token}` } })).json() as any;
  const values = worksheet.values || [];
  const headers = values[0] || [];
  return values.slice(1)
    .filter((row: any[]) => row.some((cell: any) => cell !== "" && cell != null))
    .map((row: any[]) => {
      const obj: Record<string, any> = {};
      headers.forEach((h: string, i: number) => { obj[h] = row[i]; });
      return obj;
    });
}

// ═══════════════════════════════════════════════════════════════
// Step 3: Seed deal tracker + compliance data
// ═══════════════════════════════════════════════════════════════

async function seedDealData() {
  console.log("[3/3] Seeding deal tracker and compliance data...\n");

  const deals = [
    { pm_name: "AstraZeneca Oncology Acquisition", pm_ticker: "AZN", pm_dealtype: 100000000, pm_dealstage: 100000002, pm_estimatedvalue: 15000000, pm_winprobability: 65, pm_revenueforecast: 2500000, pm_marginpercent: 18, pm_compliancestatus: 100000001, pm_riskrating: 100000001, pm_exitstrategy: "Strategic integration — 3-year hold", pm_currencyexposure: "GBP/USD", pm_description: "Bolt-on acquisition target in oncology therapeutics" },
    { pm_name: "BP Energy Transition Fund", pm_ticker: "BP", pm_dealtype: 100000001, pm_dealstage: 100000001, pm_estimatedvalue: 8000000, pm_winprobability: 40, pm_revenueforecast: 1200000, pm_marginpercent: 22, pm_compliancestatus: 100000000, pm_riskrating: 100000002, pm_currencyexposure: "GBP/USD, EUR/USD", pm_description: "Green energy infrastructure capital raise" },
    { pm_name: "NVIDIA AI Infrastructure Exit", pm_ticker: "NVDA", pm_dealtype: 100000004, pm_dealstage: 100000003, pm_estimatedvalue: 25000000, pm_winprobability: 80, pm_revenueforecast: 5000000, pm_marginpercent: 35, pm_compliancestatus: 100000002, pm_riskrating: 100000000, pm_exitstrategy: "Secondary market sale to institutional buyer", pm_description: "Partial exit — lock in gains on AI position" },
    { pm_name: "Microsoft Azure Follow-on", pm_ticker: "MSFT", pm_dealtype: 100000003, pm_dealstage: 100000004, pm_estimatedvalue: 12000000, pm_winprobability: 90, pm_revenueforecast: 3600000, pm_marginpercent: 28, pm_compliancestatus: 100000001, pm_riskrating: 100000000, pm_description: "Follow-on investment in cloud infrastructure" },
    { pm_name: "FNZ FX Hedging Programme", pm_ticker: "FNZ", pm_dealtype: 100000002, pm_dealstage: 100000000, pm_estimatedvalue: 5000000, pm_winprobability: 55, pm_revenueforecast: 750000, pm_marginpercent: 15, pm_compliancestatus: 100000000, pm_riskrating: 100000001, pm_currencyexposure: "GBP/USD, NZD/USD", pm_description: "FX hedging programme for multi-currency exposure" },
  ];

  let dc = 0;
  for (const deal of deals) {
    try {
      // Check if exists
      const existing = await apiGet(`/pm_dealtrackers?$filter=pm_name eq '${encodeURIComponent(deal.pm_name)}'&$top=1`).catch(() => ({ value: [] }));
      if (existing.value?.length > 0) { console.log(`  ≡ ${deal.pm_name} (exists)`); continue; }
      await apiPost("/pm_dealtrackers", deal);
      dc++; console.log(`  ✓ ${deal.pm_name}`);
    } catch (e) { console.error(`  ✗ ${deal.pm_name}: ${(e as Error).message.substring(0, 80)}`); }
  }

  const reviews = [
    { pm_ticker: "NVDA", pm_reviewtype: "Deal Compliance", pm_status: 100000002, pm_reviewer: "Compliance Team", pm_notes: "Position size exceeds single-name concentration limit.", pm_riskfactors: '["Concentration risk","Sector exposure limit"]' },
    { pm_ticker: "BP", pm_reviewtype: "Portfolio Risk", pm_status: 100000000, pm_reviewer: "Risk Management", pm_notes: "Energy sector overweight. Currency exposure unhedged.", pm_riskfactors: '["Sector concentration","FX exposure"]' },
    { pm_ticker: "AZN", pm_reviewtype: "Regulatory Filing", pm_status: 100000001, pm_reviewer: "Legal", pm_notes: "SEC beneficial ownership filing threshold cleared." },
  ];

  let rc = 0;
  for (const review of reviews) {
    try {
      await apiPost("/pm_compliancereviews", review);
      rc++; console.log(`  ✓ ${review.pm_ticker} — ${review.pm_reviewtype}`);
    } catch (e) { console.error(`  ✗ ${review.pm_ticker}: ${(e as Error).message.substring(0, 80)}`); }
  }

  console.log(`\n  Deals: ${dc} | Reviews: ${rc}\n`);
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log("╔═══════════════════════════════════════════════╗");
  console.log("║  Dataverse Provisioning & Data Migration      ║");
  console.log("╚═══════════════════════════════════════════════╝");

  TOKEN = await getToken();
  console.log("✓ Token acquired\n");

  await provisionTables();
  await migrateExcelData();
  await seedDealData();

  console.log("╔═══════════════════════════════════════════════╗");
  console.log("║  Done! Verify with: read-portfolio tool       ║");
  console.log("╚═══════════════════════════════════════════════╝\n");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
