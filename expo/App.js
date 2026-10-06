import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  FlatList,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

const FEED_URL = 'https://raw.githubusercontent.com/coopermsick-67/poly-ios/main/docs/daily-picks.json';
const DATA_API = 'https://data-api.polymarket.com';
const GAMMA_API = 'https://gamma-api.polymarket.com';
const CUSTOM_LIST_LIMIT = 2000;
const LEADERBOARD_PAGE_SIZE = 50;
const PROFILE_CONCURRENCY = 8;
const POSITION_PAGE_SIZE = 500;
const MAX_POSITION_SAMPLE = 5000;
const CLOSED_SAMPLE_SIZE = 100;
const SPORT_TERMS = [
  'american football', 'basketball', 'baseball', 'ice hockey', 'hockey', 'soccer', 'football',
  'tennis', 'golf', 'cricket', 'rugby', 'volleyball', 'boxing', 'mma', 'formula 1', 'formula one',
  'nascar', 'esports', 'counter-strike', 'dota', 'nfl', 'nba', 'wnba', 'mlb', 'nhl', 'ncaaf',
  'ncaab', 'cfb', 'cbb', 'mls', 'atp', 'wta', 'itf', 'ufc', 'pga', 'lpga', 'fifa', 'uefa',
  'epl', 'ucl', 'premier league', 'champions league', 'la liga', 'bundesliga', 'serie a', 'ligue 1',
  'kbo', 'npb', 'nrl', 'afl', 'cfl', 'wncaa', 'ncaa',
];

const C = {
  background: '#091017',
  surface: '#131d25',
  raised: '#1b2730',
  lime: '#bffa59',
  mint: '#5ce0b3',
  muted: '#94a3ad',
  line: 'rgba(255,255,255,0.09)',
  loss: '#ff6e67',
  white: '#ffffff',
};

const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

function money(value) {
  const amount = number(value);
  const absolute = Math.abs(amount);
  const sign = amount < 0 ? '−' : '';
  if (absolute >= 1_000_000_000) return `${sign}$${(absolute / 1_000_000_000).toFixed(1)}B`;
  if (absolute >= 1_000_000) return `${sign}$${(absolute / 1_000_000).toFixed(1)}M`;
  if (absolute >= 10_000) return `${sign}$${(absolute / 1_000).toFixed(0)}K`;
  return `${sign}$${Math.round(absolute).toLocaleString('en-US')}`;
}

function percent(value) {
  return value === null || value === undefined || !Number.isFinite(Number(value))
    ? '—'
    : `${Math.round(Number(value))}%`;
}

function currentSlateDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateLabel(value, options = { weekday: 'long', month: 'short', day: 'numeric' }) {
  if (!value) return 'Recent';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    ...options,
  }).format(date);
}

function initials(value) {
  const words = String(value || '?').trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase() || '?';
}

function parseWalletText(text) {
  const wallets = [];
  const seen = new Set();
  let invalidLines = 0;
  let duplicateWallets = 0;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/0x[a-fA-F0-9]{40}/);
    if (!match) {
      invalidLines += 1;
      continue;
    }
    const wallet = match[0];
    const key = wallet.toLowerCase();
    if (seen.has(key)) {
      duplicateWallets += 1;
      continue;
    }
    seen.add(key);
    const name = line.replace(match[0], '').replace(/^[\s,;|]+|[\s,;|]+$/g, '').trim();
    wallets.push({ wallet, name: name || (wallet.slice(0, 6) + '…' + wallet.slice(-4)) });
  }
  if (!wallets.length) throw new Error('No valid 0x Ethereum wallet addresses were found. Put one address on each line.');
  if (wallets.length > CUSTOM_LIST_LIMIT) {
    throw new Error('This list has ' + wallets.length.toLocaleString() + ' unique wallets. The on-phone scanner is capped at ' + CUSTOM_LIST_LIMIT.toLocaleString() + ' per run.');
  }
  return { wallets, invalidLines, duplicateWallets };
}

function waitForRetry(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(new Error('Scan cancelled.'));
      return;
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Scan cancelled.'));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function fetchJSON(base, pathname, params, signal) {
  const url = new URL(pathname, base);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  });
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(url.toString(), {
        signal,
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (response.ok) return response.json();
      const issue = new Error(response.status + ' ' + response.statusText + ' from ' + url.pathname);
      issue.retryable = response.status === 429 || response.status >= 500;
      if (issue.retryable && attempt < 4) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const delay = retryAfter > 0 ? Math.min(retryAfter * 1000, 30000) : 400 * (2 ** attempt);
        await waitForRetry(delay, signal);
        lastError = issue;
        continue;
      }
      throw issue;
    } catch (issue) {
      if (signal && signal.aborted) throw new Error('Scan cancelled.');
      lastError = issue;
      if (issue.retryable === false || attempt === 4) throw issue;
      await waitForRetry(400 * (2 ** attempt), signal);
    }
  }
  throw lastError || new Error('Could not fetch ' + url.pathname + '.');
}

async function mapLimit(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
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

async function loadListLeaderboard(signal, onProgress) {
  const pageCount = Math.ceil(CUSTOM_LIST_LIMIT / LEADERBOARD_PAGE_SIZE);
  const offsets = Array.from({ length: pageCount }, (_, index) => index * LEADERBOARD_PAGE_SIZE);
  let completed = 0;
  const pages = await mapLimit(offsets, 4, async (offset) => {
    const page = await fetchJSON(DATA_API, '/v1/leaderboard', {
      category: 'SPORTS',
      timePeriod: 'ALL',
      orderBy: 'PNL',
      limit: LEADERBOARD_PAGE_SIZE,
      offset,
    }, signal);
    completed += 1;
    onProgress?.({ phase: 'Loading official SPORTS leaderboard', done: completed, total: pageCount });
    return Array.isArray(page) ? page : [];
  });
  const byWallet = new Map();
  pages.flat().forEach((row, index) => {
    if (!row.proxyWallet) return;
    const wallet = row.proxyWallet.toLowerCase();
    if (!byWallet.has(wallet)) {
      byWallet.set(wallet, {
        rank: index + 1,
        pnl: number(row.pnl),
        volume: number(row.vol),
        name: row.userName || row.xUsername || '',
        profileImage: row.profileImage || '',
      });
    }
  });
  return byWallet;
}

function buildSportsMatcher(catalog) {
  const names = new Set(SPORT_TERMS);
  const codes = new Set();
  (Array.isArray(catalog) ? catalog : []).forEach((entry) => {
    const sport = String(entry.sport || '').toLowerCase().trim();
    const name = String(entry.name || '').toLowerCase().trim();
    if (/^[a-z0-9-]{2,20}$/.test(sport)) codes.add(sport);
    if (name.length >= 4) names.add(name);
  });
  return (position) => {
    const title = String(position.title || '').toLowerCase();
    const slugParts = (String(position.eventSlug || '') + ' ' + String(position.slug || ''))
      .toLowerCase().split(/[^a-z0-9-]+/);
    if (slugParts.some((part) => codes.has(part))) return true;
    for (const term of names) if (term.length > 3 && title.includes(term)) return true;
    return false;
  };
}

async function loadTodayMarkets(signal) {
  const slateDate = currentSlateDate();
  const start = newYorkMidnightUTC(slateDate);
  const nextStart = newYorkMidnightUTC(nextSlateDate(slateDate));
  const byCondition = new Map();
  const limit = 500;
  for (let offset = 0; offset < 10000; offset += limit) {
    const events = await fetchJSON(GAMMA_API, '/events', {
      tag_id: 1,
      active: true,
      closed: false,
      end_date_min: start.toISOString(),
      end_date_max: new Date(nextStart.getTime() - 1).toISOString(),
      limit,
      offset,
    }, signal);
    if (!Array.isArray(events)) break;
    const now = Date.now();
    for (const event of events) {
      const eventTime = Date.parse(event.endDate || '');
      if (!event.slug || !Number.isFinite(eventTime) || eventTime <= now) continue;
      for (const market of event.markets || []) {
        if (!market.conditionId || market.closed === true || market.active === false) continue;
        byCondition.set(market.conditionId, {
          title: market.question || market.title || event.title || 'Sports market',
          slug: market.slug || '',
          eventSlug: event.slug,
          endDate: event.endDate,
        });
      }
    }
    if (events.length < limit) break;
  }
  return byCondition;
}

function newYorkMidnightUTC(dateValue) {
  const parts = dateValue.split('-').map(Number);
  const assumedUtc = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  const offsetText = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'longOffset',
  }).formatToParts(assumedUtc).find((part) => part.type === 'timeZoneName')?.value || 'GMT-05:00';
  const match = offsetText.match(/GMT([+-])(\d{2}):(\d{2})/);
  const offsetMinutes = match ? (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '-' ? -1 : 1) : -300;
  return new Date(assumedUtc.getTime() - offsetMinutes * 60000);
}

function nextSlateDate(dateValue) {
  const date = new Date(dateValue + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

async function loadAllPositions(wallet, signal) {
  const all = [];
  for (let offset = 0; offset < MAX_POSITION_SAMPLE; offset += POSITION_PAGE_SIZE) {
    const page = await fetchJSON(DATA_API, '/positions', {
      user: wallet,
      limit: POSITION_PAGE_SIZE,
      offset,
      sizeThreshold: 0.01,
    }, signal);
    if (!Array.isArray(page)) break;
    all.push(...page);
    if (page.length < POSITION_PAGE_SIZE) break;
  }
  return all;
}

async function loadWalletProfile(wallet, signal) {
  const [positionsResult, historyResult] = await Promise.allSettled([
    loadAllPositions(wallet.wallet, signal),
    fetchJSON(DATA_API, '/closed-positions', {
      user: wallet.wallet,
      limit: CLOSED_SAMPLE_SIZE,
      sortBy: 'TIMESTAMP',
      sortDirection: 'DESC',
    }, signal),
  ]);
  const positions = positionsResult.status === 'fulfilled' ? positionsResult.value : [];
  const closed = historyResult.status === 'fulfilled' && Array.isArray(historyResult.value) ? historyResult.value : [];
  return {
    ...wallet,
    positions,
    closed,
    positionsFetched: positionsResult.status === 'fulfilled',
    historyFetched: historyResult.status === 'fulfilled' && Array.isArray(historyResult.value),
    positionsCapped: positions.length >= MAX_POSITION_SAMPLE,
  };
}

function percentileRanks(records, metric) {
  const sorted = [...records].sort((a, b) => metric(b) - metric(a));
  const ranks = new Map();
  for (let start = 0; start < sorted.length;) {
    let end = start;
    while (end + 1 < sorted.length && metric(sorted[end + 1]) === metric(sorted[start])) end += 1;
    const averageIndex = (start + end) / 2;
    const percentileValue = sorted.length <= 1 ? 100 : 100 * (sorted.length - averageIndex - 1) / (sorted.length - 1);
    for (let index = start; index <= end; index += 1) ranks.set(sorted[index].wallet.toLowerCase(), percentileValue);
    start = end + 1;
  }
  return ranks;
}

function scoreWalletProfiles(profiles, leaderboard, isSportsPosition) {
  const drafts = profiles.map((trader) => {
    const activeSports = trader.positions.filter((position) => !position.redeemable && number(position.size) > 0 && isSportsPosition(position));
    const closedSports = trader.closed.filter(isSportsPosition);
    const official = leaderboard.get(trader.wallet.toLowerCase());
    const estimatedPnl = closedSports.reduce((sum, item) => sum + number(item.realizedPnl), 0)
      + activeSports.reduce((sum, item) => sum + number(item.cashPnl), 0);
    const estimatedVolume = closedSports.reduce((sum, item) => sum + Math.abs(number(item.size) * number(item.avgPrice)), 0)
      + activeSports.reduce((sum, item) => sum + Math.abs(number(item.initialValue) || number(item.size) * number(item.avgPrice)), 0);
    let wins = 0;
    let losses = 0;
    closedSports.forEach((item) => {
      const result = Number(item.realizedPnl);
      if (!Number.isFinite(result) || result === 0) return;
      if (result > 0) wins += 1;
      else losses += 1;
    });
    const settledCount = wins + losses;
    return {
      ...trader,
      _activeSports: activeSports,
      _closedSports: closedSports,
      _pnl: official ? official.pnl : estimatedPnl,
      _volume: official ? official.volume : estimatedVolume,
      _official: Boolean(official),
      _wins: wins,
      _losses: losses,
      _settledCount: settledCount,
      _winRate: settledCount ? 100 * wins / settledCount : null,
      _adjustedWinRate: 100 * (wins + 2) / (settledCount + 4),
    };
  });
  const pnlPercentiles = percentileRanks(drafts, (item) => item._pnl);
  const volumePercentiles = percentileRanks(drafts, (item) => item._volume);
  const activePercentiles = percentileRanks(drafts, (item) => item._activeSports.length);
  const byPnl = [...drafts].sort((a, b) => b._pnl - a._pnl);
  const pnlRanks = new Map(byPnl.map((item, index) => [item.wallet.toLowerCase(), index + 1]));
  return drafts.map((trader) => {
    const key = trader.wallet.toLowerCase();
    const score = 0.40 * (pnlPercentiles.get(key) || 0)
      + 0.30 * trader._adjustedWinRate
      + 0.15 * (volumePercentiles.get(key) || 0)
      + 0.15 * (activePercentiles.get(key) || 0);
    const activePositions = [...trader._activeSports]
      .sort((a, b) => number(b.currentValue) - number(a.currentValue))
      .slice(0, 5)
      .map((item) => ({
        conditionId: item.conditionId || '',
        title: item.title || item.slug || 'Sports market',
        slug: item.slug || '',
        eventSlug: item.eventSlug || '',
        outcome: item.outcome || '',
        averagePrice: item.avgPrice === undefined ? null : number(item.avgPrice),
        currentPrice: item.curPrice === undefined ? null : number(item.curPrice),
        currentValue: number(item.currentValue),
        size: number(item.size),
        cashPnl: number(item.cashPnl),
        endDate: item.endDate || null,
      }));
    const recentResults = [...trader._closedSports]
      .sort((a, b) => number(b.timestamp) - number(a.timestamp))
      .slice(0, 5)
      .map((item) => ({
        title: item.title || item.slug || 'Sports market',
        slug: item.slug || '',
        outcome: item.outcome || '',
        realizedPnl: number(item.realizedPnl),
        closedAt: item.timestamp ? new Date(number(item.timestamp) * 1000).toISOString() : null,
      }));
    return {
      rank: 0,
      pnlRank: pnlRanks.get(key) || 0,
      wallet: trader.wallet,
      name: trader.name || trader.leaderboardName || (trader.wallet.slice(0, 6) + '…' + trader.wallet.slice(-4)),
      pnl: trader._pnl,
      volume: trader._volume,
      score: Math.round(score * 10) / 10,
      winRate: trader._winRate === null ? null : Math.round(trader._winRate * 10) / 10,
      wins: trader._wins,
      losses: trader._losses,
      closedPositionsSampled: trader._settledCount,
      activePositionCount: trader._activeSports.length,
      profileImage: trader.profileImage || trader.leaderboardImage || '',
      activePositions,
      recentResults,
      positionsFetched: trader.positionsFetched,
      historyFetched: trader.historyFetched,
      leaderboardMatched: trader._official,
      pnlIsEstimated: !trader._official,
      positionsCapped: trader.positionsCapped,
      _positions: trader._activeSports,
    };
  }).sort((a, b) => b.score - a.score || a.pnlRank - b.pnlRank)
    .map((trader, index) => ({ ...trader, rank: index + 1 }));
}

function buildConsensusPicks(traders, eligibleMarkets) {
  const markets = new Map();
  for (const trader of traders) {
    for (const position of trader._positions) {
      if (position.redeemable || !position.conditionId || !position.outcome) continue;
      const schedule = eligibleMarkets.get(position.conditionId);
      if (!schedule) continue;
      const value = Math.max(0, number(position.currentValue) || number(position.size) * number(position.curPrice));
      const price = position.curPrice === null || position.curPrice === undefined ? null : number(position.curPrice);
      if (value < 2 || (price !== null && (price < 0.02 || price > 0.98))) continue;
      if (!markets.has(position.conditionId)) {
        markets.set(position.conditionId, { ...schedule, conditionId: position.conditionId, sides: new Map() });
      }
      const market = markets.get(position.conditionId);
      const sideName = String(position.outcome).trim();
      if (!market.sides.has(sideName)) market.sides.set(sideName, { name: sideName, weight: 0, rawValue: 0, prices: [], wallets: new Map() });
      const side = market.sides.get(sideName);
      const weight = (0.5 + trader.score / 200) * Math.log1p(value);
      side.weight += weight;
      side.rawValue += value;
      if (price !== null) side.prices.push({ price, weight });
      side.wallets.set(trader.wallet.toLowerCase(), { name: trader.name, wallet: trader.wallet, score: trader.score });
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
    const priceWeight = leader.prices.reduce((sum, item) => sum + item.weight, 0);
    const averagePrice = priceWeight ? leader.prices.reduce((sum, item) => sum + item.price * item.weight, 0) / priceWeight : null;
    const supporters = [...leader.wallets.values()].sort((a, b) => b.score - a.score);
    const meanScore = supporters.reduce((sum, item) => sum + item.score, 0) / supporters.length;
    const breadth = Math.min(1, Math.log1p(supporters.length) / Math.log1p(10));
    const eventGroup = market.eventSlug?.match(/^(.*20\d{2}-\d{2}-\d{2})/)?.[1] || market.eventSlug || market.slug;
    const consensusPercent = Math.round(consensus * 1000) / 10;
    candidates.push({
      eventGroup,
      conditionId: market.conditionId,
      title: market.title,
      slug: market.slug,
      eventSlug: market.eventSlug,
      outcome: leader.name,
      price: averagePrice === null ? null : Math.round(averagePrice * 1000) / 1000,
      score: Math.round((0.55 * meanScore + 35 * consensus + 10 * breadth) * 10) / 10,
      consensus: consensusPercent,
      consensusWallets: supporters.length,
      trackedValue: Math.round(leader.rawValue * 100) / 100,
      endDate: market.endDate || null,
      marketURL: 'https://polymarket.com/event/' + encodeURIComponent(market.eventSlug || market.slug),
      supportingTraders: supporters.slice(0, 5).map(({ name, wallet, score }) => ({ name, wallet, score })),
      rationale: supporters.length + ' wallets from the uploaded list hold ' + leader.name + '; score-weighted support is ' + consensusPercent + '%.',
    });
  }
  candidates.sort((a, b) => b.score - a.score || b.consensusWallets - a.consensusWallets);
  const seen = new Set();
  const picks = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.eventGroup)) continue;
    seen.add(candidate.eventGroup);
    const { eventGroup, ...pick } = candidate;
    picks.push({ rank: picks.length + 1, ...pick });
    if (picks.length === 3) break;
  }
  return picks;
}

async function analyzeWalletList(wallets, signal, onProgress) {
  onProgress?.({ phase: 'Loading official SPORTS leaderboard', done: 0, total: Math.ceil(CUSTOM_LIST_LIMIT / LEADERBOARD_PAGE_SIZE) });
  const [leaderboard, sportsCatalog, marketResult] = await Promise.all([
    loadListLeaderboard(signal, onProgress),
    fetchJSON(GAMMA_API, '/sports', {}, signal).catch(() => []),
    loadTodayMarkets(signal)
      .then((markets) => ({ markets, error: '' }))
      .catch((issue) => {
        if (signal && signal.aborted) throw new Error('Scan cancelled.');
        return { markets: new Map(), error: issue?.message || 'The sports schedule could not be loaded.' };
      }),
  ]);
  const eligibleMarkets = marketResult.markets;
  const matchedWallets = wallets.filter((item) => leaderboard.has(item.wallet.toLowerCase())).length;
  const isSportsPosition = buildSportsMatcher(sportsCatalog);
  let completed = 0;
  let failures = 0;
  onProgress?.({ phase: 'Analyzing positions and settled history', done: 0, total: wallets.length, failures, matched: matchedWallets });
  const profiles = await mapLimit(wallets, PROFILE_CONCURRENCY, async (wallet) => {
    const official = leaderboard.get(wallet.wallet.toLowerCase());
    let profile;
    try {
      profile = await loadWalletProfile({
        ...wallet,
        leaderboardName: official?.name,
        leaderboardImage: official?.profileImage,
      }, signal);
      if (signal && signal.aborted) throw new Error('Scan cancelled.');
    } catch (issue) {
      if (signal && signal.aborted) throw new Error('Scan cancelled.');
      profile = { ...wallet, positions: [], closed: [], positionsFetched: false, historyFetched: false, positionsCapped: false };
    }
    if (!profile.positionsFetched || !profile.historyFetched) failures += 1;
    completed += 1;
    if (completed % 10 === 0 || completed === wallets.length) {
      onProgress?.({ phase: 'Analyzing positions and settled history', done: completed, total: wallets.length, failures, matched: matchedWallets });
    }
    return profile;
  });
  const traders = scoreWalletProfiles(profiles, leaderboard, isSportsPosition);
  const picks = buildConsensusPicks(traders, eligibleMarkets);
  return {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    slateDate: currentSlateDate(),
    timezone: 'America/New_York',
    universeSize: wallets.length,
    tradersWithOpenData: profiles.filter((item) => item.positionsFetched).length,
    tradersWithHistoryData: profiles.filter((item) => item.historyFetched).length,
    leaderboardMatched: matchedWallets,
    profilesWithPartialData: failures,
    positionsCapped: profiles.filter((item) => item.positionsCapped).length,
    marketDataError: marketResult.error,
    methodology: 'Custom scan score = 40% PnL rank + 30% recent sports win rate with a neutral 4-result prior + 15% volume rank + 15% open sports-position rank. Official PnL and volume are used where a wallet appears in the top 2,000 all-time SPORTS leaderboard. Other wallets use estimates from returned positions and their latest 100 closed positions. Picks require at least two wallets and 55% score-weighted support.',
    picks,
    traders: traders.map(({ _positions, ...item }) => item),
  };
}

function App() {
  const [tab, setTab] = useState('today');
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [feedURL, setFeedURL] = useState(FEED_URL);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState(FEED_URL);
  const [search, setSearch] = useState('');
  const [selectedTrader, setSelectedTrader] = useState(null);
  const [walletList, setWalletList] = useState([]);
  const [importInfo, setImportInfo] = useState(null);
  const [scanProgress, setScanProgress] = useState(null);
  const [scanError, setScanError] = useState('');
  const [scanRunning, setScanRunning] = useState(false);
  const [customAnalysis, setCustomAnalysis] = useState(null);
  const scanController = useRef(null);

  const loadSnapshot = useCallback(async () => {
    setLoading(true);
    setRefreshing(true);
    setError('');
    try {
      const response = await fetch(feedURL, {
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!response.ok) throw new Error(`The feed returned HTTP ${response.status}.`);
      const payload = await response.json();
      if (payload.formatVersion !== 1 || !Array.isArray(payload.picks) || !Array.isArray(payload.traders)) {
        throw new Error('The feed format is not supported by this version of Signal Slate.');
      }
      setSnapshot(payload);
    } catch (fetchError) {
      setError(fetchError?.message || 'The daily feed could not be loaded.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [feedURL]);

  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot]);

  const importWalletFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'text/plain',
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets && result.assets[0];
      if (!asset) throw new Error('The selected file could not be read.');
      if (asset.size && asset.size > 2_000_000) throw new Error('Choose a TXT file smaller than 2 MB.');
      const contents = await new File(asset.uri).text();
      const parsed = parseWalletText(contents);
      setWalletList(parsed.wallets);
      setImportInfo({
        fileName: asset.name || 'Trader list.txt',
        count: parsed.wallets.length,
        invalidLines: parsed.invalidLines,
        duplicateWallets: parsed.duplicateWallets,
      });
      setCustomAnalysis(null);
      setScanProgress(null);
      setScanError('');
      setTab('traders');
    } catch (issue) {
      Alert.alert('Could not import TXT file', issue?.message || 'Choose a plain text file containing one wallet address per line.');
    }
  };

  const startWalletScan = async () => {
    if (!walletList.length || scanRunning) return;
    const controller = new AbortController();
    scanController.current = controller;
    setScanRunning(true);
    setScanError('');
    setCustomAnalysis(null);
    setScanProgress({ phase: 'Preparing wallet scan', done: 0, total: walletList.length });
    try {
      const result = await analyzeWalletList(walletList, controller.signal, setScanProgress);
      setCustomAnalysis(result);
      setSearch('');
      setScanProgress({
        phase: 'Analysis complete',
        done: walletList.length,
        total: walletList.length,
        matched: result.leaderboardMatched,
        failures: result.profilesWithPartialData,
        complete: true,
      });
    } catch (issue) {
      setScanError(controller.signal.aborted ? 'Scan cancelled. You can restart it when ready.' : (issue?.message || 'The wallet scan failed.'));
    } finally {
      scanController.current = null;
      setScanRunning(false);
    }
  };

  const cancelWalletScan = () => scanController.current?.abort();

  const activeSnapshot = customAnalysis || snapshot;
  const traders = useMemo(() => {
    const all = activeSnapshot?.traders || [];
    const query = search.trim().toLocaleLowerCase();
    if (!query) return all;
    return all.filter((trader) =>
      `${trader.name || ''} ${trader.wallet || ''}`.toLocaleLowerCase().includes(query),
    );
  }, [activeSnapshot, search]);

  const slateIsCurrent = activeSnapshot?.slateDate === currentSlateDate();

  return (
    <SafeAreaView style={styles.app}>
      <StatusBar barStyle="light-content" backgroundColor={C.background} />
      {tab === 'traders' ? (
        <FlatList
          data={traders}
          keyExtractor={(item) => item.wallet || String(item.rank)}
          renderItem={({ item }) => <TraderRow trader={item} onPress={() => setSelectedTrader(item)} />}
          ListHeaderComponent={(
            <View style={styles.listHeader}>
              <HeaderBlock
                eyebrow={customAnalysis ? 'CUSTOM WALLET SCAN' : 'WALLET PERFORMANCE'}
                title="Trader board"
                subtitle={customAnalysis
                  ? 'Ranked from your imported sports trader list.'
                  : 'The highest-scoring wallets from the all-time sports leaderboard.'}
              />
              <View style={styles.uploadPanel}>
                <Text style={styles.uploadTitle}>Analyze your trader list</Text>
                <Text style={styles.bodyMuted}>Import a plain TXT file with one 0x wallet address per line. Up to 2,000 unique wallets. The file stays on this phone; only wallet addresses are queried against Polymarket’s public APIs.</Text>
                <PrimaryButton title={importInfo ? 'Choose another TXT file' : 'Import trader list (.txt)'} onPress={importWalletFile} />
                {importInfo ? (
                  <View style={styles.importSummary}>
                    <Text style={styles.importName}>{importInfo.fileName}</Text>
                    <Text style={styles.bodyMuted}>
                      {importInfo.count.toLocaleString()} wallets ready
                      {importInfo.duplicateWallets ? ' · ' + importInfo.duplicateWallets + ' duplicates skipped' : ''}
                      {importInfo.invalidLines ? ' · ' + importInfo.invalidLines + ' invalid lines skipped' : ''}
                    </Text>
                    {!scanRunning && (
                      <PrimaryButton title={customAnalysis ? 'Analyze list again' : 'Start deep scan'} onPress={startWalletScan} />
                    )}
                  </View>
                ) : null}
                {scanRunning && scanProgress ? (
                  <ScanProgress progress={scanProgress} onCancel={cancelWalletScan} />
                ) : null}
                {scanError ? <Text style={styles.scanError}>{scanError}</Text> : null}
                {customAnalysis ? (
                  <Text style={styles.coverageNote}>
                    Official PnL and volume matched for {customAnalysis.leaderboardMatched.toLocaleString()} of {customAnalysis.universeSize.toLocaleString()} wallets. Others use position-based estimates. {customAnalysis.profilesWithPartialData ? customAnalysis.profilesWithPartialData + ' profiles had partial data.' : ''} {customAnalysis.positionsCapped ? customAnalysis.positionsCapped + ' position histories reached the 5,000-position cap.' : ''}
                  </Text>
                ) : null}
              </View>
              <View style={styles.searchBox}>
                <Text style={styles.searchGlyph}>⌕</Text>
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search name or wallet"
                  placeholderTextColor={C.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.searchInput}
                  accessibilityLabel="Search traders by name or wallet"
                />
              </View>
              <HStack style={styles.listColumnHead}>
                <Text style={styles.tableLabel}>TRADER</Text>
                <Text style={styles.tableLabel}>SCORE</Text>
              </HStack>
            </View>
          )}
          ListEmptyComponent={(
            <EmptyState
              title={activeSnapshot ? 'No traders match' : 'Leaderboard is loading'}
              detail={activeSnapshot ? 'Try another name or wallet address.' : (error || 'Load the daily feed to see scored wallets.')}
            />
          )}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={16}
          maxToRenderPerBatch={20}
          windowSize={8}
          refreshing={refreshing}
          onRefresh={loadSnapshot}
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={tab === 'today' ? <RefreshControl refreshing={refreshing} onRefresh={loadSnapshot} tintColor={C.lime} /> : undefined}
          keyboardShouldPersistTaps="handled"
        >
          {tab === 'today' ? (
            <TodayScreen
              snapshot={activeSnapshot}
              isCustomAnalysis={Boolean(customAnalysis)}
              loading={loading}
              refreshing={refreshing}
              error={error}
              slateIsCurrent={slateIsCurrent}
              onSettings={() => {
                setSettingsDraft(feedURL);
                setSettingsOpen(true);
              }}
            />
          ) : (
            <MethodologyScreen snapshot={activeSnapshot} onSettings={() => {
              setSettingsDraft(feedURL);
              setSettingsOpen(true);
            }} />
          )}
        </ScrollView>
      )}

      <BottomTabs active={tab} onChange={setTab} />

      <Modal visible={Boolean(selectedTrader)} animationType="slide" onRequestClose={() => setSelectedTrader(null)}>
        {selectedTrader && <TraderDetail trader={selectedTrader} onClose={() => setSelectedTrader(null)} />}
      </Modal>

      <Modal visible={settingsOpen} animationType="slide" transparent onRequestClose={() => setSettingsOpen(false)}>
        <View style={styles.modalBackdrop}>
          <SafeAreaView style={styles.settingsSheet}>
            <HStack style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Feed settings</Text>
              <Pressable onPress={() => setSettingsOpen(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close feed settings">
                <Text style={styles.closeText}>Done</Text>
              </Pressable>
            </HStack>
            <Text style={styles.label}>PUBLIC DAILY JSON URL</Text>
            <TextInput
              value={settingsDraft}
              onChangeText={setSettingsDraft}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              multiline
              placeholder="https://…/daily-picks.json"
              placeholderTextColor={C.muted}
              style={[styles.searchInput, styles.urlInput]}
              accessibilityLabel="Public daily feed URL"
            />
            <Text style={styles.bodyMuted}>
              This app reads a public snapshot and never connects a wallet. A custom URL is kept in memory while this Expo Go session is open.
            </Text>
            <PrimaryButton title="Save and refresh" onPress={() => {
              const next = settingsDraft.trim() || FEED_URL;
              setFeedURL(next);
              setSettingsOpen(false);
              if (next === feedURL) loadSnapshot();
            }} />
            <Pressable style={styles.secondaryButton} onPress={() => {
              setSettingsDraft(FEED_URL);
              setFeedURL(FEED_URL);
              setSettingsOpen(false);
              if (feedURL === FEED_URL) loadSnapshot();
            }}>
              <Text style={styles.secondaryButtonText}>Use the built-in feed</Text>
            </Pressable>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function TodayScreen({ snapshot, isCustomAnalysis = false, loading, refreshing, error, slateIsCurrent, onSettings }) {
  const picks = (snapshot?.picks || []).slice(0, 3);
  return (
    <View>
      <HStack style={styles.heroRow}>
        <View style={styles.heroText}>
          <Text style={styles.eyebrow}><Text style={styles.liveDot}>●</Text>  SPORTS MARKET INTELLIGENCE</Text>
          <Text style={styles.heroTitle}>Signal Slate</Text>
      <Text style={styles.heroSubtitle}>
        {isCustomAnalysis ? 'Your uploaded trader list · ' : ''}
        {snapshot ? dateLabel(`${snapshot.slateDate}T12:00:00Z`) : 'Today’s top trader signals'}
      </Text>
        </View>
        <Pressable style={styles.iconButton} onPress={onSettings} accessibilityRole="button" accessibilityLabel="Feed settings">
          <Text style={styles.settingsGlyph}>⚙</Text>
        </Pressable>
      </HStack>

      <SnapshotStatus snapshot={snapshot} loading={loading} refreshing={refreshing} error={error} slateIsCurrent={slateIsCurrent} />

      <HStack style={styles.summaryRow}>
        <SummaryTile value={snapshot?.universeSize ?? '—'} label="TRADERS SCORED" icon="♙" />
        <SummaryTile value={snapshot?.picks?.length ?? '—'} label="TODAY’S SIGNALS" icon="◎" />
        <SummaryTile value={snapshot?.tradersWithHistoryData ?? '—'} label="HISTORY CHECKED" icon="↻" />
      </HStack>

      <View style={styles.sectionHeader}>
        <View style={styles.flexOne}>
          <Text style={styles.sectionTitle}>{slateIsCurrent ? 'Today’s signal card' : 'Latest published slate'}</Text>
          <Text style={styles.bodyMuted}>
            {isCustomAnalysis ? 'Score-weighted positions from your uploaded wallets' : 'Crowd positions from high-scoring sports wallets'}
          </Text>
        </View>
        {picks.length > 0 && <Text style={styles.topThree}>TOP 3</Text>}
      </View>

      {picks.length > 0 ? picks.map((pick) => <PickCard key={pick.conditionId || pick.rank} pick={pick} />) : (
        <EmptyState
          icon={loading ? '◌' : '◎'}
          title={loading ? 'Loading today’s snapshot' : snapshot?.universeSize === 0 ? 'Snapshot is warming up' : snapshot ? 'No qualified picks yet' : 'Daily feed not connected'}
          detail={loading
            ? 'Fetching the latest public Polymarket snapshot.'
            : snapshot?.universeSize === 0
              ? 'Run the daily snapshot workflow once to publish the first slate.'
              : snapshot
                ? isCustomAnalysis
                  ? (snapshot.marketDataError
                    ? 'The trader scan completed, but today’s sports schedule could not be loaded: ' + snapshot.marketDataError
                    : 'No market in today’s slate passed the consensus rule for your uploaded wallet list.')
                  : 'No market passed the consensus rule for this slate. Pull down to check again later.'
                : (error || 'Check the feed URL in settings and pull down to retry.')}
        />
      )}

      <View style={styles.disclaimerRow}>
        <Text style={styles.noticeGlyph}>ⓘ</Text>
        <Text style={styles.disclaimer}>
          These signals reflect tracked wallet positions when the snapshot ran. Prices and positions can change. Past results don’t guarantee future outcomes; review markets and risks yourself.
        </Text>
      </View>
    </View>
  );
}

function HeaderBlock({ eyebrow, title, subtitle }) {
  return (
    <View style={styles.headerBlock}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.screenTitle}>{title}</Text>
      <Text style={styles.bodyMuted}>{subtitle}</Text>
    </View>
  );
}

function ScanProgress({ progress, onCancel }) {
  const total = Math.max(1, Number(progress.total) || 1);
  const done = Math.max(0, Math.min(total, Number(progress.done) || 0));
  const ratio = Math.round((done / total) * 100);
  return (
    <View style={styles.scanCard}>
      <HStack style={styles.scanHead}>
        <View style={styles.flexOne}>
          <Text style={styles.uploadTitle}>{progress.complete ? 'Scan complete' : progress.phase}</Text>
          <Text style={styles.bodyMuted}>
            {progress.phase === 'Loading official SPORTS leaderboard'
              ? done + ' of ' + total + ' leaderboard pages · 2,000 trader limit'
              : done.toLocaleString() + ' of ' + total.toLocaleString() + ' wallets processed'}
          </Text>
        </View>
        {!progress.complete ? (
          <Pressable onPress={onCancel} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.cancelScan}>Cancel</Text>
          </Pressable>
        ) : null}
      </HStack>
      <View style={styles.progressTrack}><View style={[styles.progressFill, { width: ratio + '%' }]} /></View>
      {progress.complete ? (
        <Text style={styles.coverageNote}>
          Official leaderboard matched: {(progress.matched || 0).toLocaleString()} · Partial profiles: {progress.failures || 0}
        </Text>
      ) : (
        <Text style={styles.scanHint}>Keep Expo Go open while it scans. Public API rate limits can make a 2,000-wallet run take several minutes.</Text>
      )}
    </View>
  );
}

function SnapshotStatus({ snapshot, loading, refreshing, error, slateIsCurrent }) {
  if (loading && !snapshot) {
    return <View style={styles.statusCard}><ActivityIndicator color={C.lime} /><Text style={styles.statusText}>Loading today’s market snapshot…</Text></View>;
  }
  if (error) {
    return (
      <View style={styles.statusCard}>
        <Text style={styles.noticeGlyph}>{snapshot ? '↻' : '!'}</Text>
        <View style={styles.flexOne}>
          <Text style={styles.statusTitle}>{snapshot ? 'Showing the saved screen data' : 'Daily feed not connected'}</Text>
          <Text style={styles.statusText}>{error}</Text>
        </View>
      </View>
    );
  }
  if (!snapshot) return null;
  return (
    <View style={styles.statusLine}>
      <Text style={styles.statusOk}>●</Text>
      <Text style={styles.statusLineText}>
        {refreshing ? 'Refreshing · ' : ''}{slateIsCurrent ? 'Updated ' : 'Last slate · '}{dateLabel(snapshot.generatedAt, { hour: 'numeric', minute: '2-digit' })} ET
      </Text>
      <View style={styles.flexOne} />
      <Text style={styles.statusTag}>{slateIsCurrent ? `${snapshot.universeSize || 0} WALLETS` : 'STALE SLATE'}</Text>
    </View>
  );
}

function SummaryTile({ value, label, icon }) {
  return (
    <View style={styles.summaryTile}>
      <Text style={styles.summaryIcon}>{icon}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit style={styles.summaryValue}>{String(value)}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function PickCard({ pick }) {
  const price = pick.price === null || pick.price === undefined ? '—' : `${Math.round(number(pick.price) * 100)}¢`;
  const marketURL = typeof pick.marketURL === 'string' && pick.marketURL.startsWith('https://polymarket.com/')
    ? pick.marketURL
    : '';
  return (
    <View style={styles.pickCard}>
      <HStack style={styles.pickTop}>
        <Text style={styles.rankPill}>{String(pick.rank || 1).padStart(2, '0')}</Text>
        <View style={styles.flexOne}>
          <Text style={styles.pickTitle}>{pick.title || 'Sports market'}</Text>
          <Text style={styles.pickOutcome}>{pick.outcome || 'Consensus position'} · {pick.consensusWallets || 0} tracked wallets</Text>
          {pick.endDate ? <Text style={styles.pickTime}>Market time · {dateLabel(pick.endDate, { hour: 'numeric', minute: '2-digit' })} ET</Text> : null}
        </View>
        <ScoreBadge score={pick.score} />
      </HStack>
      <HStack style={styles.metricsRow}>
        <Metric title="SIGNAL SCORE" value={Math.round(number(pick.score))} suffix="/100" />
        <Metric title="WALLET SUPPORT" value={`${Math.round(number(pick.consensus))}%`} />
        <Metric title="MARKET PRICE" value={price} />
      </HStack>
      {pick.rationale ? <Text style={styles.rationale}>{pick.rationale}</Text> : null}
      <HStack style={styles.pickFooter}>
        <View style={styles.chipsRow}>
          {(pick.supportingTraders || []).slice(0, 3).map((trader) => (
            <Text key={trader.wallet} numberOfLines={1} style={styles.nameChip}>{trader.name || 'Trader'}</Text>
          ))}
        </View>
        {marketURL ? <Pressable onPress={() => Linking.openURL(marketURL)} accessibilityRole="link"><Text style={styles.marketLink}>View market ↗</Text></Pressable> : null}
      </HStack>
    </View>
  );
}

function ScoreBadge({ score }) {
  return (
    <View style={styles.scoreBadge}>
      <Text style={styles.scoreValue}>{number(score).toFixed(1)}</Text>
      <Text style={styles.scoreLabel}>SCORE</Text>
    </View>
  );
}

function Metric({ title, value, suffix = '' }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{title}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit style={styles.metricValue}>{value}<Text style={styles.metricSuffix}>{suffix}</Text></Text>
    </View>
  );
}

function EmptyState({ icon = '◎', title, detail }) {
  return (
    <View style={styles.emptyCard}>
      <Text style={styles.emptyIcon}>{icon}</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDetail}>{detail}</Text>
    </View>
  );
}

function TradersScreenHeader({ search, setSearch }) {
  return (
    <View style={styles.listHeader}>
      <HeaderBlock
        eyebrow="WALLET PERFORMANCE"
        title="Trader board"
        subtitle="The highest-scoring wallets from the all-time sports leaderboard."
      />
      <View style={styles.searchBox}>
        <Text style={styles.searchGlyph}>⌕</Text>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search name or wallet"
          placeholderTextColor={C.muted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.searchInput}
          accessibilityLabel="Search traders by name or wallet"
        />
      </View>
      <HStack style={styles.listColumnHead}>
        <Text style={styles.tableLabel}>TRADER</Text>
        <Text style={styles.tableLabel}>SCORE</Text>
      </HStack>
    </View>
  );
}

function TraderRow({ trader, onPress }) {
  return (
    <Pressable style={styles.traderRow} onPress={onPress} accessibilityRole="button" accessibilityLabel={`Trader ${trader.name}, score ${number(trader.score).toFixed(1)} out of 100`}>
      <Text style={styles.traderRank}>{String(trader.rank || 0).padStart(3, '0')}</Text>
      <View style={styles.flexOne}>
        <Text numberOfLines={1} style={styles.traderName}>{trader.name || 'Anonymous trader'}</Text>
          <Text style={styles.traderMeta}>{trader.pnlIsEstimated ? 'Est. PnL' : 'PnL'} {money(trader.pnl)} · Win {percent(trader.winRate)}</Text>
        <Text numberOfLines={1} style={styles.traderMetaSmall}>
          Vol {money(trader.volume)} · {trader.activePositionCount || 0} open sports
          {trader.leaderboardMatched === false ? ' · estimated' : ''}
          {trader.positionsFetched === false || trader.historyFetched === false ? ' · partial data' : ''}
        </Text>
      </View>
      <ScoreBadge score={trader.score} />
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function TraderDetail({ trader, onClose }) {
  const active = trader.activePositions || [];
  const history = trader.recentResults || [];
  return (
    <SafeAreaView style={styles.detailScreen}>
      <HStack style={styles.detailNav}>
        <Pressable onPress={onClose} accessibilityRole="button"><Text style={styles.backText}>‹  Traders</Text></Pressable>
        <Text style={styles.detailNavTitle}>Trader profile</Text>
        <View style={{ width: 72 }} />
      </HStack>
      <ScrollView contentContainerStyle={styles.detailContent}>
        <HStack style={styles.detailHero}>
          <View style={styles.flexOne}>
            <Text style={styles.eyebrow}>SCORE RANK #{trader.rank} · PNL RANK #{trader.pnlRank}</Text>
            <Text style={styles.detailName}>{trader.name || 'Anonymous trader'}</Text>
            <Text selectable style={styles.walletAddress}>{trader.wallet}</Text>
            {trader.leaderboardMatched !== undefined ? (
              <Text style={styles.detailCoverage}>
                {trader.leaderboardMatched ? 'Official leaderboard PnL/volume' : 'PnL/volume estimated from sampled positions'}
                {trader.positionsFetched === false || trader.historyFetched === false ? ' · Some public data did not load' : ''}
                {trader.positionsCapped ? ' · Position history reached the 5,000 cap' : ''}
              </Text>
            ) : null}
          </View>
          <ScoreBadge score={trader.score} />
        </HStack>

        <HStack style={styles.statsRow}>
          <DetailStat title={trader.pnlIsEstimated ? 'SAMPLED PNL EST.' : 'ALL-TIME SPORTS PNL'} value={money(trader.pnl)} />
          <DetailStat title={trader.pnlIsEstimated ? 'OBSERVED VOL. EST.' : 'ALL-TIME SPORTS VOL.'} value={money(trader.volume)} />
        </HStack>
        <HStack style={styles.statsRow}>
          <DetailStat title="SAMPLED WIN RATE" value={percent(trader.winRate)} />
          <DetailStat title="SETTLED SAMPLE" value={trader.closedPositionsSampled ?? 0} />
        </HStack>

        <SectionHeading title="Open sports positions" subtitle="Largest tracked positions" />
        {active.length ? active.map((position, index) => <PositionRow key={position.conditionId || `${index}`} position={position} />) : (
          <EmptyState title="No open sports positions found" detail="This wallet may have closed its positions or the public data sample may be empty." />
        )}

        <SectionHeading title="Recent settled markets" subtitle="Most recent sampled sports results" />
        {history.length ? history.map((trade, index) => <PastTradeRow key={`${trade.slug || trade.title}-${trade.closedAt || index}`} trade={trade} />) : (
          <EmptyState title="No settled sample yet" detail="A win rate appears after the public API returns settled sports positions." />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function DetailStat({ title, value }) {
  return (
    <View style={styles.detailStat}>
      <Text style={styles.detailStatTitle}>{title}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit style={styles.detailStatValue}>{String(value)}</Text>
    </View>
  );
}

function SectionHeading({ title, subtitle }) {
  return (
    <View style={styles.detailSectionHeading}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.bodyMuted}>{subtitle}</Text>
    </View>
  );
}

function PositionRow({ position }) {
  const price = position.currentPrice === null || position.currentPrice === undefined
    ? 'Price unavailable'
    : `${Math.round(number(position.currentPrice) * 100)}¢`;
  return (
    <View style={styles.detailRow}>
      <View style={styles.positionBar} />
      <View style={styles.flexOne}>
        <Text numberOfLines={2} style={styles.detailRowTitle}>{position.title || position.slug || 'Sports market'}</Text>
        <Text style={styles.detailRowMeta}>{position.outcome || 'Position'} · {price}</Text>
      </View>
      <View style={styles.valueColumn}>
        <Text style={styles.positionValue}>{money(position.currentValue)}</Text>
        <Text style={styles.detailRowMeta}>open value</Text>
      </View>
    </View>
  );
}

function PastTradeRow({ trade }) {
  const pnl = number(trade.realizedPnl);
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.resultIcon, { color: pnl >= 0 ? C.mint : C.loss }]}>{pnl >= 0 ? '✓' : '×'}</Text>
      <View style={styles.flexOne}>
        <Text numberOfLines={2} style={styles.detailRowTitle}>{trade.title || trade.slug || 'Settled sports market'}</Text>
        <Text style={styles.detailRowMeta}>{trade.outcome || 'Result'} · {dateLabel(trade.closedAt, { month: 'short', day: 'numeric' })}</Text>
      </View>
      <Text style={[styles.tradePnl, { color: pnl >= 0 ? C.mint : C.loss }]}>{money(pnl)}</Text>
    </View>
  );
}

function MethodologyScreen({ snapshot, onSettings }) {
  const steps = [
    ['01', 'Choose the wallet universe', 'Use the published top-1,000 daily list or import up to 2,000 wallet addresses from a TXT file.'],
    ['02', 'Measure recent positions', 'Sample active positions and up to 100 recent closed trades per wallet; retry temporary API failures and report partial coverage.'],
    ['03', 'Score each wallet', 'Blend PnL rank (40%), sampled win rate with a neutral four-result prior (30%), sports volume rank (15%), and open-position rank (15%). Imported wallets outside the top-2,000 leaderboard use labeled estimates.'],
    ['04', 'Rank today’s bets', 'Match open positions to active sports markets scheduled later today. Require at least two wallets and 55% score-weighted support.'],
  ];
  return (
    <View>
      <HeaderBlock eyebrow="SCORING NOTES" title="How the signal works" subtitle="A transparent read of public Polymarket sports data." />
      <View style={styles.methodCard}>
        {steps.map(([numberLabel, title, detail], index) => (
          <View key={numberLabel} style={[styles.methodRow, index > 0 && styles.methodBorder]}>
            <Text style={styles.methodNumber}>{numberLabel}</Text>
            <View style={styles.flexOne}>
              <Text style={styles.methodTitle}>{title}</Text>
              <Text style={styles.methodDetail}>{detail}</Text>
            </View>
          </View>
        ))}
      </View>
      {snapshot?.methodology ? <Text style={styles.methodFinePrint}>{snapshot.methodology}</Text> : null}
      <View style={styles.riskCard}>
        <Text style={styles.riskTitle}>⚠  Read before you act</Text>
        <Text style={styles.methodDetail}>
          This is an informational research tool. It does not place trades or predict results. Public data can be delayed, incomplete, or change after the daily snapshot. Prediction markets involve risk; only participate where legal and only with money you can afford to lose.
        </Text>
      </View>
      <Pressable style={styles.settingsRow} onPress={onSettings} accessibilityRole="button">
        <Text style={styles.settingsRowText}>⚙  Daily feed settings</Text>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    </View>
  );
}

function PrimaryButton({ title, onPress }) {
  return (
    <Pressable style={styles.primaryButton} onPress={onPress} accessibilityRole="button">
      <Text style={styles.primaryButtonText}>{title}</Text>
    </Pressable>
  );
}

function BottomTabs({ active, onChange }) {
  const items = [
    ['today', '◷', 'Today'],
    ['traders', '♙', 'Traders'],
    ['method', '≋', 'How it works'],
  ];
  return (
    <View style={styles.bottomTabs}>
      {items.map(([key, icon, label]) => (
        <Pressable key={key} onPress={() => onChange(key)} style={styles.tabButton} accessibilityRole="tab" accessibilityState={{ selected: active === key }}>
          <Text style={[styles.tabIcon, active === key && styles.tabActive]}>{icon}</Text>
          <Text style={[styles.tabLabel, active === key && styles.tabActive]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function HStack({ children, style }) {
  return <View style={[styles.hStack, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: C.background },
  flexOne: { flex: 1, minWidth: 0 },
  hStack: { flexDirection: 'row', alignItems: 'center' },
  scrollContent: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 24 },
  listContent: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 20, flexGrow: 1 },
  listHeader: { paddingBottom: 13 },
  uploadPanel: { backgroundColor: C.raised, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 12, marginBottom: 14 },
  uploadTitle: { color: C.white, fontSize: 11, fontWeight: '800', marginBottom: 5 },
  importSummary: { borderTopWidth: 1, borderColor: C.line, marginTop: 11, paddingTop: 10 },
  importName: { color: C.lime, fontSize: 10, fontWeight: '800', marginBottom: 4 },
  scanCard: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 10, marginTop: 10 },
  scanHead: { justifyContent: 'space-between', gap: 8 },
  progressTrack: { height: 5, backgroundColor: C.raised, borderRadius: 5, overflow: 'hidden', marginTop: 10, marginBottom: 7 },
  progressFill: { height: 5, backgroundColor: C.lime, borderRadius: 5 },
  scanHint: { color: C.muted, fontSize: 8, lineHeight: 13 },
  cancelScan: { color: C.loss, fontSize: 9, fontWeight: '800', paddingVertical: 4 },
  scanError: { color: C.loss, fontSize: 9, lineHeight: 14, marginTop: 8 },
  coverageNote: { color: C.muted, fontSize: 8, lineHeight: 13, marginTop: 7 },
  heroRow: { alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 },
  heroText: { flex: 1, paddingRight: 12 },
  eyebrow: { color: C.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1.25, marginBottom: 8 },
  liveDot: { color: C.lime, fontSize: 9 },
  heroTitle: { color: C.white, fontSize: 34, fontWeight: '800', letterSpacing: -1.2 },
  heroSubtitle: { color: C.muted, fontSize: 13, fontWeight: '500', marginTop: 6 },
  iconButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  settingsGlyph: { color: C.white, fontSize: 17 },
  headerBlock: { marginBottom: 16, paddingTop: 8 },
  screenTitle: { color: C.white, fontSize: 30, fontWeight: '800', letterSpacing: -0.8, marginBottom: 5 },
  bodyMuted: { color: C.muted, fontSize: 11, lineHeight: 17 },
  statusCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 12, marginBottom: 15 },
  statusTitle: { color: C.white, fontSize: 11, fontWeight: '700', marginBottom: 3 },
  statusText: { color: C.muted, fontSize: 10, lineHeight: 15, flexShrink: 1 },
  statusLine: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 7 },
  statusOk: { color: C.mint, fontSize: 9 },
  statusLineText: { color: C.muted, fontSize: 10, flexShrink: 1 },
  statusTag: { color: C.lime, fontSize: 8, fontWeight: '800', letterSpacing: 0.7 },
  summaryRow: { gap: 9, marginBottom: 23 },
  summaryTile: { flex: 1, minWidth: 0, minHeight: 94, padding: 11, borderRadius: 15, backgroundColor: C.surface, borderColor: C.line, borderWidth: 1, justifyContent: 'space-between' },
  summaryIcon: { color: C.lime, fontSize: 14, fontWeight: '700' },
  summaryValue: { color: C.white, fontSize: 21, fontWeight: '800', marginTop: 5 },
  summaryLabel: { color: C.muted, fontSize: 7, fontWeight: '800', letterSpacing: 0.45, marginTop: 3 },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 12 },
  sectionTitle: { color: C.white, fontSize: 18, fontWeight: '800', marginBottom: 3 },
  topThree: { color: C.lime, fontSize: 9, fontWeight: '900', letterSpacing: 1, paddingBottom: 2 },
  pickCard: { padding: 14, borderRadius: 18, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, marginBottom: 11 },
  pickTop: { alignItems: 'flex-start', gap: 10 },
  rankPill: { color: C.lime, fontSize: 10, fontWeight: '800', fontVariant: ['tabular-nums'], backgroundColor: 'rgba(191,250,89,0.12)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, overflow: 'hidden' },
  pickTitle: { color: C.white, fontSize: 13, fontWeight: '700', lineHeight: 18 },
  pickOutcome: { color: C.mint, fontSize: 10, fontWeight: '600', marginTop: 4 },
  pickTime: { color: C.muted, fontSize: 9, marginTop: 4 },
  scoreBadge: { minWidth: 45, borderRadius: 11, borderWidth: 1, borderColor: 'rgba(191,250,89,0.2)', backgroundColor: 'rgba(191,250,89,0.1)', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 6 },
  scoreValue: { color: C.lime, fontSize: 15, fontWeight: '900' },
  scoreLabel: { color: C.lime, fontSize: 6, fontWeight: '900', letterSpacing: 0.6, marginTop: 1 },
  metricsRow: { justifyContent: 'space-between', borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.line, paddingVertical: 10, marginTop: 12, marginBottom: 10 },
  metric: { flex: 1, minWidth: 0 },
  metricLabel: { color: C.muted, fontSize: 7, fontWeight: '800', letterSpacing: 0.35, marginBottom: 5 },
  metricValue: { color: C.white, fontSize: 13, fontWeight: '800' },
  metricSuffix: { color: C.muted, fontSize: 9, fontWeight: '600' },
  rationale: { color: C.muted, fontSize: 10, lineHeight: 15, marginBottom: 11 },
  pickFooter: { justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  chipsRow: { flexDirection: 'row', flex: 1, minWidth: 0, gap: 5 },
  nameChip: { maxWidth: 88, overflow: 'hidden', color: C.white, fontSize: 8, fontWeight: '700', backgroundColor: C.raised, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 5 },
  marketLink: { color: C.lime, fontSize: 9, fontWeight: '800' },
  emptyCard: { paddingHorizontal: 18, paddingVertical: 22, borderRadius: 17, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, alignItems: 'center', marginBottom: 12 },
  emptyIcon: { color: C.lime, fontSize: 22, fontWeight: '600', marginBottom: 8 },
  emptyTitle: { color: C.white, fontSize: 13, fontWeight: '800', textAlign: 'center', marginBottom: 6 },
  emptyDetail: { color: C.muted, fontSize: 10, lineHeight: 15, textAlign: 'center' },
  disclaimerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 8 },
  noticeGlyph: { color: C.lime, fontSize: 14, fontWeight: '800' },
  disclaimer: { flex: 1, color: C.muted, fontSize: 9, lineHeight: 14 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 11, marginBottom: 15 },
  searchGlyph: { color: C.muted, fontSize: 23 },
  searchInput: { flex: 1, minHeight: 43, color: C.white, fontSize: 12, paddingVertical: 10, textAlignVertical: 'center' },
  listColumnHead: { justifyContent: 'space-between', paddingHorizontal: 4 },
  tableLabel: { color: C.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.9 },
  traderRow: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 11, marginBottom: 8 },
  traderRank: { color: C.muted, fontSize: 9, fontWeight: '800', width: 29, fontVariant: ['tabular-nums'] },
  traderName: { color: C.white, fontSize: 11, fontWeight: '700', marginBottom: 4 },
  traderMeta: { color: C.muted, fontSize: 9, marginBottom: 3 },
  traderMetaSmall: { color: C.muted, opacity: 0.85, fontSize: 8 },
  chevron: { color: C.muted, fontSize: 18, fontWeight: '400', marginLeft: 1 },
  bottomTabs: { flexDirection: 'row', borderTopWidth: 1, borderColor: C.line, backgroundColor: C.background, paddingTop: 8, paddingBottom: 3 },
  tabButton: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 3 },
  tabIcon: { color: C.muted, fontSize: 16, fontWeight: '700' },
  tabLabel: { color: C.muted, fontSize: 8, fontWeight: '700' },
  tabActive: { color: C.lime },
  detailScreen: { flex: 1, backgroundColor: C.background },
  detailNav: { height: 48, justifyContent: 'space-between', paddingHorizontal: 16, borderBottomWidth: 1, borderColor: C.line },
  backText: { color: C.lime, fontSize: 11, fontWeight: '700', width: 72 },
  detailNavTitle: { color: C.white, fontSize: 12, fontWeight: '700' },
  detailContent: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 30 },
  detailHero: { alignItems: 'flex-start', gap: 10, marginBottom: 16 },
  detailName: { color: C.white, fontSize: 25, fontWeight: '800', marginBottom: 6 },
  walletAddress: { color: C.muted, fontFamily: 'monospace', fontSize: 9, lineHeight: 14 },
  detailCoverage: { color: C.muted, fontSize: 8, lineHeight: 12, marginTop: 5 },
  statsRow: { gap: 8, marginBottom: 8 },
  detailStat: { flex: 1, minWidth: 0, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 13, padding: 12 },
  detailStatTitle: { color: C.muted, fontSize: 7, fontWeight: '900', letterSpacing: 0.55, marginBottom: 7 },
  detailStatValue: { color: C.white, fontSize: 17, fontWeight: '800' },
  detailSectionHeading: { marginTop: 14, marginBottom: 8 },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: C.surface, borderRadius: 13, padding: 11, marginBottom: 7 },
  positionBar: { width: 3, height: 38, borderRadius: 2, backgroundColor: C.mint },
  detailRowTitle: { color: C.white, fontSize: 10, fontWeight: '700', lineHeight: 14 },
  detailRowMeta: { color: C.muted, fontSize: 8, marginTop: 4 },
  valueColumn: { alignItems: 'flex-end', paddingLeft: 4 },
  positionValue: { color: C.white, fontSize: 10, fontWeight: '800' },
  resultIcon: { fontSize: 15, fontWeight: '900', width: 14 },
  tradePnl: { fontSize: 10, fontWeight: '800', paddingLeft: 3 },
  methodCard: { borderRadius: 16, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, paddingHorizontal: 13, marginBottom: 14 },
  methodRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 12 },
  methodBorder: { borderTopWidth: 1, borderColor: C.line },
  methodNumber: { width: 22, color: C.lime, fontSize: 9, fontWeight: '900', fontFamily: 'monospace', paddingTop: 2 },
  methodTitle: { color: C.white, fontSize: 11, fontWeight: '800', marginBottom: 4 },
  methodDetail: { color: C.muted, fontSize: 9, lineHeight: 14 },
  methodFinePrint: { color: C.muted, fontSize: 9, lineHeight: 14, marginBottom: 12 },
  riskCard: { backgroundColor: C.raised, borderRadius: 15, padding: 13, marginBottom: 12 },
  riskTitle: { color: C.lime, fontSize: 11, fontWeight: '800', marginBottom: 7 },
  settingsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, backgroundColor: C.surface, borderRadius: 14, marginBottom: 20 },
  settingsRowText: { color: C.white, fontSize: 11, fontWeight: '700' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  settingsSheet: { backgroundColor: C.background, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 20, borderWidth: 1, borderColor: C.line },
  modalHeader: { justifyContent: 'space-between', marginBottom: 18 },
  modalTitle: { color: C.white, fontSize: 18, fontWeight: '800' },
  closeText: { color: C.lime, fontSize: 11, fontWeight: '800' },
  label: { color: C.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.8, marginBottom: 7 },
  urlInput: { backgroundColor: C.surface, borderColor: C.line, borderWidth: 1, borderRadius: 11, paddingHorizontal: 10, minHeight: 58, marginBottom: 9 },
  primaryButton: { alignItems: 'center', justifyContent: 'center', backgroundColor: C.lime, borderRadius: 12, minHeight: 44, marginTop: 14 },
  primaryButtonText: { color: C.background, fontSize: 11, fontWeight: '900' },
  secondaryButton: { alignItems: 'center', paddingVertical: 12 },
  secondaryButtonText: { color: C.muted, fontSize: 10, fontWeight: '700' },
});
