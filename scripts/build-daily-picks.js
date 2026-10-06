#!/usr/bin/env node

// Builds a public, read-only daily snapshot from Polymarket's public APIs.
// No wallet connection, signing key, or authenticated API access is used.

const fs = require('node:fs/promises');
const path = require('node:path');

const DATA_API = 'https://data-api.polymarket.com';
const GAMMA_API = 'https://gamma-api.polymarket.com';
const OUTPUT = path.join(__dirname, '..', 'docs', 'daily-picks.json');
const UNIVERSE_SIZE = 1000;
const PAGE_SIZE = 50;
const PROFILE_CONCURRENCY = 10;
const REQUEST_TIMEOUT_MS = 25_000;
const HISTORY_LIMIT = 100;
const POSITIONS_LIMIT = 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function todayInNewYork() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function newYorkMidnightUTC(dateValue) {
  const [year, month, day] = dateValue.split('-').map(Number);
  const assumedUtc = new Date(Date.UTC(year, month - 1, day));
  const offsetText = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'longOffset',
  }).formatToParts(assumedUtc).find((part) => part.type === 'timeZoneName')?.value || 'GMT-05:00';
  const match = offsetText.match(/GMT([+-])(\d{2}):(\d{2})/);
  const offsetMinutes = match ? (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '-' ? -1 : 1) : -300;
  return new Date(assumedUtc.getTime() - offsetMinutes * 60_000);
}

function nextCalendarDate(dateValue) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

async function fetchJSON(base, pathname, params = {}) {
  const url = new URL(pathname, base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (response.ok) return await response.json();

      const body = await response.text();
      const retryable = response.status === 429 || response.status >= 500;
      const error = new Error(`${response.status} ${response.statusText} from ${url.pathname}`);
      error.retryable = retryable;
      if (!retryable || attempt === 4) {
        error.details = body.slice(0, 300);
        throw error;
      }
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 30_000)
        : 500 * (2 ** attempt));
      lastError = error;
    } catch (error) {
      lastError = error;
      if (error.retryable === false || attempt === 4) break;
      await sleep(500 * (2 ** attempt));
    }
  }
  throw lastError || new Error(`Could not fetch ${url}`);
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function loadLeaderboard() {
  const firstPage = await fetchJSON(DATA_API, '/v1/leaderboard', {
    category: 'SPORTS',
    timePeriod: 'ALL',
    orderBy: 'PNL',
    limit: PAGE_SIZE,
    offset: 0,
  });
  const pageCount = Math.ceil(UNIVERSE_SIZE / PAGE_SIZE);
  const remainingOffsets = Array.from({ length: Math.max(0, pageCount - 1) }, (_, i) => (i + 1) * PAGE_SIZE);
  const pages = await mapLimit(remainingOffsets, 4, (offset) => fetchJSON(DATA_API, '/v1/leaderboard', {
    category: 'SPORTS',
    timePeriod: 'ALL',
    orderBy: 'PNL',
    limit: PAGE_SIZE,
    offset,
  }));

  const wallets = new Set();
  return [firstPage, ...pages]
    .flat()
    .filter((row) => row.proxyWallet && !wallets.has(row.proxyWallet.toLowerCase()) && wallets.add(row.proxyWallet.toLowerCase()))
    .slice(0, UNIVERSE_SIZE)
    .map((row, index) => ({
      rank: index + 1,
      wallet: row.proxyWallet,
      name: row.userName || row.xUsername || `${row.proxyWallet.slice(0, 6)}…${row.proxyWallet.slice(-4)}`,
      pnl: Number(row.pnl) || 0,
      volume: Number(row.vol) || 0,
      profileImage: row.profileImage || '',
    }));
}

async function loadSportsCatalog() {
  try {
    const records = await fetchJSON(GAMMA_API, '/sports');
    return Array.isArray(records) ? records : [];
  } catch (error) {
    console.warn(`Sports catalog unavailable; using the built-in league list (${error.message})`);
    return [];
  }
}

async function loadTodaySportsMarkets(slateDate) {
  const start = newYorkMidnightUTC(slateDate);
  const nextStart = newYorkMidnightUTC(nextCalendarDate(slateDate));
  const now = Date.now();
  const marketsByCondition = new Map();
  const limit = 500;

  for (let offset = 0; offset < 10_000; offset += limit) {
    const events = await fetchJSON(GAMMA_API, '/events', {
      tag_id: 1,
      active: true,
      closed: false,
      end_date_min: start.toISOString(),
      end_date_max: new Date(nextStart.getTime() - 1).toISOString(),
      limit,
      offset,
    });
    if (!Array.isArray(events)) break;

    for (const event of events) {
      const eventTime = Date.parse(event.endDate || '');
      if (!event.slug || !Number.isFinite(eventTime) || eventTime <= now) continue;
      for (const market of event.markets || []) {
        if (!market.conditionId || market.closed === true || market.active === false) continue;
        marketsByCondition.set(market.conditionId, {
          title: market.question || market.title || event.title || 'Sports market',
          slug: market.slug || '',
          eventSlug: event.slug,
          endDate: event.endDate,
        });
      }
    }
    if (events.length < limit) break;
  }

  return marketsByCondition;
}

const BUILTIN_SPORT_TERMS = [
  'american football', 'basketball', 'baseball', 'ice hockey', 'hockey', 'soccer',
  'football', 'tennis', 'golf', 'cricket', 'rugby', 'volleyball', 'boxing', 'mma',
  'formula 1', 'formula one', 'nascar', 'esports', 'counter-strike', 'dota',
  'nfl', 'nba', 'wnba', 'mlb', 'nhl', 'ncaaf', 'ncaab', 'cfb', 'cbb', 'mls',
  'atp', 'wta', 'itf', 'ufc', 'pga', 'lpga', 'fifa', 'uefa', 'epl', 'ucl',
  'premier league', 'champions league', 'la liga', 'bundesliga', 'serie a',
  'ligue 1', 'kbo', 'npb', 'nrl', 'afl', 'cfl', 'wncaa', 'ncaa',
];

function makeSportsMatcher(catalog) {
  const codes = new Set();
  const names = new Set(BUILTIN_SPORT_TERMS);
  for (const entry of catalog) {
    const code = String(entry.sport || '').toLowerCase().trim();
    if (/^[a-z0-9-]{2,20}$/.test(code)) codes.add(code);
    const name = String(entry.name || '').toLowerCase().trim();
    if (name.length >= 4) names.add(name);
  }
  const escapedCodes = [...codes].map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const codePattern = escapedCodes.length
    ? new RegExp(`(?:^|[^a-z0-9])(?:${escapedCodes.join('|')})(?:$|[^a-z0-9])`, 'i')
    : null;

  return (position) => {
    const title = String(position.title || '').toLowerCase();
    const slugs = `${position.eventSlug || ''} ${position.slug || ''}`.toLowerCase();
    if (codePattern && codePattern.test(slugs)) return true;
    if (names.has(title)) return true;
    return [...names].some((term) => term.length > 3 && title.includes(term));
  };
}

async function loadTraderData(trader) {
  const params = { user: trader.wallet };
  const [positionsResult, closedResult] = await Promise.allSettled([
    loadAllPositions(params),
    fetchJSON(DATA_API, '/closed-positions', {
      ...params,
      limit: HISTORY_LIMIT,
      sortBy: 'TIMESTAMP',
      sortDirection: 'DESC',
    }),
  ]);

  return {
    ...trader,
    positions: positionsResult.status === 'fulfilled' && Array.isArray(positionsResult.value) ? positionsResult.value : [],
    closed: closedResult.status === 'fulfilled' && Array.isArray(closedResult.value) ? closedResult.value : [],
    positionsFetched: positionsResult.status === 'fulfilled',
    historyFetched: closedResult.status === 'fulfilled',
  };
}

async function loadAllPositions(params) {
  const all = [];
  for (let offset = 0; offset < 5_000; offset += POSITIONS_LIMIT) {
    const page = await fetchJSON(DATA_API, '/positions', {
      ...params,
      limit: POSITIONS_LIMIT,
      offset,
      sizeThreshold: 0.01,
    });
    if (!Array.isArray(page)) break;
    all.push(...page);
    if (page.length < POSITIONS_LIMIT) break;
  }
  return all;
}

function scoreTraders(records, isSportsPosition) {
  const n = records.length;
  const sportsPositions = new Map(records.map((item) => [item.wallet, item.positions
    .filter((position) => !position.redeemable && Number(position.size) > 0 && isSportsPosition(position))]));
  const volumePercentile = percentileRanks(records, (item) => item.volume);
  const activePercentile = percentileRanks(records, (item) => sportsPositions.get(item.wallet).length);

  return records.map((trader) => {
    let wins = 0;
    let losses = 0;
    const settledSports = trader.closed.filter(isSportsPosition);
    for (const item of settledSports) {
      const pnl = Number(item.realizedPnl);
      if (!Number.isFinite(pnl) || pnl === 0) continue;
      if (pnl > 0) wins += 1;
      else losses += 1;
    }
    const settledCount = wins + losses;
    const winRate = settledCount ? 100 * wins / settledCount : null;
    // A 4-result neutral prior prevents tiny samples from dominating the score.
    const adjustedWinRate = 100 * (wins + 2) / (settledCount + 4);
    const profitPercentile = n <= 1 ? 100 : 100 * (n - trader.rank) / (n - 1);
    const volumeRank = volumePercentile.get(trader.wallet) || 0;
    const activityRank = activePercentile.get(trader.wallet) || 0;
    const score = 0.40 * profitPercentile + 0.30 * adjustedWinRate + 0.15 * volumeRank + 0.15 * activityRank;

    const currentPositions = sportsPositions.get(trader.wallet)
      .sort((a, b) => (Number(b.currentValue) || 0) - (Number(a.currentValue) || 0));
    const recentResults = settledSports
      .slice()
      .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
      .slice(0, 5)
      .map((item) => ({
        title: item.title || item.slug || 'Sports market',
        slug: item.slug || '',
        outcome: item.outcome || '',
        realizedPnl: Number(item.realizedPnl) || 0,
        closedAt: item.timestamp ? new Date(Number(item.timestamp) * 1000).toISOString() : null,
      }));

    return {
      rank: trader.rank,
      pnlRank: trader.rank,
      wallet: trader.wallet,
      name: trader.name,
      pnl: trader.pnl,
      volume: trader.volume,
      score: round(score, 1),
      winRate: winRate === null ? null : round(winRate, 1),
      wins,
      losses,
      closedPositionsSampled: settledCount,
      activePositionCount: currentPositions.length,
      profileImage: trader.profileImage,
      activePositions: currentPositions.slice(0, 5).map((item) => positionForFeed(item)),
      recentResults,
      positionsFetched: trader.positionsFetched,
      historyFetched: trader.historyFetched,
      _positions: currentPositions,
    };
  });
}

function percentileRanks(records, metric) {
  const sorted = [...records].sort((a, b) => metric(b) - metric(a));
  const percentiles = new Map();
  for (let start = 0; start < sorted.length;) {
    let end = start;
    while (end + 1 < sorted.length && metric(sorted[end + 1]) === metric(sorted[start])) end += 1;
    const averageIndex = (start + end) / 2;
    const percentile = sorted.length <= 1 ? 100 : 100 * (sorted.length - averageIndex - 1) / (sorted.length - 1);
    for (let index = start; index <= end; index += 1) percentiles.set(sorted[index].wallet, percentile);
    start = end + 1;
  }
  return percentiles;
}

function positionForFeed(item) {
  return {
    conditionId: item.conditionId || '',
    title: item.title || item.slug || 'Sports market',
    slug: item.slug || '',
    eventSlug: item.eventSlug || '',
    outcome: item.outcome || '',
    averagePrice: nullableNumber(item.avgPrice),
    currentPrice: nullableNumber(item.curPrice),
    currentValue: Number(item.currentValue) || 0,
    size: Number(item.size) || 0,
    cashPnl: Number(item.cashPnl) || 0,
    endDate: item.endDate || null,
  };
}

function nullableNumber(value) {
  const number = Number(value);
  return value === null || value === undefined || !Number.isFinite(number) ? null : number;
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function buildPicks(traders, eligibleMarkets) {
  const markets = new Map();
  for (const trader of traders) {
    for (const item of trader._positions) {
      if (item.redeemable || !item.conditionId || !item.outcome) continue;
      const schedule = eligibleMarkets.get(item.conditionId);
      if (!schedule) continue;
      const currentValue = Math.max(0, Number(item.currentValue) || Number(item.size) * Number(item.curPrice) || 0);
      if (currentValue < 2) continue;
      const price = nullableNumber(item.curPrice);
      if (price !== null && (price < 0.02 || price > 0.98)) continue;

      let market = markets.get(item.conditionId);
      if (!market) {
        market = {
          conditionId: item.conditionId,
          title: schedule.title,
          slug: schedule.slug || item.slug || '',
          eventSlug: schedule.eventSlug,
          endDate: schedule.endDate || null,
          sides: new Map(),
        };
        markets.set(item.conditionId, market);
      }
      const sideName = String(item.outcome).trim();
      let side = market.sides.get(sideName);
      if (!side) {
        side = { name: sideName, weight: 0, rawValue: 0, prices: [], wallets: new Map() };
        market.sides.set(sideName, side);
      }
      const weight = (0.50 + trader.score / 200) * Math.log1p(currentValue);
      side.weight += weight;
      side.rawValue += currentValue;
      if (price !== null) side.prices.push({ price, weight });
      side.wallets.set(trader.wallet, {
        name: trader.name,
        score: trader.score,
        wallet: trader.wallet,
        currentValue,
      });
    }
  }

  const candidates = [];
  for (const market of markets.values()) {
    const sides = [...market.sides.values()].sort((a, b) => b.weight - a.weight);
    if (!sides.length) continue;
    const leader = sides[0];
    const totalWeight = sides.reduce((sum, side) => sum + side.weight, 0);
    const consensus = totalWeight ? leader.weight / totalWeight : 0;
    if (leader.wallets.size < 2 || consensus < 0.55) continue;

    const weightedPrice = leader.prices.length
      ? leader.prices.reduce((sum, item) => sum + item.price * item.weight, 0) / leader.prices.reduce((sum, item) => sum + item.weight, 0)
      : null;
    const walletSignals = [...leader.wallets.values()].sort((a, b) => b.score - a.score);
    const meanScore = walletSignals.reduce((sum, item) => sum + item.score, 0) / walletSignals.length;
    const breadth = Math.min(1, Math.log1p(walletSignals.length) / Math.log1p(10));
    const signalScore = 0.55 * meanScore + 35 * consensus + 10 * breadth;
    const eventGroup = market.eventSlug.match(/^(.*20\d{2}-\d{2}-\d{2})/)?.[1] || market.eventSlug || market.slug;
    candidates.push({
      eventGroup,
      conditionId: market.conditionId,
      title: market.title,
      slug: market.slug,
      eventSlug: market.eventSlug,
      outcome: leader.name,
      price: weightedPrice === null ? null : round(weightedPrice, 3),
      score: round(signalScore, 1),
      consensus: round(consensus * 100, 1),
      consensusWallets: walletSignals.length,
      trackedValue: round(leader.rawValue, 2),
      endDate: market.endDate,
      marketURL: `https://polymarket.com/event/${encodeURIComponent(market.eventSlug || market.slug)}`,
      supportingTraders: walletSignals.slice(0, 5).map(({ name, wallet, score }) => ({ name, wallet, score })),
      rationale: `${walletSignals.length} tracked top-1,000 sports wallets hold ${leader.name}; their score-weighted support is ${round(consensus * 100, 1)}%.`,
    });
  }

  candidates.sort((a, b) => b.score - a.score || b.consensusWallets - a.consensusWallets);
  const seenEvents = new Set();
  const picks = [];
  for (const candidate of candidates) {
    const event = candidate.eventGroup;
    if (seenEvents.has(event)) continue;
    seenEvents.add(event);
    const { eventGroup: _eventGroup, ...pick } = candidate;
    picks.push({ rank: picks.length + 1, ...pick });
    if (picks.length === 3) break;
  }
  return picks;
}

async function main() {
  const slateDate = todayInNewYork();
  console.log(`Loading all-time sports leaderboard for ${slateDate} (America/New_York)`);
  const [leaderboard, sportsCatalog, todayMarkets] = await Promise.all([
    loadLeaderboard(),
    loadSportsCatalog(),
    loadTodaySportsMarkets(slateDate),
  ]);
  const sportsMatcher = makeSportsMatcher(sportsCatalog);
  console.log(`Loaded ${leaderboard.length} leaderboard wallets and ${todayMarkets.size} active markets scheduled later today; sampling open and settled positions`);

  const rawProfiles = await mapLimit(leaderboard, PROFILE_CONCURRENCY, async (trader, index) => {
    const record = await loadTraderData(trader);
    if ((index + 1) % 100 === 0 || index + 1 === leaderboard.length) {
      console.log(`Profiled ${index + 1}/${leaderboard.length}`);
    }
    return record;
  });

  const traders = scoreTraders(rawProfiles, sportsMatcher)
    .sort((a, b) => b.score - a.score || a.pnlRank - b.pnlRank)
    .map((trader, index) => ({ ...trader, rank: index + 1 }));
  const picks = buildPicks(traders, todayMarkets);
  const snapshot = {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    slateDate,
    timezone: 'America/New_York',
    universeSize: leaderboard.length,
    tradersWithOpenData: rawProfiles.filter((item) => item.positionsFetched).length,
    tradersWithHistoryData: rawProfiles.filter((item) => item.historyFetched).length,
    methodology: 'Score = 40% all-time sports PnL rank + 30% recent settled win rate with a neutral 4-position prior + 15% sports volume rank + 15% active-position rank. Picks require at least two tracked wallets and 55% score-weighted support.',
    picks,
    traders: traders.map(({ _positions, ...item }) => item),
  };

  await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
  await fs.writeFile(OUTPUT, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Wrote ${OUTPUT}: ${snapshot.traders.length} trader scores, ${picks.length} picks`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
