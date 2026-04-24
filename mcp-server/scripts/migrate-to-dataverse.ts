/**
 * Dataverse Migration Script
 *
 * Migrates portfolio data from AlphaAnalyzer-Portfolio.xlsx (SharePoint)
 * into Dataverse custom tables. Also seeds sample deal tracker and
 * compliance review data.
 *
 * Usage:
 *   npx ts-node scripts/migrate-to-dataverse.ts
 *
 * Or trigger via the MCP tool:
 *   migrate-from-excel(source="excel")
 *
 * Prerequisites:
 *   - Dataverse tables must be created first (see dataverse-schema.json)
 *   - Environment variables: GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, CRM_URL
 */

import { configDotenv } from 'dotenv';
import path from 'path';
configDotenv({ path: path.resolve(__dirname, '..', '.env') });

// Use dynamic imports for ESM modules
async function main() {
  const graph = await import('../src/graph-client.js');
  const dv = await import('../src/dataverse-client.js');

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Portfolio Manager — Dataverse Migration         ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  // ── Step 1: Read Excel data ──
  console.log('[1/4] Reading portfolio from SharePoint Excel...');
  let rows: Array<Record<string, any>> = [];
  try {
    const data = await graph.readWorksheet();
    const values = data.values || [];
    const headers = values[0] || [];
    rows = values.slice(1)
      .filter((row: any[]) => row.some((cell: any) => cell !== '' && cell != null))
      .map((row: any[]) => {
        const obj: Record<string, any> = {};
        headers.forEach((h: string, i: number) => { obj[h] = row[i]; });
        return obj;
      });
    console.log(`  ✓ Found ${rows.length} holdings in Excel\n`);
  } catch (err) {
    console.error('  ✗ Failed to read Excel:', (err as Error).message);
    console.log('  Ensure GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET are set.');
    process.exit(1);
  }

  // ── Step 2: Migrate holdings to Dataverse ──
  console.log('[2/4] Migrating holdings to Dataverse (pm_portfolioholdings)...');
  const result = await dv.migrateFromExcel(rows);
  console.log(`  ✓ Created: ${result.created} holdings`);
  if (result.errors.length > 0) {
    console.log(`  ⚠ Errors: ${result.errors.length}`);
    result.errors.forEach(e => console.log(`    - ${e}`));
  }
  console.log();

  // ── Step 3: Seed sample deal tracker data ──
  console.log('[3/4] Seeding sample deal tracker records...');
  const sampleDeals: Array<Partial<dv.DealRecord>> = [
    {
      pm_name: 'AstraZeneca Oncology Acquisition',
      pm_ticker: 'AZN',
      pm_dealtype: 100000000, // M&A
      pm_dealstage: 100000002, // Due Diligence
      pm_estimatedvalue: 15000000,
      pm_winprobability: 65,
      pm_revenueforecast: 2500000,
      pm_marginpercent: 18,
      pm_compliancestatus: 100000001, // Approved
      pm_riskrating: 100000001, // Medium
      pm_exitstrategy: 'Strategic integration — 3-year hold',
      pm_currencyexposure: 'GBP/USD',
      pm_nextICdate: new Date(Date.now() + 14 * 86400000).toISOString(),
      pm_description: 'Bolt-on acquisition target in oncology therapeutics pipeline',
    },
    {
      pm_name: 'BP Energy Transition Fund',
      pm_ticker: 'BP',
      pm_dealtype: 100000001, // Capital Raise
      pm_dealstage: 100000001, // Qualify
      pm_estimatedvalue: 8000000,
      pm_winprobability: 40,
      pm_revenueforecast: 1200000,
      pm_marginpercent: 22,
      pm_compliancestatus: 100000000, // Pending
      pm_riskrating: 100000002, // High
      pm_currencyexposure: 'GBP/USD, EUR/USD',
      pm_description: 'Green energy infrastructure capital raise',
    },
    {
      pm_name: 'NVIDIA AI Infrastructure Sale',
      pm_ticker: 'NVDA',
      pm_dealtype: 100000004, // Exit
      pm_dealstage: 100000003, // IC Approval
      pm_estimatedvalue: 25000000,
      pm_winprobability: 80,
      pm_revenueforecast: 5000000,
      pm_marginpercent: 35,
      pm_compliancestatus: 100000002, // Flagged
      pm_riskrating: 100000000, // Low
      pm_exitstrategy: 'Secondary market sale to institutional buyer',
      pm_nextICdate: new Date(Date.now() + 7 * 86400000).toISOString(),
      pm_description: 'Partial exit — lock in gains on AI infrastructure position',
    },
    {
      pm_name: 'Microsoft Azure Deal',
      pm_ticker: 'MSFT',
      pm_dealtype: 100000003, // Follow-on
      pm_dealstage: 100000004, // Execution
      pm_estimatedvalue: 12000000,
      pm_winprobability: 90,
      pm_revenueforecast: 3600000,
      pm_marginpercent: 28,
      pm_compliancestatus: 100000001, // Approved
      pm_riskrating: 100000000, // Low
      pm_description: 'Follow-on investment in cloud infrastructure position',
    },
    {
      pm_name: 'FNZ FX Hedging Programme',
      pm_ticker: 'FNZ',
      pm_dealtype: 100000002, // FX Hedging
      pm_dealstage: 100000000, // Origination
      pm_estimatedvalue: 5000000,
      pm_winprobability: 55,
      pm_revenueforecast: 750000,
      pm_marginpercent: 15,
      pm_compliancestatus: 100000000, // Pending
      pm_riskrating: 100000001, // Medium
      pm_currencyexposure: 'GBP/USD, NZD/USD',
      pm_description: 'FX hedging programme for multi-currency exposure',
    },
  ];

  let dealsCreated = 0;
  for (const deal of sampleDeals) {
    try {
      await dv.createDeal(deal);
      dealsCreated++;
      console.log(`  ✓ ${deal.pm_name}`);
    } catch (err) {
      console.log(`  ✗ ${deal.pm_name}: ${(err as Error).message}`);
    }
  }
  console.log(`  Created ${dealsCreated}/${sampleDeals.length} deals\n`);

  // ── Step 4: Seed compliance reviews ──
  console.log('[4/4] Seeding compliance review records...');
  const reviews: Array<Partial<dv.ComplianceReview>> = [
    {
      pm_ticker: 'NVDA',
      pm_reviewtype: 'Deal Compliance',
      pm_status: 100000002, // Flagged
      pm_reviewer: 'Compliance Team',
      pm_notes: 'Position size exceeds single-name concentration limit. Review required before IC.',
      pm_riskfactors: JSON.stringify(['Concentration risk', 'Sector exposure limit', 'Unrealized gain lock-in']),
      pm_reviewdate: new Date().toISOString(),
      pm_nextreviewdate: new Date(Date.now() + 7 * 86400000).toISOString(),
    },
    {
      pm_ticker: 'BP',
      pm_reviewtype: 'Portfolio Risk',
      pm_status: 100000000, // Pending
      pm_reviewer: 'Risk Management',
      pm_notes: 'Energy sector overweight. Currency exposure unhedged on GBP leg.',
      pm_riskfactors: JSON.stringify(['Sector concentration', 'FX exposure', 'Commodity price sensitivity']),
      pm_nextreviewdate: new Date(Date.now() + 14 * 86400000).toISOString(),
    },
    {
      pm_ticker: 'AZN',
      pm_reviewtype: 'Regulatory Filing',
      pm_status: 100000001, // Approved
      pm_reviewer: 'Legal',
      pm_notes: 'SEC beneficial ownership filing threshold cleared. No action required.',
      pm_reviewdate: new Date(Date.now() - 7 * 86400000).toISOString(),
      pm_nextreviewdate: new Date(Date.now() + 90 * 86400000).toISOString(),
    },
  ];

  let reviewsCreated = 0;
  for (const review of reviews) {
    try {
      await dv.createComplianceReview(review);
      reviewsCreated++;
      console.log(`  ✓ ${review.pm_ticker} — ${review.pm_reviewtype}`);
    } catch (err) {
      console.log(`  ✗ ${review.pm_ticker}: ${(err as Error).message}`);
    }
  }
  console.log(`  Created ${reviewsCreated}/${reviews.length} compliance reviews\n`);

  // ── Summary ──
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Migration Summary                               ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  Holdings:   ${result.created} migrated from Excel`);
  console.log(`║  Deals:      ${dealsCreated} seeded`);
  console.log(`║  Compliance: ${reviewsCreated} reviews seeded`);
  console.log(`║  Errors:     ${result.errors.length}`);
  console.log('╚══════════════════════════════════════════════════╝\n');

  if (result.errors.length > 0) {
    console.log('Errors:');
    result.errors.forEach(e => console.log(`  ${e}`));
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
