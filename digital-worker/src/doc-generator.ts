// Portfolio Manager Digital Worker — Document Generator
//
// Generates Word (.docx), PowerPoint (.pptx), and Excel (.xlsx) files
// for workflows that need professional document outputs.

import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, AlignmentType, LevelFormat, HeadingLevel, BorderStyle,
  WidthType, ShadingType, PageBreak,
} from 'docx';
import * as ExcelJS from 'exceljs';

// ── Colour palette — Midnight Executive ──
const NAVY = '1E2761';
const ICE = 'CADCFC';
const ACCENT = '4A90D9';
const RED = 'DC2626';
const AMBER = 'D97706';
const GREEN = '16A34A';

// ── Shared helpers ──

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|li|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseSections(text: string): Array<{ heading: string; body: string }> {
  const sections: Array<{ heading: string; body: string }> = [];
  // Split on markdown-style headings or numbered headings like "1. **Market Environment**"
  const parts = text.split(/(?:^|\n)(?:#{1,3}\s+|\d+\.\s+\*{0,2})(.+?)(?:\*{0,2})\s*\n/);
  if (parts.length <= 1) {
    // No headings found — treat whole text as one section
    sections.push({ heading: '', body: text });
    return sections;
  }
  // parts[0] is text before first heading (preamble)
  if (parts[0].trim()) sections.push({ heading: '', body: parts[0].trim() });
  for (let i = 1; i < parts.length; i += 2) {
    const heading = (parts[i] || '').replace(/\*+/g, '').trim();
    const body = (parts[i + 1] || '').trim();
    if (heading) sections.push({ heading, body });
  }
  return sections;
}

const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const cellBorders = { top: border, bottom: border, left: border, right: border };

// ══════════════════════════════════════════════════════════════════════
// 1. MONTHLY COMMENTARY → Word Document
// ══════════════════════════════════════════════════════════════════════

export async function generateCommentaryDocx(
  monthName: string,
  commentary: string,
  holdings: unknown,
  date: Date = new Date(),
): Promise<Buffer> {
  const plain = stripHtml(commentary);
  const sections = parseSections(plain);

  const children: Paragraph[] = [];

  // Title
  children.push(new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text: 'Monthly Fund Commentary', font: 'Arial', size: 36, bold: true, color: NAVY })],
  }));
  children.push(new Paragraph({
    spacing: { after: 400 },
    children: [new TextRun({ text: monthName, font: 'Arial', size: 28, color: '666666' })],
  }));

  // Confidentiality notice
  children.push(new Paragraph({
    spacing: { after: 300 },
    shading: { fill: ICE, type: ShadingType.CLEAR },
    children: [new TextRun({ text: '  DRAFT — For review before client distribution', font: 'Arial', size: 18, italics: true, color: NAVY })],
  }));

  // Sections
  for (const s of sections) {
    if (s.heading) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 150 },
        children: [new TextRun({ text: s.heading, font: 'Arial', size: 28, bold: true, color: NAVY })],
      }));
    }
    // Split body into paragraphs
    for (const para of s.body.split('\n\n').filter(Boolean)) {
      children.push(new Paragraph({
        spacing: { after: 200 },
        children: [new TextRun({ text: para.replace(/\n/g, ' ').trim(), font: 'Arial', size: 22 })],
      }));
    }
  }

  // Footer note
  children.push(new Paragraph({
    spacing: { before: 600 },
    children: [new TextRun({ text: `Generated ${date.toLocaleDateString('en-GB')} by Portfolio Manager Digital Worker`, font: 'Arial', size: 16, color: '999999', italics: true })],
  }));

  const doc = new Document({
    styles: {
      default: { document: { run: { font: 'Arial', size: 22 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 36, bold: true, font: 'Arial', color: NAVY },
          paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 28, bold: true, font: 'Arial', color: NAVY },
          paragraph: { spacing: { before: 180, after: 180 }, outlineLevel: 1 } },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: `Fund Commentary — ${monthName}`, font: 'Arial', size: 16, color: '999999' })],
          })],
        }),
      },
      children,
    }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

// ══════════════════════════════════════════════════════════════════════
// 2. WEEKLY CHALLENGE REPORT → Excel Workbook
// ══════════════════════════════════════════════════════════════════════

export interface ChallengeRow {
  symbol: string;
  company: string;
  pe: number;
  fiveDayReturn: number;
  consensus: string;
  weight: number;
  severity: 'high' | 'medium' | 'low';
  reasons: string[];
  recommendedAction: string;
}

export async function generateChallengeXlsx(
  rows: ChallengeRow[],
  narrative: string,
  date: Date = new Date(),
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Portfolio Manager Digital Worker';
  wb.created = date;

  // ── Sheet 1: Challenge Detail ──
  const ws = wb.addWorksheet('Challenge Report', {
    properties: { defaultColWidth: 14 },
  });

  // Title row
  ws.mergeCells('A1:H1');
  const titleCell = ws.getCell('A1');
  titleCell.value = `Weekly Holdings Challenge — ${date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`;
  titleCell.font = { name: 'Arial', size: 14, bold: true, color: { argb: `FF${NAVY}` } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${ICE}` } };
  titleCell.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 30;

  // Header row
  const headers = ['Ticker', 'Company', 'PE', '5d Return %', 'Consensus', 'Weight %', 'Severity', 'Reasons', 'Action'];
  const headerRow = ws.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${NAVY}` } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF000000' } } };
  });
  ws.getRow(2).height = 24;

  // Data rows
  for (const r of rows) {
    const sevColor = r.severity === 'high' ? RED : r.severity === 'medium' ? AMBER : GREEN;
    const row = ws.addRow([
      r.symbol,
      r.company,
      r.pe,
      r.fiveDayReturn,
      r.consensus,
      r.weight,
      r.severity.toUpperCase(),
      r.reasons.join('; '),
      r.recommendedAction,
    ]);
    row.getCell(3).numFmt = '0.0';
    row.getCell(4).numFmt = '0.0"%"';
    row.getCell(6).numFmt = '0.0"%"';
    row.getCell(7).font = { name: 'Arial', size: 10, bold: true, color: { argb: `FF${sevColor}` } };
    row.eachCell((cell) => {
      cell.font = cell.font || {};
      (cell.font as any).name = (cell.font as any).name || 'Arial';
      (cell.font as any).size = (cell.font as any).size || 10;
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } } };
    });
  }

  // Column widths
  ws.getColumn(1).width = 10;
  ws.getColumn(2).width = 22;
  ws.getColumn(3).width = 8;
  ws.getColumn(4).width = 12;
  ws.getColumn(5).width = 12;
  ws.getColumn(6).width = 10;
  ws.getColumn(7).width = 10;
  ws.getColumn(8).width = 45;
  ws.getColumn(9).width = 15;

  // Auto-filter
  ws.autoFilter = { from: 'A2', to: `I${rows.length + 2}` };

  // Freeze header
  ws.views = [{ state: 'frozen', ySplit: 2 }];

  // ── Sheet 2: Narrative ──
  if (narrative) {
    const ns = wb.addWorksheet('AI Recommendation');
    ns.mergeCells('A1:D1');
    const nTitle = ns.getCell('A1');
    nTitle.value = 'AI Recommendation';
    nTitle.font = { name: 'Arial', size: 14, bold: true, color: { argb: `FF${NAVY}` } };
    ns.getRow(1).height = 28;

    ns.mergeCells('A3:D20');
    const nBody = ns.getCell('A3');
    nBody.value = stripHtml(narrative);
    nBody.font = { name: 'Arial', size: 11 };
    nBody.alignment = { wrapText: true, vertical: 'top' };
    ns.getColumn(1).width = 25;
    ns.getColumn(2).width = 25;
    ns.getColumn(3).width = 25;
    ns.getColumn(4).width = 25;
  }

  const arrayBuf = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuf);
}

// ══════════════════════════════════════════════════════════════════════
// 3. TRADE SIMULATION → Excel Workbook
// ══════════════════════════════════════════════════════════════════════

export interface TradeSimRow {
  ticker: string;
  company: string;
  currentShares: number;
  currentPrice: number;
  currentValue: number;
  currentWeight: number;
  proposedShares: number;
  proposedValue: number;
  proposedWeight: number;
  changeShares: number;
  changeValue: number;
  changeWeight: number;
}

export async function generateTradeSimXlsx(
  trades: TradeSimRow[],
  description: string,
  totalPortfolioValue: number,
  date: Date = new Date(),
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Portfolio Manager Digital Worker';
  wb.created = date;

  const ws = wb.addWorksheet('Trade Simulation', { properties: { defaultColWidth: 14 } });

  // Title
  ws.mergeCells('A1:L1');
  const titleCell = ws.getCell('A1');
  titleCell.value = `Trade Simulation — ${date.toLocaleDateString('en-GB')}`;
  titleCell.font = { name: 'Arial', size: 14, bold: true, color: { argb: `FF${NAVY}` } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${ICE}` } };
  ws.getRow(1).height = 30;

  // Trade description
  ws.mergeCells('A2:L2');
  const descCell = ws.getCell('A2');
  descCell.value = `Request: ${description}`;
  descCell.font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF666666' } };
  ws.getRow(2).height = 20;

  // Headers
  const headers = ['Ticker', 'Company', 'Cur. Shares', 'Price', 'Cur. Value', 'Cur. Wt%',
    'Prop. Shares', 'Prop. Value', 'Prop. Wt%', 'Δ Shares', 'Δ Value', 'Δ Wt%'];
  const headerRow = ws.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${NAVY}` } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  ws.getRow(3).height = 24;

  // Data
  for (const t of trades) {
    const row = ws.addRow([
      t.ticker, t.company, t.currentShares, t.currentPrice, t.currentValue, t.currentWeight,
      t.proposedShares, t.proposedValue, t.proposedWeight,
      t.changeShares, t.changeValue, t.changeWeight,
    ]);
    // Number formats
    [4, 5, 8, 11].forEach(i => { row.getCell(i).numFmt = '$#,##0.00'; });
    [6, 9, 12].forEach(i => { row.getCell(i).numFmt = '0.0"%"'; });
    // Colour negative changes red
    if (t.changeValue < 0) {
      [10, 11, 12].forEach(i => { row.getCell(i).font = { name: 'Arial', size: 10, color: { argb: `FF${RED}` } }; });
    }
    row.eachCell((cell) => {
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } } };
    });
  }

  // Total row
  const lastDataRow = trades.length + 3;
  const totalRow = ws.addRow([
    'TOTAL', '', '', '', `=SUM(E4:E${lastDataRow})`, '',
    '', `=SUM(H4:H${lastDataRow})`, '', '', `=SUM(K4:K${lastDataRow})`, '',
  ]);
  totalRow.font = { name: 'Arial', size: 10, bold: true };
  totalRow.getCell(5).numFmt = '$#,##0.00';
  totalRow.getCell(8).numFmt = '$#,##0.00';
  totalRow.getCell(11).numFmt = '$#,##0.00';

  // Column widths
  ws.getColumn(1).width = 10;
  ws.getColumn(2).width = 22;
  [3, 4, 5, 6, 7, 8, 9, 10, 11, 12].forEach(i => { ws.getColumn(i).width = 13; });

  ws.autoFilter = { from: 'A3', to: `L${lastDataRow}` };
  ws.views = [{ state: 'frozen', ySplit: 3 }];

  const arrayBuf = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuf);
}

// ══════════════════════════════════════════════════════════════════════
// 4. CLIENT MEETING PREP → PowerPoint
// ══════════════════════════════════════════════════════════════════════

export async function generateMeetingPptx(
  clientName: string,
  talkingPoints: string,
  holdings: Array<{ ticker: string; company: string; shares: number; value: number; weight: number; return5d: number }>,
  crmHistory: string,
  date: Date = new Date(),
): Promise<Buffer> {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_16x9';
  pres.author = 'Portfolio Manager Digital Worker';
  pres.title = `Client Meeting — ${clientName}`;

  // ── Slide 1: Title ──
  const s1 = pres.addSlide();
  s1.addShape('rect' as any, { x: 0, y: 0, w: 10, h: 5.625, fill: { color: NAVY } });
  s1.addText(`Client Meeting Prep`, { x: 0.8, y: 1.0, w: 8.4, h: 1.0, fontSize: 40, fontFace: 'Arial', bold: true, color: 'FFFFFF' });
  s1.addText(clientName, { x: 0.8, y: 2.0, w: 8.4, h: 0.8, fontSize: 28, fontFace: 'Arial', color: ICE });
  s1.addText(date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), {
    x: 0.8, y: 3.2, w: 8.4, h: 0.5, fontSize: 16, fontFace: 'Arial', color: 'AAAAAA',
  });
  s1.addText('DRAFT — Prepared by Digital Worker', {
    x: 0.8, y: 4.8, w: 8.4, h: 0.4, fontSize: 10, fontFace: 'Arial', italic: true, color: '888888',
  });

  // ── Slide 2: Portfolio Overview ──
  const s2 = pres.addSlide();
  s2.addText('Portfolio Overview', { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 28, fontFace: 'Arial', bold: true, color: NAVY, margin: 0 });

  const topHoldings = holdings.slice(0, 8);
  const tableRows: any[][] = [
    [
      { text: 'Ticker', options: { bold: true, color: 'FFFFFF', fill: { color: NAVY }, fontSize: 11, fontFace: 'Arial' } },
      { text: 'Company', options: { bold: true, color: 'FFFFFF', fill: { color: NAVY }, fontSize: 11, fontFace: 'Arial' } },
      { text: 'Value', options: { bold: true, color: 'FFFFFF', fill: { color: NAVY }, fontSize: 11, fontFace: 'Arial', align: 'right' } },
      { text: 'Weight', options: { bold: true, color: 'FFFFFF', fill: { color: NAVY }, fontSize: 11, fontFace: 'Arial', align: 'right' } },
      { text: '5d Return', options: { bold: true, color: 'FFFFFF', fill: { color: NAVY }, fontSize: 11, fontFace: 'Arial', align: 'right' } },
    ],
  ];
  for (const h of topHoldings) {
    const retColor = h.return5d >= 0 ? GREEN : RED;
    tableRows.push([
      { text: h.ticker, options: { fontSize: 11, fontFace: 'Arial', bold: true } },
      { text: h.company, options: { fontSize: 10, fontFace: 'Arial' } },
      { text: `$${(h.value / 1000).toFixed(0)}k`, options: { fontSize: 10, fontFace: 'Arial', align: 'right' } },
      { text: `${h.weight.toFixed(1)}%`, options: { fontSize: 10, fontFace: 'Arial', align: 'right' } },
      { text: `${h.return5d >= 0 ? '+' : ''}${h.return5d.toFixed(1)}%`, options: { fontSize: 10, fontFace: 'Arial', align: 'right', color: retColor } },
    ]);
  }
  s2.addTable(tableRows, {
    x: 0.5, y: 1.1, w: 9.0,
    border: { type: 'solid', pt: 0.5, color: 'CCCCCC' },
    colW: [1.2, 2.8, 1.5, 1.2, 1.2],
    rowH: [0.35, ...topHoldings.map(() => 0.3)],
  });

  // ── Slide 3: Talking Points ──
  const s3 = pres.addSlide();
  s3.addText('Key Talking Points', { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 28, fontFace: 'Arial', bold: true, color: NAVY, margin: 0 });

  const points = stripHtml(talkingPoints).split('\n').filter(l => l.trim().length > 2).slice(0, 8);
  const bulletItems = points.map((p, i) => ({
    text: p.replace(/^[-•*\d.]+\s*/, '').trim(),
    options: { bullet: true, breakLine: i < points.length - 1, fontSize: 14, fontFace: 'Arial', color: '333333' },
  }));
  if (bulletItems.length > 0) {
    s3.addText(bulletItems as any, { x: 0.7, y: 1.2, w: 8.6, h: 3.8, valign: 'top', lineSpacingMultiple: 1.4 });
  }

  // ── Slide 4: CRM / Relationship History ──
  const s4 = pres.addSlide();
  s4.addText('Relationship History', { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 28, fontFace: 'Arial', bold: true, color: NAVY, margin: 0 });

  const crmPlain = stripHtml(crmHistory).split('\n').filter(l => l.trim().length > 2).slice(0, 10);
  const crmItems = crmPlain.map((p, i) => ({
    text: p.replace(/^[-•*\d.]+\s*/, '').trim(),
    options: { bullet: true, breakLine: i < crmPlain.length - 1, fontSize: 13, fontFace: 'Arial', color: '333333' },
  }));
  if (crmItems.length > 0) {
    s4.addText(crmItems as any, { x: 0.7, y: 1.2, w: 8.6, h: 3.8, valign: 'top', lineSpacingMultiple: 1.3 });
  }

  // ── Slide 5: Closing ──
  const s5 = pres.addSlide();
  s5.addShape('rect' as any, { x: 0, y: 0, w: 10, h: 5.625, fill: { color: NAVY } });
  s5.addText('Prepared by your Digital Worker', { x: 1, y: 2.0, w: 8, h: 0.8, fontSize: 24, fontFace: 'Arial', color: ICE, align: 'center' });
  s5.addText('Review before use — data may need manual verification', {
    x: 1, y: 3.2, w: 8, h: 0.5, fontSize: 12, fontFace: 'Arial', italic: true, color: '888888', align: 'center',
  });

  const arrayBuf = await pres.write({ outputType: 'nodebuffer' });
  return Buffer.from(arrayBuf as ArrayBuffer);
}

// ══════════════════════════════════════════════════════════════════════
// 5. EARNINGS PREP → PowerPoint
// ══════════════════════════════════════════════════════════════════════

export interface EarningsHolding {
  ticker: string;
  company: string;
  date: string;
  epsEstimate: number | null;
  revenueEstimate: number | null;
  quarter: number;
  currentPrice?: number;
  pe?: number;
  consensus?: string;
}

export async function generateEarningsPptx(
  holdings: EarningsHolding[],
  date: Date = new Date(),
): Promise<Buffer> {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_16x9';
  pres.author = 'Portfolio Manager Digital Worker';
  pres.title = 'Earnings Prep';

  // ── Slide 1: Title ──
  const s1 = pres.addSlide();
  s1.addShape('rect' as any, { x: 0, y: 0, w: 10, h: 5.625, fill: { color: NAVY } });
  s1.addText('Earnings Prep', { x: 0.8, y: 1.2, w: 8.4, h: 1.0, fontSize: 40, fontFace: 'Arial', bold: true, color: 'FFFFFF' });
  s1.addText(`${holdings.length} Holdings Reporting`, { x: 0.8, y: 2.2, w: 8.4, h: 0.8, fontSize: 24, fontFace: 'Arial', color: ICE });
  s1.addText(date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), {
    x: 0.8, y: 3.4, w: 8.4, h: 0.5, fontSize: 16, fontFace: 'Arial', color: 'AAAAAA',
  });

  // ── Slide 2: Overview Table ──
  const s2 = pres.addSlide();
  s2.addText('Upcoming Earnings', { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 28, fontFace: 'Arial', bold: true, color: NAVY, margin: 0 });

  const tableRows: any[][] = [
    [
      { text: 'Ticker', options: { bold: true, color: 'FFFFFF', fill: { color: NAVY }, fontSize: 10, fontFace: 'Arial' } },
      { text: 'Company', options: { bold: true, color: 'FFFFFF', fill: { color: NAVY }, fontSize: 10, fontFace: 'Arial' } },
      { text: 'Date', options: { bold: true, color: 'FFFFFF', fill: { color: NAVY }, fontSize: 10, fontFace: 'Arial' } },
      { text: 'Quarter', options: { bold: true, color: 'FFFFFF', fill: { color: NAVY }, fontSize: 10, fontFace: 'Arial', align: 'center' } },
      { text: 'EPS Est.', options: { bold: true, color: 'FFFFFF', fill: { color: NAVY }, fontSize: 10, fontFace: 'Arial', align: 'right' } },
      { text: 'Rev. Est.', options: { bold: true, color: 'FFFFFF', fill: { color: NAVY }, fontSize: 10, fontFace: 'Arial', align: 'right' } },
    ],
  ];
  for (const h of holdings.slice(0, 10)) {
    const daysUntil = Math.ceil((new Date(h.date).getTime() - Date.now()) / 86400000);
    tableRows.push([
      { text: h.ticker, options: { fontSize: 11, fontFace: 'Arial', bold: true } },
      { text: h.company, options: { fontSize: 10, fontFace: 'Arial' } },
      { text: `${h.date}${daysUntil <= 1 ? ' ⚠️' : ''}`, options: { fontSize: 10, fontFace: 'Arial', color: daysUntil <= 1 ? RED : '333333' } },
      { text: `Q${h.quarter}`, options: { fontSize: 10, fontFace: 'Arial', align: 'center' } },
      { text: h.epsEstimate !== null ? `$${h.epsEstimate.toFixed(2)}` : 'N/A', options: { fontSize: 10, fontFace: 'Arial', align: 'right' } },
      { text: h.revenueEstimate !== null ? `$${(h.revenueEstimate / 1e9).toFixed(2)}B` : 'N/A', options: { fontSize: 10, fontFace: 'Arial', align: 'right' } },
    ]);
  }
  s2.addTable(tableRows, {
    x: 0.5, y: 1.1, w: 9.0,
    border: { type: 'solid', pt: 0.5, color: 'CCCCCC' },
    colW: [1.0, 2.5, 1.5, 1.0, 1.2, 1.5],
    rowH: [0.35, ...holdings.slice(0, 10).map(() => 0.3)],
  });

  // ── Per-holding detail slides (top 5) ──
  for (const h of holdings.slice(0, 5)) {
    const daysUntil = Math.ceil((new Date(h.date).getTime() - Date.now()) / 86400000);
    const slide = pres.addSlide();

    // Header bar
    slide.addShape('rect' as any, { x: 0, y: 0, w: 10, h: 1.0, fill: { color: NAVY } });
    slide.addText(`${h.ticker} — ${h.company}`, { x: 0.5, y: 0.15, w: 7, h: 0.7, fontSize: 24, fontFace: 'Arial', bold: true, color: 'FFFFFF', margin: 0 });
    slide.addText(`Q${h.quarter} Earnings`, { x: 7.5, y: 0.15, w: 2, h: 0.7, fontSize: 14, fontFace: 'Arial', color: ICE, align: 'right', margin: 0 });

    // Key metrics cards
    const metrics = [
      { label: 'Report Date', value: h.date, color: daysUntil <= 1 ? RED : NAVY },
      { label: 'EPS Estimate', value: h.epsEstimate !== null ? `$${h.epsEstimate.toFixed(2)}` : 'N/A', color: NAVY },
      { label: 'Rev. Estimate', value: h.revenueEstimate !== null ? `$${(h.revenueEstimate / 1e9).toFixed(2)}B` : 'N/A', color: NAVY },
      { label: 'Days Until', value: `${daysUntil}d`, color: daysUntil <= 1 ? RED : ACCENT },
    ];

    metrics.forEach((m, i) => {
      const cx = 0.5 + i * 2.3;
      slide.addShape('rect' as any, { x: cx, y: 1.3, w: 2.0, h: 1.2, fill: { color: 'F5F5F5' }, rectRadius: 0.05 });
      slide.addText(m.value, { x: cx, y: 1.4, w: 2.0, h: 0.6, fontSize: 22, fontFace: 'Arial', bold: true, color: m.color, align: 'center', margin: 0 });
      slide.addText(m.label, { x: cx, y: 2.0, w: 2.0, h: 0.4, fontSize: 10, fontFace: 'Arial', color: '999999', align: 'center', margin: 0 });
    });

    // Decision framework
    slide.addText('Decision Framework', { x: 0.5, y: 2.9, w: 9, h: 0.5, fontSize: 18, fontFace: 'Arial', bold: true, color: NAVY, margin: 0 });
    const framework = [
      { text: 'Review current position sizing relative to conviction', options: { bullet: true, breakLine: true, fontSize: 13, fontFace: 'Arial', color: '333333' } },
      { text: 'Check consensus vs whisper number and recent estimate revisions', options: { bullet: true, breakLine: true, fontSize: 13, fontFace: 'Arial', color: '333333' } },
      { text: 'Consider hedging or trimming if large position with binary risk', options: { bullet: true, breakLine: true, fontSize: 13, fontFace: 'Arial', color: '333333' } },
      { text: `Current consensus: ${h.consensus || 'check analyst view'}`, options: { bullet: true, fontSize: 13, fontFace: 'Arial', color: ACCENT } },
    ];
    slide.addText(framework as any, { x: 0.7, y: 3.4, w: 8.6, h: 2.0, valign: 'top', lineSpacingMultiple: 1.3 });
  }

  // ── Closing slide ──
  const sLast = pres.addSlide();
  sLast.addShape('rect' as any, { x: 0, y: 0, w: 10, h: 5.625, fill: { color: NAVY } });
  sLast.addText('Prepared by your Digital Worker', { x: 1, y: 2.0, w: 8, h: 0.8, fontSize: 24, fontFace: 'Arial', color: ICE, align: 'center' });
  sLast.addText('Review position sizing and risk before the print', {
    x: 1, y: 3.2, w: 8, h: 0.5, fontSize: 12, fontFace: 'Arial', italic: true, color: '888888', align: 'center',
  });

  const arrayBuf = await pres.write({ outputType: 'nodebuffer' });
  return Buffer.from(arrayBuf as ArrayBuffer);
}
