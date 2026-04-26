/**
 * Portfolio Manager — Monte Carlo Simulation Engine
 * Runs parallel universe simulations of the portfolio under different macro paths.
 * Aggregates outcomes and visualises the cone of outcomes in Mission Control.
 */

// ── Types ──

export interface MacroScenario {
  name: string;
  equityReturn: number;   // Annual return %
  rateChange: number;     // Basis points
  fxMove: number;         // % change vs USD
  creditSpread: number;   // Basis points widening
  probability: number;    // 0-1
}

export interface SimulationConfig {
  scenarios: MacroScenario[];
  numPaths: number;       // Paths per scenario
  horizonDays: number;
  portfolioValue: number;
  holdings: Array<{ ticker: string; weight: number; beta: number; duration?: number }>;
}

export interface SimulationResult {
  simulationId: string;
  config: SimulationConfig;
  outcomes: PathOutcome[];
  statistics: SimulationStatistics;
  durationMs: number;
}

export interface PathOutcome {
  scenarioName: string;
  pathIndex: number;
  finalValue: number;
  returnPct: number;
  maxDrawdown: number;
  dailyReturns: number[];
}

export interface SimulationStatistics {
  meanReturn: number;
  medianReturn: number;
  stdDev: number;
  var95: number;
  var99: number;
  cvar95: number;
  bestCase: number;
  worstCase: number;
  probabilityOfLoss: number;
  scenarioBreakdown: Array<{ scenario: string; meanReturn: number; probability: number }>;
}

// ── Default Scenarios ──

export const DEFAULT_SCENARIOS: MacroScenario[] = [
  { name: 'Base Case', equityReturn: 8, rateChange: 0, fxMove: 0, creditSpread: 0, probability: 0.4 },
  { name: 'Bull Market', equityReturn: 18, rateChange: -50, fxMove: -2, creditSpread: -20, probability: 0.2 },
  { name: 'Mild Recession', equityReturn: -12, rateChange: -100, fxMove: 3, creditSpread: 80, probability: 0.2 },
  { name: 'Stagflation', equityReturn: -8, rateChange: 150, fxMove: 5, creditSpread: 120, probability: 0.1 },
  { name: 'Rate Shock', equityReturn: -15, rateChange: 200, fxMove: -3, creditSpread: 150, probability: 0.05 },
  { name: 'Tail Risk', equityReturn: -35, rateChange: -200, fxMove: 10, creditSpread: 300, probability: 0.05 },
];

// ── Simulation Engine ──

export function runSimulation(config: SimulationConfig): SimulationResult {
  const startTime = Date.now();
  const outcomes: PathOutcome[] = [];

  for (const scenario of config.scenarios) {
    for (let path = 0; path < config.numPaths; path++) {
      const outcome = simulatePath(scenario, config, path);
      outcomes.push(outcome);
    }
  }

  const statistics = computeStatistics(outcomes, config);

  return {
    simulationId: `sim-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    config,
    outcomes,
    statistics,
    durationMs: Date.now() - startTime,
  };
}

function simulatePath(scenario: MacroScenario, config: SimulationConfig, pathIndex: number): PathOutcome {
  const dailyReturn = scenario.equityReturn / 252;
  const dailyVol = Math.abs(scenario.equityReturn) / Math.sqrt(252) * 1.5;
  const dailyReturns: number[] = [];
  let cumReturn = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (let d = 0; d < config.horizonDays; d++) {
    // GBM with scenario drift + random noise
    const noise = gaussianRandom() * dailyVol / 100;
    const dr = dailyReturn / 100 + noise;
    cumReturn = (1 + cumReturn) * (1 + dr) - 1;
    dailyReturns.push(dr * 100);

    if (cumReturn > peak) peak = cumReturn;
    const drawdown = peak > 0 ? (peak - cumReturn) / (1 + peak) : 0;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  // Apply rate sensitivity for fixed-income holdings
  const avgDuration = config.holdings.reduce((s, h) => s + (h.duration || 0) * h.weight, 0);
  const rateImpact = -avgDuration * (scenario.rateChange / 10000);
  cumReturn += rateImpact;

  return {
    scenarioName: scenario.name,
    pathIndex,
    finalValue: config.portfolioValue * (1 + cumReturn),
    returnPct: cumReturn * 100,
    maxDrawdown: maxDrawdown * 100,
    dailyReturns,
  };
}

function computeStatistics(outcomes: PathOutcome[], config: SimulationConfig): SimulationStatistics {
  const returns = outcomes.map(o => o.returnPct).sort((a, b) => a - b);
  const n = returns.length;

  const mean = returns.reduce((s, r) => s + r, 0) / n;
  const median = n % 2 === 0 ? (returns[n / 2 - 1] + returns[n / 2]) / 2 : returns[Math.floor(n / 2)];
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);

  const var95 = returns[Math.floor(n * 0.05)];
  const var99 = returns[Math.floor(n * 0.01)];
  const cvar95Returns = returns.slice(0, Math.floor(n * 0.05));
  const cvar95 = cvar95Returns.length > 0 ? cvar95Returns.reduce((s, r) => s + r, 0) / cvar95Returns.length : var95;

  const scenarioBreakdown = config.scenarios.map(s => {
    const scenReturns = outcomes.filter(o => o.scenarioName === s.name).map(o => o.returnPct);
    return {
      scenario: s.name,
      meanReturn: scenReturns.reduce((sum, r) => sum + r, 0) / scenReturns.length,
      probability: s.probability,
    };
  });

  return {
    meanReturn: mean,
    medianReturn: median,
    stdDev,
    var95,
    var99,
    cvar95,
    bestCase: returns[n - 1],
    worstCase: returns[0],
    probabilityOfLoss: returns.filter(r => r < 0).length / n,
    scenarioBreakdown,
  };
}

function gaussianRandom(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}
