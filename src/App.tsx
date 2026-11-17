import { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  Camera,
  CheckCircle2,
  Clock,
  LogOut,
  MapPin,
  Menu,
  Phone,
  Search,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import { AuthModal } from './components/AuthModal';
import { DashboardView } from './components/DashboardView';
import { GeminiChatbot } from './components/GeminiChatbot';
import { ItemDetailModal } from './components/ItemDetailModal';
import { ItemImageFrame } from './components/ItemMedia';
import { ReportFormView } from './components/ReportFormView';
import {
  WorkspaceConfirmModal,
  type WorkspaceConfirmPayload,
} from './components/WorkspaceConfirmModal';
import { apiFetch, getStoredSessionToken, setStoredSessionToken } from './lib/api';
import { initGoogleAuth, signOutGoogle } from './lib/firebaseAuth';
import type { Item, MatchRecord, StatsOverview, User } from './types';

type AppPage = 'home' | 'browse' | 'report' | 'matches' | 'dashboard';

const CATEGORIES = [
  'All',
  'Electronics',
  'Bags & Carry',
  'Audio',
  'Keys & IDs',
  'Academic',
  'Accessories',
  'Clothing',
  'Other',
];

const STATUSES = ['All', 'Open', 'Matched', 'Under Verification', 'Recovered'];

export default function App() {
  const [page, setPage] = useState<AppPage>('home');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [itemsError, setItemsError] = useState('');

  // Browse filters
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'lost' | 'found'>('all');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [locationFilter, setLocationFilter] = useState('');
  const [dateFromFilter, setDateFromFilter] = useState('');

  // Report form default type
  const [reportInitialType, setReportInitialType] = useState<'lost' | 'found'>('lost');

  // Detail modal
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);

  // Matching state
  const [runningMatch, setRunningMatch] = useState(false);
  const [matchBanner, setMatchBanner] = useState('');

  // Mandatory Workspace confirmation modal
  const [confirmPayload, setConfirmPayload] = useState<WorkspaceConfirmPayload | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const fetchStatsAndMatches = useCallback(async () => {
    try {
      const [statsData, matchesData] = await Promise.all([
        apiFetch<StatsOverview>('/api/stats'),
        apiFetch<{ matches: MatchRecord[] }>('/api/matches'),
      ]);
      setStats(statsData);
      setMatches(matchesData.matches);
    } catch {
      // Non-fatal background refresh
    }
  }, []);

  const fetchItems = useCallback(async () => {
    setLoadingItems(true);
    setItemsError('');
    try {
      const params = new URLSearchParams();
      if (typeFilter !== 'all') params.set('type', typeFilter);
      if (categoryFilter !== 'All') params.set('category', categoryFilter);
      if (statusFilter !== 'All') params.set('status', statusFilter);
      if (locationFilter.trim()) params.set('location', locationFilter.trim());
      if (dateFromFilter) params.set('dateFrom', dateFromFilter);
      if (searchQuery.trim()) params.set('q', searchQuery.trim());

      const qs = params.toString();
      const data = await apiFetch<{ items: Item[] }>(`/api/items${qs ? `?${qs}` : ''}`);
      setItems(data.items);
    } catch (err) {
      setItemsError(err instanceof Error ? err.message : 'Unable to load campus items.');
    } finally {
      setLoadingItems(false);
    }
  }, [typeFilter, categoryFilter, statusFilter, locationFilter, dateFromFilter, searchQuery]);

  // Restore session & monitor Firebase auth
  useEffect(() => {
    const token = getStoredSessionToken();
    if (token) {
      apiFetch<{ user: User }>('/api/auth/me')
        .then((res) => setCurrentUser(res.user))
        .catch(() => setStoredSessionToken(null));
    }

    const unsubscribe = initGoogleAuth(
      () => setGoogleConnected(true),
      () => setGoogleConnected(false)
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    fetchStatsAndMatches();
  }, [fetchStatsAndMatches]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const handleLogout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    await signOutGoogle().catch(() => {});
    setStoredSessionToken(null);
    setCurrentUser(null);
    setGoogleConnected(false);
    if (page === 'dashboard') setPage('home');
  };

  const handleRunMatching = async (useAi: boolean) => {
    setRunningMatch(true);
    setMatchBanner('');
    try {
      const res = await apiFetch<{
        evaluated: number;
        aiEnhanced: number;
        aiWarning?: string;
      }>('/api/matches/run', {
        method: 'POST',
        body: JSON.stringify({ useAi }),
      });
      await fetchStatsAndMatches();
      setMatchBanner(
        res.aiWarning
          ? `Evaluated ${res.evaluated} potential match pair(s). Note: ${res.aiWarning}`
          : `Evaluated ${res.evaluated} potential match pair(s) (${res.aiEnhanced} verified with Gemini multimodal analysis).`
      );
    } catch (err) {
      setMatchBanner(err instanceof Error ? err.message : 'Match evaluation failed.');
    } finally {
      setRunningMatch(false);
    }
  };

  const handleMatchAction = async (matchId: number, status: 'Confirmed' | 'Dismissed') => {
    if (!currentUser) {
      setAuthModalOpen(true);
      return;
    }
    try {
      await apiFetch(`/api/matches/${matchId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await fetchStatsAndMatches();
      await fetchItems();
    } catch (err) {
      setMatchBanner(err instanceof Error ? err.message : 'Unable to update match status.');
    }
  };

  const navigate = (target: AppPage) => {
    setPage(target);
    setMobileNavOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleConfirmExecution = async () => {
    if (!confirmPayload) return;
    setConfirmBusy(true);
    try {
      await confirmPayload.onConfirm();
      setConfirmPayload(null);
    } catch (err) {
      setMatchBanner(err instanceof Error ? err.message : 'Workspace operation failed.');
      setConfirmPayload(null);
    } finally {
      setConfirmBusy(false);
    }
  };

  const activeMatches = matches.filter((m) => m.status !== 'Dismissed');

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-element brand wordmark */}
          <button
            type="button"
            onClick={() => navigate('home')}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-800 rounded"
          >
            Reclaim It
          </button>

          {/* Zone 2: 5 concise single-line nav links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            {(
              [
                { id: 'home', label: 'Home' },
                { id: 'browse', label: 'Browse Items' },
                { id: 'report', label: 'Report Item' },
                { id: 'matches', label: 'Smart Matches' },
                { id: 'dashboard', label: 'Dashboard' },
              ] as const
            ).map((navItem) => (
              <button
                key={navItem.id}
                type="button"
                onClick={() => navigate(navItem.id)}
                className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  page === navItem.id
                    ? 'border-blue-800 text-slate-900 font-semibold'
                    : 'border-transparent hover:text-slate-900 hover:border-slate-300'
                }`}
              >
                {navItem.label}
              </button>
            ))}
          </nav>

          {/* Zone 3: 1 Primary Action */}
          <div className="flex items-center gap-3 shrink-0">
            {currentUser ? (
              <button
                type="button"
                onClick={handleLogout}
                title={`Signed in as ${currentUser.email}`}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <span className="max-w-[130px] truncate">{currentUser.name}</span>
                <LogOut className="w-3.5 h-3.5 text-slate-500" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setAuthModalOpen(true)}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-800 hover:bg-blue-900 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Sign In
              </button>
            )}

            <button
              type="button"
              onClick={() => setMobileNavOpen((o) => !o)}
              aria-label="Toggle navigation menu"
              className="md:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100"
            >
              {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {mobileNavOpen && (
          <nav className="md:hidden px-4 pb-4 pt-2 border-t border-slate-100 bg-white flex flex-col gap-1">
            {(
              [
                { id: 'home', label: 'Home' },
                { id: 'browse', label: 'Browse Items' },
                { id: 'report', label: 'Report Item' },
                { id: 'matches', label: 'Smart Matches' },
                { id: 'dashboard', label: 'Dashboard' },
              ] as const
            ).map((navItem) => (
              <button
                key={navItem.id}
                type="button"
                onClick={() => navigate(navItem.id)}
                className={`text-left px-3 py-2.5 rounded-lg text-sm font-medium ${
                  page === navItem.id
                    ? 'bg-slate-100 text-slate-900 font-semibold'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {navItem.label}
              </button>
            ))}
          </nav>
        )}
      </header>

      <main className="flex-1">
        {/* ======================== HOME VIEW ======================== */}
        {page === 'home' && (
          <>
            {/* Balanced 2-Column Hero */}
            <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-10 pb-12">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
                <div className="lg:col-span-6 flex flex-col justify-between bg-white border border-slate-200 rounded-xl p-8 sm:p-10">
                  <div>
                    <p className="text-xs font-medium text-blue-800">
                      Campus Lost &amp; Found Registry
                    </p>
                    <h1
                      className="mt-3 font-bold tracking-tight text-slate-900 leading-[1.12] [text-wrap:balance]"
                      style={{ fontSize: 'clamp(2.25rem, 3.6vw, 3.35rem)' }}
                    >
                      Recover misplaced campus belongings faster.
                    </h1>
                    <p className="mt-5 text-base text-slate-600 leading-relaxed max-w-xl">
                      Report lost or found items with high-resolution photo galleries, run intelligent cross-report matching, verify ownership claims, and sync campus recovery logs with Gmail and Google Sheets.
                    </p>
                  </div>

                  <div className="mt-8 pt-6 border-t border-slate-100 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setReportInitialType('lost');
                        navigate('report');
                      }}
                      className="px-5 py-3 bg-blue-800 hover:bg-blue-900 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
                    >
                      Report Lost or Found Item
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate('browse')}
                      className="inline-flex items-center gap-2 px-5 py-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
                    >
                      <span>Browse Active Catalog</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="lg:col-span-6">
                  <div className="h-full min-h-[300px] rounded-xl overflow-hidden border border-slate-200 bg-slate-200">
                    <img
                      src="/src/assets/images/hero_campus_commons_1794881025274.jpg"
                      alt="University student commons and library atrium"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              </div>

              {/* Full-Width 4-Column Statistics Strip */}
              <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <p className="text-xs text-slate-500">Logged Campus Reports</p>
                  <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                    {stats?.total_items ?? items.length}
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <p className="text-xs text-slate-500">Verified Recoveries</p>
                  <p className="text-2xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
                    {stats?.recovered_count ?? 1}
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <p className="text-xs text-slate-500">Active Match Suggestions</p>
                  <p className="text-2xl font-bold font-mono tabular-nums text-blue-800 mt-1">
                    {stats?.active_matches ?? activeMatches.length}
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <p className="text-xs text-slate-500">Campus Help Desk</p>
                  <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                    7397631012
                  </p>
                </div>
              </div>
            </section>

            {/* Editorial Numbered Capabilities */}
            <section className="max-w-7xl mx-auto px-4 sm:px-6 py-12 border-t border-slate-200">
              <div className="max-w-2xl mb-8">
                <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                  Built for campus security desks and student recovery
                </h2>
                <p className="text-sm text-slate-600 mt-2">
                  Every step from photography capture to physical handoff is documented and verifiable.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white border border-slate-200 rounded-xl p-6">
                  <h3 className="text-base font-semibold text-slate-900">
                    01. Multi-Image Catalog &amp; Lightbox Inspection
                  </h3>
                  <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                    Upload up to five JPG, PNG, or WEBP photographs per report with live pre-submit previews, cover selection, zoomable lightbox inspection, and Gemini photo auto-fill.
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-6">
                  <h3 className="text-base font-semibold text-slate-900">
                    02. Intelligent Cross-Report Matching
                  </h3>
                  <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                    Compares lost and found reports across category, campus building, reporting date, visual details, and text descriptions, flagging potential matches requiring verification.
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-6">
                  <h3 className="text-base font-semibold text-slate-900">
                    03. Audited Claim Verification Lifecycle
                  </h3>
                  <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                    Students submit ownership proof and track claim progress cleanly through Pending, Under Verification, Approved, and Recovered statuses.
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-6">
                  <h3 className="text-base font-semibold text-slate-900">
                    04. Gmail Alerts &amp; Google Sheets Recovery Logs
                  </h3>
                  <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                    Dispatch claim verification updates via Gmail and export live item and claim ledgers directly to Google Sheets with explicit user confirmation.
                  </p>
                </div>
              </div>
            </section>

            {/* Recent Campus Reports */}
            <section className="max-w-7xl mx-auto px-4 sm:px-6 py-12 border-t border-slate-200">
              <div className="flex items-end justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                    Recent Campus Reports
                  </h2>
                  <p className="text-sm text-slate-600 mt-1">
                    Click any item card to inspect full-size photographs, potential matches, or submit a claim.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('browse')}
                  className="text-sm font-medium text-blue-800 hover:underline whitespace-nowrap shrink-0"
                >
                  View all reports
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {items.slice(0, 6).map((item) => (
                  <ItemCard key={item.id} item={item} onSelect={setSelectedItemId} />
                ))}
              </div>
            </section>
          </>
        )}

        {/* ======================== BROWSE & SEARCH VIEW ======================== */}
        {page === 'browse' && (
          <section className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                  Browse Campus Lost &amp; Found
                </h1>
                <p className="text-sm text-slate-600 mt-1">
                  Search by item name, building, category, date, or recovery status.
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('report')}
                className="px-4 py-2.5 bg-blue-800 hover:bg-blue-900 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap self-start"
              >
                Submit New Report
              </button>
            </div>

            {/* Search & Filter Toolbar */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
              <div className="flex flex-col lg:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search laptops, headphones, keys, library..."
                    className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
                  />
                </div>

                <div className="inline-flex p-1 bg-slate-100 rounded-lg self-start">
                  {(['all', 'lost', 'found'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTypeFilter(t)}
                      className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors capitalize whitespace-nowrap ${
                        typeFilter === t
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {t === 'all' ? 'All Reports' : `${t} Items`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
                <select
                  aria-label="Filter by category"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      Category: {c}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Filter by status"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      Status: {s}
                    </option>
                  ))}
                </select>

                <input
                  type="text"
                  value={locationFilter}
                  onChange={(e) => setLocationFilter(e.target.value)}
                  placeholder="Filter location (e.g. Quad)"
                  className="px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />

                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    aria-label="Filter from date"
                    value={dateFromFilter}
                    onChange={(e) => setDateFromFilter(e.target.value)}
                    className="flex-1 px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                  {(searchQuery ||
                    typeFilter !== 'all' ||
                    categoryFilter !== 'All' ||
                    statusFilter !== 'All' ||
                    locationFilter ||
                    dateFromFilter) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        setTypeFilter('all');
                        setCategoryFilter('All');
                        setStatusFilter('All');
                        setLocationFilter('');
                        setDateFromFilter('');
                      }}
                      className="px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-300 rounded-lg whitespace-nowrap"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
            </div>

            {itemsError && (
              <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                {itemsError}
              </div>
            )}

            {loadingItems ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3].map((k) => (
                  <div
                    key={k}
                    className="bg-white border border-slate-200 rounded-xl overflow-hidden animate-pulse"
                  >
                    <div className="aspect-[4/3] bg-slate-200" />
                    <div className="p-5 space-y-3">
                      <div className="h-3 bg-slate-200 rounded w-1/2" />
                      <div className="h-5 bg-slate-200 rounded w-4/5" />
                      <div className="h-3 bg-slate-200 rounded w-2/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
                <p className="text-base font-semibold text-slate-900">No matching items found</p>
                <p className="text-sm text-slate-500 mt-1">
                  Try clearing filters or submit a new report so our matching engine can alert you when a match arrives.
                </p>
                <button
                  type="button"
                  onClick={() => navigate('report')}
                  className="mt-5 px-4 py-2 bg-blue-800 hover:bg-blue-900 text-white text-sm font-medium rounded-lg"
                >
                  Report an Item
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {items.map((item) => (
                  <ItemCard key={item.id} item={item} onSelect={setSelectedItemId} />
                ))}
              </div>
            )}
          </section>
        )}

        {/* ======================== REPORT ITEM VIEW ======================== */}
        {page === 'report' && (
          <ReportFormView
            currentUser={currentUser}
            initialType={reportInitialType}
            onRequireAuth={() => setAuthModalOpen(true)}
            onCreated={(createdItem, matchesCreated) => {
              fetchItems();
              fetchStatsAndMatches();
              setSelectedItemId(createdItem.id);
              if (matchesCreated > 0) {
                setMatchBanner(
                  `Your new report generated ${matchesCreated} potential match suggestion(s) requiring verification.`
                );
              }
              navigate('browse');
            }}
          />
        )}

        {/* ======================== SMART MATCHES VIEW ======================== */}
        {page === 'matches' && (
          <section className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-6">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                  Intelligent Match Suggestions
                </h1>
                <p className="text-sm text-slate-600 mt-1 max-w-2xl">
                  Compares item photographs, descriptions, categories, campus locations, and dates. Every suggestion requires manual ownership verification before release.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => handleRunMatching(false)}
                  disabled={runningMatch}
                  className="px-4 py-2.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
                >
                  Run Metadata Match
                </button>
                <button
                  type="button"
                  onClick={() => handleRunMatching(true)}
                  disabled={runningMatch}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium text-white bg-blue-800 hover:bg-blue-900 rounded-lg transition-colors disabled:opacity-60 whitespace-nowrap"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{runningMatch ? 'Evaluating...' : 'Run Gemini Visual Match'}</span>
                </button>
              </div>
            </div>

            {matchBanner && (
              <div className="p-3.5 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900">
                {matchBanner}
              </div>
            )}

            {activeMatches.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
                <p className="text-base font-semibold text-slate-900">No active potential matches</p>
                <p className="text-sm text-slate-500 mt-1">
                  Run Gemini Visual Match after new lost or found items are reported.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {activeMatches.map((m) => (
                  <div
                    key={m.id}
                    className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
                      <div className="flex items-center gap-2 text-xs font-semibold text-amber-700">
                        <ShieldAlert className="w-4 h-4 shrink-0" />
                        <span>Potential Match — Requires Verification</span>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <span className="text-slate-600 font-normal">Status: {m.status}</span>
                      </div>
                      <span className="text-sm font-mono font-bold tabular-nums text-blue-800">
                        {m.score}% confidence
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Lost Side */}
                      <div className="flex items-start gap-4">
                        <div className="w-28 aspect-[4/3] rounded-lg overflow-hidden bg-slate-100 border border-slate-200 shrink-0">
                          <ItemImageFrame
                            src={m.lost_image}
                            alt={m.lost_title}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-slate-500">
                            Lost Report · {m.lost_date}
                          </p>
                          <button
                            type="button"
                            onClick={() => setSelectedItemId(m.lost_item_id)}
                            className="text-sm font-semibold text-slate-900 hover:text-blue-800 text-left mt-0.5"
                          >
                            {m.lost_title}
                          </button>
                          <p className="text-xs text-slate-600 mt-1">{m.lost_location}</p>
                        </div>
                      </div>

                      {/* Found Side */}
                      <div className="flex items-start gap-4">
                        <div className="w-28 aspect-[4/3] rounded-lg overflow-hidden bg-slate-100 border border-slate-200 shrink-0">
                          <ItemImageFrame
                            src={m.found_image}
                            alt={m.found_title}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-slate-500">
                            Found Report · {m.found_date}
                          </p>
                          <button
                            type="button"
                            onClick={() => setSelectedItemId(m.found_item_id)}
                            className="text-sm font-semibold text-slate-900 hover:text-blue-800 text-left mt-0.5"
                          >
                            {m.found_title}
                          </button>
                          <p className="text-xs text-slate-600 mt-1">{m.found_location}</p>
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <p className="text-xs text-slate-600 leading-relaxed">{m.reason}</p>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setSelectedItemId(m.found_item_id)}
                          className="px-3 py-1.5 text-xs font-medium text-white bg-blue-800 hover:bg-blue-900 rounded-lg whitespace-nowrap"
                        >
                          Verify &amp; Claim
                        </button>
                        {m.status === 'Suggested' && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleMatchAction(m.id, 'Confirmed')}
                              className="px-3 py-1.5 text-xs font-medium text-emerald-700 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 rounded-lg whitespace-nowrap"
                            >
                              Confirm Pair
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMatchAction(m.id, 'Dismissed')}
                              className="px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap"
                            >
                              Dismiss
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ======================== DASHBOARD VIEW ======================== */}
        {page === 'dashboard' && (
          <DashboardView
            currentUser={currentUser}
            googleConnected={googleConnected}
            stats={stats}
            onRequireAuth={() => setAuthModalOpen(true)}
            onSelectItem={setSelectedItemId}
            onRequestConfirm={(payload) => setConfirmPayload(payload)}
            onDataChanged={() => {
              fetchItems();
              fetchStatsAndMatches();
            }}
          />
        )}
      </main>

      {/* Quiet Institutional Footer */}
      <footer className="bg-white border-t border-slate-200 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <p className="font-display text-base font-bold text-slate-900">Reclaim It</p>
            <p className="text-xs text-slate-500 mt-1">
              Campus Lost and Found Management System · Student Commons Verification Desk
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-6 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
              <Phone className="w-3.5 h-3.5 text-slate-400" />
              Desk Phone: 7397631012
            </span>
            <span>Coordinator: gvijayraj2005@gmail.com</span>
          </div>
        </div>
      </footer>

      {/* Modals & Persistent Multi-Turn Assistant */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onAuthenticated={(user, gConnected) => {
          setCurrentUser(user);
          if (gConnected) setGoogleConnected(true);
          fetchStatsAndMatches();
        }}
      />

      <ItemDetailModal
        itemId={selectedItemId}
        currentUser={currentUser}
        onClose={() => setSelectedItemId(null)}
        onRequireAuth={() => setAuthModalOpen(true)}
        onItemChanged={() => {
          fetchItems();
          fetchStatsAndMatches();
        }}
      />

      <WorkspaceConfirmModal
        payload={
          confirmPayload
            ? {
                ...confirmPayload,
                onConfirm: handleConfirmExecution,
              }
            : null
        }
        busy={confirmBusy}
        onCancel={() => !confirmBusy && setConfirmPayload(null)}
      />

      <GeminiChatbot />
    </div>
  );
}

interface ItemCardProps {
  item: Item;
  onSelect: (id: number) => void;
}

function ItemCard({ item, onSelect }: ItemCardProps) {
  const cover = item.images[0]?.url;

  return (
    <article className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col group hover:border-slate-300 transition-colors">
      <button
        type="button"
        onClick={() => onSelect(item.id)}
        className="relative aspect-[4/3] w-full overflow-hidden bg-slate-100 block text-left"
      >
        <ItemImageFrame
          src={cover}
          alt={item.title}
          category={item.category}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
        {item.images.length > 1 && (
          <span className="absolute bottom-2.5 right-2.5 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-900/75 text-white text-[11px] font-mono tabular-nums">
            <Camera className="w-3 h-3" />
            {item.images.length}
          </span>
        )}
      </button>

      <div className="p-5 flex-1 flex flex-col justify-between">
        <div>
          {/* Zero-pill unboxed metadata with typographic separators */}
          <div className="flex items-center flex-wrap gap-1.5 text-xs text-slate-500">
            <span
              className={`font-semibold ${
                item.type === 'lost' ? 'text-amber-700' : 'text-blue-800'
              }`}
            >
              {item.type === 'lost' ? 'Lost' : 'Found'}
            </span>
            <span aria-hidden="true">·</span>
            <span>{item.category}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{item.item_date}</span>
          </div>

          <button
            type="button"
            onClick={() => onSelect(item.id)}
            className="mt-2 text-base font-semibold text-slate-900 group-hover:text-blue-800 transition-colors text-left line-clamp-2 block"
          >
            {item.title}
          </button>

          <p className="mt-2 text-xs text-slate-600 line-clamp-2 leading-relaxed">
            {item.description}
          </p>
        </div>

        <div className="mt-4 pt-3.5 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 text-slate-600 truncate">
            <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="truncate">{item.location}</span>
          </span>

          <span
            className={`inline-flex items-center gap-1 font-medium shrink-0 ${
              item.status === 'Recovered'
                ? 'text-emerald-700'
                : item.status === 'Matched' || item.status === 'Under Verification'
                  ? 'text-amber-700'
                  : 'text-slate-700'
            }`}
          >
            {item.status === 'Recovered' ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : (
              <Clock className="w-3.5 h-3.5" />
            )}
            <span>{item.status}</span>
          </span>
        </div>
      </div>
    </article>
  );
}
