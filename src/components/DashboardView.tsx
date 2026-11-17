import { useEffect, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  Mail,
  RefreshCw,
  Send,
  Shield,
  Trash2,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { getGoogleAccessToken } from '../lib/firebaseAuth';
import type {
  ClaimRecord,
  Item,
  MatchRecord,
  NotificationRecord,
  StatsOverview,
  User,
} from '../types';
import { ItemImageFrame } from './ItemMedia';
import type { WorkspaceConfirmPayload } from './WorkspaceConfirmModal';

interface GmailMessage {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
}

interface DashboardViewProps {
  currentUser: User | null;
  googleConnected: boolean;
  stats: StatsOverview | null;
  onRequireAuth: () => void;
  onSelectItem: (itemId: number) => void;
  onRequestConfirm: (payload: WorkspaceConfirmPayload) => void;
  onDataChanged: () => void;
}

export function DashboardView({
  currentUser,
  googleConnected,
  stats,
  onRequireAuth,
  onSelectItem,
  onRequestConfirm,
  onDataChanged,
}: DashboardViewProps) {
  const [tab, setTab] = useState<'overview' | 'claims' | 'admin' | 'workspace'>('overview');
  const [myItems, setMyItems] = useState<Item[]>([]);
  const [allItems, setAllItems] = useState<Item[]>([]);
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [adminUsers, setAdminUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  // Gmail & Sheets workspace state
  const [gmailMessages, setGmailMessages] = useState<GmailMessage[]>([]);
  const [gmailTo, setGmailTo] = useState('');
  const [gmailSubject, setGmailSubject] = useState('Reclaim It — Ownership Claim Verification Update');
  const [gmailBody, setGmailBody] = useState('');
  const [sheetIdInput, setSheetIdInput] = useState('');
  const [exportedSheetUrl, setExportedSheetUrl] = useState('');
  const [sheetPreview, setSheetPreview] = useState<{
    title: string;
    activeSheet: string;
    sheetNames: string[];
    rows: string[][];
  } | null>(null);

  const loadDashboardData = async () => {
    if (!currentUser) return;
    setLoading(true);
    setError('');
    try {
      const [mineRes, claimsRes, notifRes, matchesRes] = await Promise.all([
        apiFetch<{ items: Item[] }>('/api/items?mine=1'),
        apiFetch<{ claims: ClaimRecord[] }>('/api/claims'),
        apiFetch<{ notifications: NotificationRecord[] }>('/api/notifications'),
        apiFetch<{ matches: MatchRecord[] }>('/api/matches'),
      ]);
      setMyItems(mineRes.items);
      setClaims(claimsRes.claims);
      setNotifications(notifRes.notifications);
      setMatches(matchesRes.matches);

      if (currentUser.role === 'admin') {
        const [allRes, adminRes] = await Promise.all([
          apiFetch<{ items: Item[] }>('/api/items'),
          apiFetch<{ users: User[] }>('/api/admin/overview'),
        ]);
        setAllItems(allRes.items);
        setAdminUsers(adminRes.users);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load dashboard data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, [currentUser]);

  if (!currentUser) {
    return (
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-center">
        <div className="bg-white border border-slate-200 rounded-xl p-10">
          <h1 className="text-2xl font-bold text-slate-900">Campus Workspace Dashboard</h1>
          <p className="text-sm text-slate-600 mt-2 max-w-md mx-auto">
            Sign in with your Google account or campus OTP credentials to manage your lost &amp; found reports, claim status, and Gmail/Sheets integrations.
          </p>
          <button
            type="button"
            onClick={onRequireAuth}
            className="mt-6 px-5 py-2.5 bg-blue-800 hover:bg-blue-900 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Sign In to Dashboard
          </button>
        </div>
      </section>
    );
  }

  const unreadCount = notifications.filter((n) => !n.is_read).length;
  const hasGoogleToken = Boolean(getGoogleAccessToken()) || googleConnected;

  const handleMarkNotificationsRead = async () => {
    await apiFetch('/api/notifications/read', { method: 'PATCH' });
    await loadDashboardData();
  };

  const handleUpdateClaimStatus = async (
    claimId: number,
    status: ClaimRecord['status'],
    notes?: string
  ) => {
    setFeedback('');
    setError('');
    try {
      await apiFetch(`/api/claims/${claimId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, admin_notes: notes || '' }),
      });
      setFeedback(`Claim #${claimId} updated to ${status}.`);
      await loadDashboardData();
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update claim.');
    }
  };

  const handleDeleteItem = async (item: Item) => {
    setError('');
    try {
      await apiFetch(`/api/items/${item.id}`, { method: 'DELETE' });
      setFeedback(`Removed report "${item.title}".`);
      await loadDashboardData();
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete report.');
    }
  };

  const handleToggleUserRole = async (targetUser: User) => {
    const nextRole = targetUser.role === 'admin' ? 'student' : 'admin';
    try {
      await apiFetch(`/api/admin/users/${targetUser.id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role: nextRole }),
      });
      setFeedback(`Updated ${targetUser.name} role to ${nextRole}.`);
      await loadDashboardData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user role.');
    }
  };

  const handleFetchGmail = async () => {
    setError('');
    setFeedback('');
    try {
      const data = await apiFetch<{ messages: GmailMessage[] }>(
        '/api/workspace/gmail/messages',
        {},
        true
      );
      setGmailMessages(data.messages);
      setFeedback(`Loaded ${data.messages.length} recent Gmail messages.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to fetch Gmail inbox.');
    }
  };

  const triggerSendGmailConfirm = (to: string, subject: string, body: string) => {
    if (!hasGoogleToken) {
      onRequireAuth();
      return;
    }
    onRequestConfirm({
      title: 'Send Email via Gmail?',
      actionLabel: 'Send Email',
      description:
        'This will send an email directly from your connected Google account via Gmail.',
      details: [
        { label: 'Recipient', value: to },
        { label: 'Subject', value: subject },
        { label: 'Message Preview', value: body.slice(0, 120) + (body.length > 120 ? '...' : '') },
      ],
      onConfirm: async () => {
        setError('');
        setFeedback('');
        try {
          await apiFetch(
            '/api/workspace/gmail/send',
            {
              method: 'POST',
              body: JSON.stringify({ to, subject, body }),
            },
            true
          );
          setFeedback(`Email sent via Gmail to ${to}.`);
          setGmailBody('');
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to send Gmail alert.');
        }
      },
    });
  };

  const triggerExportSheetsConfirm = () => {
    if (!hasGoogleToken) {
      onRequireAuth();
      return;
    }
    onRequestConfirm({
      title: sheetIdInput.trim()
        ? 'Update Existing Google Sheet?'
        : 'Create New Google Sheets Recovery Log?',
      actionLabel: sheetIdInput.trim() ? 'Update Spreadsheet' : 'Create & Export Sheet',
      description:
        'This will write all live campus Lost & Found item records and Ownership Claims into Google Sheets.',
      details: [
        {
          label: 'Target',
          value: sheetIdInput.trim()
            ? `Spreadsheet ID: ${sheetIdInput.trim()}`
            : 'New Google Spreadsheet in your Drive',
        },
        {
          label: 'Records Included',
          value: `${stats?.total_items ?? allItems.length} item reports · ${claims.length} claims`,
        },
      ],
      onConfirm: async () => {
        setError('');
        setFeedback('');
        try {
          const res = await apiFetch<{
            spreadsheetId: string;
            spreadsheetUrl: string;
            exportedItems: number;
            exportedClaims: number;
          }>(
            '/api/workspace/sheets/export',
            {
              method: 'POST',
              body: JSON.stringify({ spreadsheetId: sheetIdInput.trim() || undefined }),
            },
            true
          );
          setSheetIdInput(res.spreadsheetId);
          setExportedSheetUrl(res.spreadsheetUrl);
          setFeedback(
            `Synced ${res.exportedItems} items and ${res.exportedClaims} claims to Google Sheets.`
          );
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to export to Google Sheets.');
        }
      },
    });
  };

  const handleReadSheet = async () => {
    if (!sheetIdInput.trim()) {
      setError('Enter a Google Spreadsheet ID (or create one first) to inspect rows.');
      return;
    }
    setError('');
    try {
      const data = await apiFetch<{
        title: string;
        activeSheet: string;
        sheetNames: string[];
        rows: string[][];
      }>(`/api/workspace/sheets/read?spreadsheetId=${encodeURIComponent(sheetIdInput.trim())}`, {}, true);
      setSheetPreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to read Google Sheet.');
    }
  };

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-200">
        <div>
          <p className="text-xs font-medium text-slate-500">
            {currentUser.role === 'admin' ? 'Administrator Management Console' : 'Student Portal'} ·{' '}
            {currentUser.email}
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 mt-1">
            Welcome back, {currentUser.name}
          </h1>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
          <button
            type="button"
            onClick={() => setTab('overview')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              tab === 'overview'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            My Reports &amp; Alerts
          </button>
          <button
            type="button"
            onClick={() => setTab('claims')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              tab === 'claims'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Claims ({claims.length})
          </button>
          {currentUser.role === 'admin' && (
            <button
              type="button"
              onClick={() => setTab('admin')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                tab === 'admin'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Admin Controls
            </button>
          )}
          <button
            type="button"
            onClick={() => setTab('workspace')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              tab === 'workspace'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Gmail &amp; Sheets
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          {error}
        </div>
      )}
      {feedback && (
        <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
          {feedback}
        </div>
      )}

      {/* TAB 1: Overview */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-7 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">
                My Submitted Reports ({myItems.length})
              </h2>
              <button
                type="button"
                onClick={loadDashboardData}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>

            {myItems.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
                You have not submitted any lost or found reports yet.
              </div>
            ) : (
              <div className="space-y-3">
                {myItems.map((it) => (
                  <div
                    key={it.id}
                    className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-4"
                  >
                    <div className="w-20 h-16 rounded-lg overflow-hidden bg-slate-100 border border-slate-200 shrink-0">
                      <ItemImageFrame
                        src={it.images[0]?.url}
                        alt={it.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-slate-500 flex items-center gap-2">
                        <span className="font-semibold text-slate-800">
                          {it.type === 'lost' ? 'Lost' : 'Found'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{it.status}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{it.item_date}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onSelectItem(it.id)}
                        className="text-sm font-semibold text-slate-900 hover:text-blue-800 truncate block mt-0.5 text-left"
                      >
                        {it.title}
                      </button>
                      <p className="text-xs text-slate-500 truncate">{it.location}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteItem(it)}
                      aria-label={`Delete ${it.title}`}
                      className="p-2 text-slate-400 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <Bell className="w-4 h-4 text-blue-800" />
                <span>Notifications ({unreadCount} unread)</span>
              </h2>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkNotificationsRead}
                  className="text-xs font-medium text-blue-800 hover:underline"
                >
                  Mark all read
                </button>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
              {notifications.length === 0 ? (
                <p className="p-6 text-xs text-slate-500 text-center">No notifications yet.</p>
              ) : (
                notifications.map((n) => (
                  <div key={n.id} className={`p-4 ${n.is_read ? 'opacity-70' : 'bg-blue-50/40'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-900">{n.title}</span>
                      <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                        {n.created_at.slice(0, 10)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed">{n.message}</p>
                    {n.related_item_id && (
                      <button
                        type="button"
                        onClick={() => onSelectItem(n.related_item_id!)}
                        className="text-xs font-medium text-blue-800 hover:underline mt-2"
                      >
                        Inspect related item
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Claims */}
      {tab === 'claims' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">
            Ownership Claims &amp; Verification Progress
          </h2>
          {claims.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
              No ownership claims submitted yet. Open any item detail view to submit a claim.
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 bg-slate-50">
                    <th className="py-3 px-4">Item</th>
                    <th className="py-3 px-4">Claimant</th>
                    <th className="py-3 px-4">Ownership Proof</th>
                    <th className="py-3 px-4">Status</th>
                    {currentUser.role === 'admin' && <th className="py-3 px-4 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {claims.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50/70">
                      <td className="py-3.5 px-4">
                        <button
                          type="button"
                          onClick={() => onSelectItem(c.item_id)}
                          className="font-medium text-slate-900 hover:text-blue-800 text-left"
                        >
                          {c.item_title || `Item #${c.item_id}`}
                        </button>
                        <div className="text-xs text-slate-500">{c.item_location}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-slate-900">{c.claimant_name}</div>
                        <div className="text-xs text-slate-500">{c.claimant_email}</div>
                      </td>
                      <td className="py-3.5 px-4 max-w-xs">
                        <p className="text-xs text-slate-700 line-clamp-2">{c.proof_description}</p>
                        {c.admin_notes && (
                          <p className="text-[11px] text-slate-500 mt-1">Note: {c.admin_notes}</p>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`text-xs font-semibold ${
                            c.status === 'Recovered' || c.status === 'Approved'
                              ? 'text-emerald-700'
                              : c.status === 'Rejected'
                                ? 'text-red-600'
                                : 'text-amber-700'
                          }`}
                        >
                          {c.status}
                        </span>
                      </td>
                      {currentUser.role === 'admin' && (
                        <td className="py-3.5 px-4 text-right space-x-2 whitespace-nowrap">
                          <select
                            aria-label={`Update status for claim ${c.id}`}
                            value={c.status}
                            onChange={(e) =>
                              handleUpdateClaimStatus(
                                c.id,
                                e.target.value as ClaimRecord['status']
                              )
                            }
                            className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                          >
                            <option value="Pending">Pending</option>
                            <option value="Under Verification">Under Verification</option>
                            <option value="Approved">Approved</option>
                            <option value="Rejected">Rejected</option>
                            <option value="Recovered">Recovered</option>
                          </select>
                          <button
                            type="button"
                            onClick={() =>
                              triggerSendGmailConfirm(
                                c.claimant_email,
                                `Reclaim It Claim Update: ${c.item_title || `Item #${c.item_id}`}`,
                                `Hello ${c.claimant_name},\n\nYour ownership claim (#${c.id}) for "${c.item_title}" is currently marked: ${c.status}.\n\nPlease bring your student ID to the Campus Lost & Found Desk (Phone: 7397631012) if verification is requested.\n\nRegards,\nReclaim It Campus Desk`
                              )
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-800 border border-blue-200 bg-blue-50 hover:bg-blue-100 rounded-md"
                          >
                            <Mail className="w-3 h-3" />
                            <span>Gmail</span>
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: Admin Controls */}
      {tab === 'admin' && currentUser.role === 'admin' && (
        <div className="space-y-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs text-slate-500">Total Reports</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                {stats?.total_items ?? allItems.length}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs text-slate-500">Items Recovered</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
                {stats?.recovered_count ?? 0}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs text-slate-500">Open Claims</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-amber-700 mt-1">
                {stats?.open_claims ?? 0}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs text-slate-500">Active Match Pairs</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-blue-800 mt-1">
                {matches.filter((m) => m.status !== 'Dismissed').length}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* All Campus Items Management */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">
                  Manage Campus Reports &amp; Photos ({allItems.length})
                </h3>
              </div>
              <div className="divide-y divide-slate-100 max-h-[380px] overflow-y-auto">
                {allItems.map((it) => (
                  <div key={it.id} className="p-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-12 h-10 rounded overflow-hidden bg-slate-100 shrink-0">
                        <ItemImageFrame
                          src={it.images[0]?.url}
                          alt={it.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => onSelectItem(it.id)}
                          className="text-sm font-medium text-slate-900 hover:text-blue-800 truncate block text-left"
                        >
                          {it.title}
                        </button>
                        <p className="text-xs text-slate-500">
                          {it.type.toUpperCase()} · {it.status} · {it.images.length} photo(s)
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteItem(it)}
                      aria-label={`Delete report ${it.title}`}
                      className="p-1.5 text-slate-400 hover:text-red-600 shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Campus Users & Roles */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-blue-800" />
                  <span>Campus Users &amp; Roles ({adminUsers.length})</span>
                </h3>
              </div>
              <div className="divide-y divide-slate-100 max-h-[380px] overflow-y-auto">
                {adminUsers.map((u) => (
                  <div key={u.id} className="p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{u.name}</p>
                      <p className="text-xs text-slate-500 truncate">
                        {u.email} · {u.auth_provider === 'google' ? 'Google OAuth' : 'OTP Local'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleUserRole(u)}
                      disabled={u.id === currentUser.id}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
                    >
                      Role: {u.role}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Gmail & Google Sheets Workspace */}
      {tab === 'workspace' && (
        <div className="space-y-8">
          {!hasGoogleToken && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Connect Google Workspace for Gmail &amp; Google Sheets
                </h3>
                <p className="text-xs text-slate-600 mt-1">
                  Sign in with Google to authorize Gmail claim alerts and live Google Sheets campus recovery logs.
                </p>
              </div>
              <button
                type="button"
                onClick={onRequireAuth}
                className="px-4 py-2.5 bg-blue-800 hover:bg-blue-900 text-white text-sm font-medium rounded-lg whitespace-nowrap shrink-0"
              >
                Sign in with Google
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Gmail Panel */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                    <Mail className="w-4 h-4 text-blue-800" />
                    <span>Gmail Notification Dispatch &amp; Inbox</span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Send verified match/claim emails or read recent correspondence.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleFetchGmail}
                  disabled={!hasGoogleToken}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
                >
                  Load Inbox
                </button>
              </div>

              <div className="space-y-3 pt-2 border-t border-slate-100">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Recipient Email
                  </label>
                  <input
                    type="email"
                    value={gmailTo}
                    onChange={(e) => setGmailTo(e.target.value)}
                    placeholder="student@campus.edu"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Subject</label>
                  <input
                    type="text"
                    value={gmailSubject}
                    onChange={(e) => setGmailSubject(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Message</label>
                  <textarea
                    rows={3}
                    value={gmailBody}
                    onChange={(e) => setGmailBody(e.target.value)}
                    placeholder="Write match or pickup verification instructions..."
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <button
                  type="button"
                  disabled={!gmailTo.trim() || !gmailBody.trim()}
                  onClick={() => triggerSendGmailConfirm(gmailTo, gmailSubject, gmailBody)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-800 hover:bg-blue-900 text-white text-xs font-medium rounded-lg disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Review &amp; Send via Gmail</span>
                </button>
              </div>

              {gmailMessages.length > 0 && (
                <div className="pt-4 border-t border-slate-200 space-y-2.5 max-h-60 overflow-y-auto">
                  {gmailMessages.map((msg) => (
                    <div key={msg.id} className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                      <p className="text-xs font-semibold text-slate-900 truncate">{msg.subject}</p>
                      <p className="text-[11px] text-slate-500 truncate mt-0.5">{msg.from}</p>
                      <p className="text-xs text-slate-600 mt-1 line-clamp-2">{msg.snippet}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Google Sheets Panel */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div>
                <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                  <span>Google Sheets Recovery Ledger</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Export live Lost &amp; Found item logs and Ownership Claims to Google Sheets, or inspect an existing spreadsheet.
                </p>
              </div>

              <div className="space-y-3 pt-2 border-t border-slate-100">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Spreadsheet ID (Optional — leave blank to create a new sheet)
                  </label>
                  <input
                    type="text"
                    value={sheetIdInput}
                    onChange={(e) => setSheetIdInput(e.target.value)}
                    placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={triggerExportSheetsConfirm}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium rounded-lg whitespace-nowrap"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Sync Recovery Log to Sheets</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleReadSheet}
                    disabled={!hasGoogleToken || !sheetIdInput.trim()}
                    className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
                  >
                    Read Sheet Preview
                  </button>
                  {exportedSheetUrl && (
                    <a
                      href={exportedSheetUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-800 hover:underline"
                    >
                      <span>Open Sheet</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </div>

              {sheetPreview && (
                <div className="pt-4 border-t border-slate-200">
                  <p className="text-xs font-semibold text-slate-900 mb-2">
                    {sheetPreview.title} — Tab: {sheetPreview.activeSheet}
                  </p>
                  <div className="border border-slate-200 rounded-lg overflow-x-auto max-h-60">
                    <table className="w-full text-left text-xs border-collapse">
                      <tbody>
                        {sheetPreview.rows.slice(0, 12).map((row, rIdx) => (
                          <tr
                            key={rIdx}
                            className={
                              rIdx === 0 ? 'bg-slate-100 font-semibold text-slate-800' : 'border-t border-slate-100'
                            }
                          >
                            {row.map((cell, cIdx) => (
                              <td key={cIdx} className="px-2.5 py-1.5 whitespace-nowrap">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
