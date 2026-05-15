import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BadgeCheck,
  CheckCircle2,
  ChevronRight,
  Download,
  FileCheck2,
  FileSearch,
  FileText,
  Inbox,
  LayoutDashboard,
  LogOut,
  MapPinned,
  Search,
  Shield,
  Trash2,
  Upload,
  UserCircle,
  X,
  XCircle,
} from 'lucide-react';

const sampleClaims = [
  {
    id: 1,
    status: 'Pending Review',
    priority: 'High',
    plateNumber: 'NSW-482QH',
    driverName: 'Liam Parker',
    dateOfIncident: '2026-04-18',
    submittedAt: '2026-04-19',
    summary: 'Rear-end collision at Marrickville roundabout during wet conditions.',
    caseFiles: [],
    quoteOptions: [
      { id: 'q1', supplier: 'Northside Panels', amount: 4850, reference: 'NSP-2026-041' },
      { id: 'q2', supplier: 'Eastern Smash Repairs', amount: 5120, reference: 'ESS-8841' },
    ],
    primaryQuoteId: null,
    finalQuoteId: null,
    data: {
      memberVehicle: { ownerName: 'Ava Parker', plateNumber: 'NSW-482QH', make: 'Toyota', model: 'Camry' },
      incident: { suburb: 'Marrickville', roadSurface: 'Wet', description: 'Rear-end collision at roundabout.' },
      otherParties: [{ plateNumber: 'NSW-551JJ', driverName: 'Mark Dalton' }],
    },
  },
  {
    id: 2,
    status: 'Approved',
    priority: 'Normal',
    plateNumber: 'NSW-170BK',
    driverName: 'Chloe Bennett',
    dateOfIncident: '2026-04-15',
    submittedAt: '2026-04-16',
    summary: 'Side impact while merging near airport access road.',
    caseFiles: [],
    quoteOptions: [
      { id: 'q1', supplier: 'Airport Collision Centre', amount: 3920, reference: 'ACC-7721' },
      { id: 'q2', supplier: 'Mascot Auto Refinish', amount: 4100, reference: 'MAR-1192' },
    ],
    primaryQuoteId: 'q1',
    finalQuoteId: 'q1',
    data: {
      memberVehicle: { ownerName: 'Chloe Bennett', plateNumber: 'NSW-170BK', make: 'Mazda', model: 'CX-5' },
      incident: { suburb: 'Mascot', roadSurface: 'Dry', description: 'Collision while merging.' },
      otherParties: [{ plateNumber: 'NSW-992PL', driverName: 'Sonia Blair' }],
    },
  },
  {
    id: 3,
    status: 'Rejected',
    priority: 'Needs Docs',
    plateNumber: 'NSW-935TR',
    driverName: 'Noah Carter',
    dateOfIncident: '2026-04-11',
    submittedAt: '2026-04-12',
    summary: 'Incomplete supporting documents and inconsistent incident notes.',
    caseFiles: [],
    quoteOptions: [
      { id: 'q1', supplier: 'Tempe Workshop Co.', amount: 2280, reference: 'TWC-3301' },
      { id: 'q2', supplier: 'Inner West Smash', amount: 2650, reference: 'IWS-902' },
    ],
    primaryQuoteId: 'q2',
    finalQuoteId: null,
    data: {
      memberVehicle: { ownerName: 'Noah Carter', plateNumber: 'NSW-935TR', make: 'Hyundai', model: 'i30' },
      incident: { suburb: 'Tempe', roadSurface: 'Loose', description: 'Claim could not be validated.' },
      otherParties: [],
    },
  },
];

const CLAIMS_OVERRIDES_KEY = 'horizon_admin_claims_overrides_v1';

function readClaimsOverrides() {
  try {
    const raw = localStorage.getItem(CLAIMS_OVERRIDES_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function mergeClaimsWithOverrides(sample, overrides) {
  if (!overrides) return sample.map((c) => ({ ...c, data: { ...c.data } }));
  return sample.map((claim) => {
    const ov = overrides[String(claim.id)] ?? overrides[claim.id];
    if (!ov || typeof ov !== 'object') return { ...claim, data: { ...claim.data } };
    return {
      ...claim,
      status: ov.status ?? claim.status,
      caseFiles: Array.isArray(ov.caseFiles) ? ov.caseFiles : (claim.caseFiles ?? []),
      primaryQuoteId: ov.primaryQuoteId !== undefined ? ov.primaryQuoteId : claim.primaryQuoteId,
      finalQuoteId: ov.finalQuoteId !== undefined ? ov.finalQuoteId : claim.finalQuoteId,
      quoteOptions:
        Array.isArray(ov.quoteOptions) && ov.quoteOptions.length ? ov.quoteOptions : claim.quoteOptions,
      data: { ...(claim.data ?? {}), ...(ov.data ?? {}) },
    };
  });
}

const detailFields = [
  { label: 'Owner', getter: (data) => data.memberVehicle?.ownerName },
  { label: 'Vehicle', getter: (data) => [data.memberVehicle?.make, data.memberVehicle?.model].filter(Boolean).join(' ') },
  { label: 'Suburb', getter: (data) => data.incident?.suburb },
  { label: 'Road Surface', getter: (data) => data.incident?.roadSurface },
  { label: 'Other Parties', getter: (data) => (data.otherParties?.length ?? 0).toString() },
];

const queueHighlights = [
  {
    title: 'Review posture',
    text: 'Prioritize incomplete claims first, then move to liability confirmation and workshop intake.',
  },
  {
    title: 'Operational workflow',
    text: 'Open a claim, validate details, request documents if needed, then approve or reject.',
  },
  {
    title: 'Export handoff',
    text: 'Use the export action when a printable summary is needed for insurers or workshop files.',
  },
];

const STATUS_OPTIONS = ['All', 'Pending Review', 'Approved', 'Rejected'];

const MODAL_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'records', label: 'Vehicle & incident' },
  { id: 'parties', label: 'Parties & witnesses' },
  { id: 'quotes', label: 'Quotes & PDFs' },
];

const AUTH_STORAGE_KEY = 'horizon_admin_session';

/** Demo accounts — replace with real API auth. Passwords are for local UI only. */
const DEMO_ACCOUNTS = [
  { email: 'admin@horizon.smash', password: 'admin123', role: 'admin', displayName: 'Alex Rivera' },
  { email: 'moderator@horizon.smash', password: 'mod123', role: 'moderator', displayName: 'Jordan Lee' },
];

const ROLE_OPTIONS = [
  { id: 'admin', label: 'Administrator', icon: Shield },
  { id: 'moderator', label: 'Moderator', icon: UserCircle },
];

function readStoredSession() {
  try {
    const raw = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.email || (data.role !== 'admin' && data.role !== 'moderator')) return null;
    return { email: data.email, displayName: data.displayName || data.email, role: data.role };
  } catch {
    return null;
  }
}

function initialsFromName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts[0]?.length >= 2) return parts[0].slice(0, 2).toUpperCase();
  return '??';
}

function claimRef(id) {
  return `HRZ-${String(id).padStart(5, '0')}`;
}

function shareOfTotal(part, total) {
  if (!total) return '0';
  return Math.round((part / total) * 100).toString();
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('read failed'));
    fr.readAsDataURL(file);
  });
}

async function fileToCaseFile(file) {
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const dataUrl = await readFileAsDataUrl(file);
  if (!String(dataUrl).startsWith('data:application/pdf')) {
    throw new Error('Not a PDF');
  }
  return {
    id,
    name: file.name || 'document.pdf',
    size: file.size,
    uploadedAt: new Date().toISOString().slice(0, 10),
    dataUrl,
    url: dataUrl,
  };
}

function formatAud(amount) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(
    amount ?? 0,
  );
}

function LoginScreen({ onLoggedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    const normalized = email.trim().toLowerCase();
    const account = DEMO_ACCOUNTS.find((a) => a.email === normalized && a.password === password);
    if (!account) {
      setError('Email or password is not valid for this workspace.');
      return;
    }
    const session = { email: account.email, displayName: account.displayName, role: account.role };
    sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
    onLoggedIn(session);
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-mesh-dark px-4 py-12 text-zinc-100">
      <div className="pointer-events-none absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%2240%22%20height=%2240%22%3E%3Cpath%20d=%22M0%2040h40M40%200v40%22%20fill=%22none%22%20stroke=%22%23fff%22%20stroke-opacity=%22.03%22%20stroke-width=%221%22/%3E%3C/svg%3E')]" aria-hidden />
      <div className="relative w-full max-w-[440px]">
        <div className="absolute -inset-px rounded-2xl bg-gradient-to-b from-white/15 to-white/5 opacity-60 blur-sm" aria-hidden />
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/40 p-8 shadow-sheet-lg backdrop-blur-2xl sm:p-10">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-400 to-violet-600 text-lg font-bold tracking-tight text-white shadow-glow">
                H
              </div>
              <div>
                <p className="font-display text-xl font-semibold tracking-tight text-white">Horizon Smash</p>
                <p className="mt-0.5 text-2xs font-medium uppercase tracking-[0.2em] text-zinc-500">Repairs · Console</p>
              </div>
            </div>
          </div>
          <p className="mt-8 text-sm leading-relaxed text-zinc-400">
            Sign in to the operations console. Your account role determines whether you can change claim disposition or
            review records read-only.
          </p>
          <form className="mt-8 space-y-5" onSubmit={handleSubmit} noValidate>
            <div>
              <label htmlFor="horizon-email" className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">
                Work email
              </label>
              <input
                id="horizon-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                className="mt-2 h-11 w-full rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-3.5 text-sm text-zinc-100 shadow-inner outline-none ring-indigo-500/0 transition placeholder:text-zinc-600 focus:border-indigo-500/80 focus:ring-2 focus:ring-indigo-500/25"
                placeholder="name@company.com"
                required
              />
            </div>
            <div>
              <label htmlFor="horizon-password" className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">
                Password
              </label>
              <input
                id="horizon-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
                className="mt-2 h-11 w-full rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-3.5 text-sm text-zinc-100 shadow-inner outline-none transition placeholder:text-zinc-600 focus:border-indigo-500/80 focus:ring-2 focus:ring-indigo-500/25"
                placeholder="••••••••"
                required
              />
            </div>
            {error && (
              <p className="rounded-lg border border-rose-500/30 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">{error}</p>
            )}
            <button
              type="submit"
              className="group relative h-11 w-full overflow-hidden rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 text-sm font-semibold text-white shadow-lg shadow-indigo-950/40 transition hover:from-indigo-400 hover:to-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
            >
              <span className="relative z-10">Continue to workspace</span>
              <span className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent opacity-0 transition group-hover:opacity-100" aria-hidden />
            </button>
          </form>
          <div className="mt-8 rounded-xl border border-white/5 bg-zinc-950/50 px-4 py-3">
            <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Demo access</p>
            <p className="mt-2 font-mono text-2xs leading-relaxed text-zinc-500">
              <span className="text-zinc-400">Admin</span> admin@horizon.smash · admin123
              <br />
              <span className="text-zinc-400">Moderator</span> moderator@horizon.smash · mod123
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [session, setSession] = useState(readStoredSession);
  const [claims, setClaims] = useState(() => mergeClaimsWithOverrides(sampleClaims, readClaimsOverrides()));
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClaim, setSelectedClaim] = useState(null);
  const [statusFilter, setStatusFilter] = useState('All');

  useEffect(() => {
    if (!selectedClaim) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setSelectedClaim(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedClaim]);

  useEffect(() => {
    try {
      const overrides = {};
      claims.forEach((c) => {
        overrides[c.id] = {
          status: c.status,
          caseFiles: c.caseFiles ?? [],
          primaryQuoteId: c.primaryQuoteId ?? null,
          finalQuoteId: c.finalQuoteId ?? null,
          quoteOptions: c.quoteOptions,
        };
      });
      localStorage.setItem(CLAIMS_OVERRIDES_KEY, JSON.stringify(overrides));
    } catch (e) {
      console.warn('Could not persist claims to local storage', e);
    }
  }, [claims]);

  const metrics = useMemo(() => {
    const pending = claims.filter((item) => item.status === 'Pending Review').length;
    const approved = claims.filter((item) => item.status === 'Approved').length;
    const rejected = claims.filter((item) => item.status === 'Rejected').length;
    return { total: claims.length, pending, approved, rejected };
  }, [claims]);

  const filteredClaims = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return claims.filter((item) => {
      const matchesStatus = statusFilter === 'All' ? true : item.status === statusFilter;
      const matchesQuery = !query
        ? true
        : [item.plateNumber, item.driverName, item.dateOfIncident, item.status, item.priority]
            .filter(Boolean)
            .some((value) => value.toLowerCase().includes(query));
      return matchesStatus && matchesQuery;
    });
  }, [claims, searchTerm, statusFilter]);

  if (!session) {
    return <LoginScreen onLoggedIn={setSession} />;
  }

  const updateClaimStatus = (id, status) => {
    setClaims((current) => current.map((item) => (item.id === id ? { ...item, status } : item)));
    setSelectedClaim((current) => (current && current.id === id ? { ...current, status } : current));
  };

  const patchClaim = (id, partialOrFn) => {
    const applyMerge = (prev) => {
      if (!prev || prev.id !== id) return prev;
      return typeof partialOrFn === 'function'
        ? { ...prev, ...partialOrFn(prev) }
        : { ...prev, ...partialOrFn };
    };
    setClaims((current) => current.map((item) => applyMerge(item)));
    setSelectedClaim((current) => applyMerge(current));
  };

  const exportClaimToPdf = (item) => {
    const printable = window.open('', '_blank', 'width=960,height=720');
    if (!printable) return;

    const data = item.data ?? {};
    const otherParties = data.otherParties ?? [];
    const caseFiles = item.caseFiles ?? [];
    const quoteOptions = item.quoteOptions ?? [];
    const primaryQuote = quoteOptions.find((q) => q.id === item.primaryQuoteId);
    const finalQuote = quoteOptions.find((q) => q.id === item.finalQuoteId);
    const pdfList =
      caseFiles.length > 0
        ? caseFiles.map((f) => `${f.name} (${f.uploadedAt})`).join('<br/>')
        : 'No PDFs attached in this workspace snapshot.';
    const quoteSummary = `
      <p><strong>Primary quote:</strong> ${
        primaryQuote
          ? `${primaryQuote.supplier} — ${primaryQuote.reference} (${formatAud(primaryQuote.amount)})`
          : 'Not selected'
      }</p>
      <p><strong>Final quote:</strong> ${
        finalQuote
          ? `${finalQuote.supplier} — ${finalQuote.reference} (${formatAud(finalQuote.amount)})`
          : 'Not set'
      }</p>
    `;
    const damageMarkerCount = data.damage?.points
      ? Object.values(data.damage.points).reduce((count, list) => count + list.length, 0)
      : 0;
    const vehicleSummary = [data.memberVehicle?.make, data.memberVehicle?.model].filter(Boolean).join(' ') || 'Not provided';
    const trafficControls = data.incident?.trafficControls?.join(', ') || 'Not provided';
    const otherPartySummary = otherParties.length
      ? otherParties
          .map((party, index) => `Vehicle ${index + 1}: ${party.plateNumber || 'No plate'} - ${party.driverName || 'No driver name'}`)
          .join('<br/>')
      : 'No other party records attached.';

    printable.document.write(`
      <html>
        <head>
          <title>Claim ${item.plateNumber}</title>
          <style>
            body { font-family: Inter, system-ui, sans-serif; padding: 40px; color: #0f172a; line-height: 1.55; font-size: 14px; }
            h1 { font-size: 18px; font-weight: 600; margin: 0 0 4px; letter-spacing: -0.02em; }
            .ref { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 20px; }
            .meta { margin-bottom: 24px; color: #475569; font-size: 13px; }
            .section { margin-top: 24px; }
            .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
            .card { background: #f8fafc; border: 1px solid #e2e8f0; padding: 14px 16px; border-radius: 6px; }
            .label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; }
            .value { margin-top: 8px; font-size: 14px; color: #0f172a; }
          </style>
        </head>
        <body>
          <h1>Horizon Smash Repairs Claim Export</h1>
          <div class="ref">${claimRef(item.id)}</div>
          <div class="meta">
            <p><strong>Plate:</strong> ${item.plateNumber}</p>
            <p><strong>Driver:</strong> ${item.driverName}</p>
            <p><strong>Status:</strong> ${item.status}</p>
            <p><strong>Incident Date:</strong> ${item.dateOfIncident}</p>
          </div>
          <div class="section grid">
            <div class="card"><div class="label">Owner</div><div class="value">${data.memberVehicle?.ownerName || 'Not provided'}</div></div>
            <div class="card"><div class="label">Vehicle</div><div class="value">${vehicleSummary}</div></div>
            <div class="card"><div class="label">Suburb</div><div class="value">${data.incident?.suburb || 'Not provided'}</div></div>
            <div class="card"><div class="label">Road Surface</div><div class="value">${data.incident?.roadSurface || 'Not provided'}</div></div>
            <div class="card"><div class="label">Traffic Controls</div><div class="value">${trafficControls}</div></div>
            <div class="card"><div class="label">Damage Markers</div><div class="value">${damageMarkerCount}</div></div>
          </div>
          <div class="section">
            <div class="card">
              <div class="label">Claim Summary</div>
              <div class="value">${data.incident?.description || item.summary}</div>
            </div>
          </div>
          <div class="section">
            <div class="card">
              <div class="label">Quotes</div>
              <div class="value">${quoteSummary}</div>
            </div>
          </div>
          <div class="section">
            <div class="card">
              <div class="label">PDF attachments (names)</div>
              <div class="value">${pdfList}</div>
            </div>
          </div>
        </body>
      </html>
    `);
    printable.document.close();
    printable.focus();
    printable.print();
  };

  const openRow = (item) => setSelectedClaim(item);
  const t = metrics.total;
  const roleMeta = ROLE_OPTIONS.find((r) => r.id === session.role) ?? ROLE_OPTIONS[0];
  const userInitials = initialsFromName(session.displayName);
  const isModerator = session.role === 'moderator';

  const logout = () => {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    setSession(null);
    setSelectedClaim(null);
  };

  return (
    <div className="min-h-screen bg-mesh-app font-sans text-zinc-900 antialiased">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="relative flex w-full flex-col border-b border-zinc-800/90 bg-zinc-950 text-zinc-100 shadow-[4px_0_24px_-8px_rgba(0,0,0,0.25)] lg:w-[236px] lg:shrink-0 lg:border-b-0 lg:border-r lg:border-zinc-800/90">
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_100%_60%_at_0%_0%,rgba(99,102,241,0.12),transparent_50%)] opacity-90"
            aria-hidden
          />
          <div className="relative flex h-14 items-center gap-3 border-b border-zinc-800/80 px-4 lg:h-[56px] lg:px-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-400 to-violet-600 text-sm font-bold tracking-tight text-white shadow-glow">
              H
            </div>
            <div className="min-w-0 leading-tight">
              <p className="font-display truncate text-[15px] font-semibold tracking-tight text-white">Horizon Smash</p>
              <p className="truncate text-2xs font-medium uppercase tracking-[0.18em] text-zinc-500">
                Repairs · {isModerator ? 'Moderator' : 'Administrator'}
              </p>
            </div>
          </div>

          <nav className="relative flex flex-1 flex-col gap-4 overflow-y-auto scrollbar-thin p-2 lg:py-4">
            <div>
              <p className="px-2.5 pb-2 text-2xs font-semibold uppercase tracking-wider text-zinc-500">Workspace</p>
              <div
                className="flex items-center gap-2.5 rounded-xl bg-zinc-800/80 px-3 py-2.5 text-[13px] font-medium text-white shadow-lift ring-1 ring-white/10"
                aria-current="page"
              >
                <Inbox className="h-4 w-4 shrink-0 text-indigo-300" strokeWidth={2} />
                <span>Claims queue</span>
              </div>
            </div>
          </nav>

          <div className="relative border-t border-zinc-800/90 p-3">
            <div className="flex items-center gap-2.5 rounded-xl border border-zinc-800/80 bg-zinc-900/60 px-2.5 py-2.5 shadow-inner">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-800 font-mono text-2xs font-semibold text-zinc-300 ring-1 ring-zinc-700/80">
                {userInitials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-2xs font-semibold text-zinc-100">{session.displayName}</p>
                <p className="truncate text-2xs text-zinc-500">{roleMeta.label}</p>
                <p className="truncate font-mono text-[10px] text-zinc-600">{session.email}</p>
              </div>
              <button
                type="button"
                onClick={logout}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-700/90 text-zinc-400 transition hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/80"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 border-b border-zinc-200/80 bg-white/70 shadow-lift backdrop-blur-xl supports-[backdrop-filter]:bg-white/55">
            <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-5 lg:px-8">
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-2xs text-zinc-500 sm:gap-3">
                <span className="hidden font-semibold uppercase tracking-wider text-zinc-400 sm:inline">Operations</span>
                <ChevronRight className="hidden h-3 w-3 shrink-0 text-zinc-300 sm:inline" aria-hidden />
                <span className="truncate font-medium text-zinc-800">Claims queue</span>
                <span className="hidden h-3 w-px shrink-0 bg-zinc-200 sm:inline" aria-hidden />
                <span className="hidden truncate text-zinc-500 sm:inline">Review and disposition</span>
                <span className="rounded-lg border border-zinc-200/90 bg-zinc-50 px-2 py-0.5 font-medium text-zinc-800 shadow-sm">
                  {roleMeta.label}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="hidden rounded-lg border border-zinc-200/90 bg-white px-2 py-0.5 font-mono text-2xs font-medium text-zinc-600 shadow-sm sm:inline">
                  {new Date().toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })}
                </span>
                <span className="rounded-lg border border-emerald-200/90 bg-emerald-50 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-emerald-900 shadow-sm">
                  Live
                </span>
              </div>
            </div>
          </header>

          <div className="border-b border-zinc-200/70 bg-gradient-to-b from-white via-white to-zinc-50/90 px-4 py-6 sm:px-5 lg:px-8">
            <div className="flex flex-col gap-1 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-950 sm:text-[1.65rem] sm:leading-tight">
                  Claims management
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-600">
                  {isModerator
                    ? 'Read-only access: use the queue and case file to review every field (overview, vehicle and incident, parties and witnesses). You cannot change claim status, request documents on behalf of the system, or export from this role.'
                    : 'Review, approve, and export accident claims. Administrators may change claim disposition.'}
                </p>
              </div>
              <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-1 text-2xs text-zinc-500 lg:mt-0 lg:justify-end">
                <div className="flex gap-1.5">
                  <dt className="text-zinc-400">Portfolio</dt>
                  <dd className="font-mono font-semibold text-zinc-800">{metrics.total} open</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="text-zinc-400">Filtered</dt>
                  <dd className="font-mono font-semibold text-zinc-800">{filteredClaims.length} rows</dd>
                </div>
              </dl>
            </div>
          </div>

          <main className="flex-1 overflow-auto scrollbar-thin px-4 py-5 sm:px-5 lg:px-8 lg:py-7">
            <>
            {isModerator && (
              <div className="mb-5 flex items-start gap-3 rounded-xl border border-indigo-200/80 bg-gradient-to-r from-indigo-50/90 to-white px-4 py-3 shadow-card sm:items-center sm:px-5">
                <span className="mt-0.5 shrink-0 rounded-lg border border-indigo-300/80 bg-white px-2 py-0.5 text-2xs font-bold uppercase tracking-wide text-indigo-900 shadow-sm sm:mt-0">
                  Read-only
                </span>
                <p className="text-2xs leading-relaxed text-zinc-700 sm:text-xs">
                  You can search, filter, and open any claim to view the same data as an administrator. Status changes and exports are reserved for administrators.
                </p>
              </div>
            )}
            <section className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <MetricCard
                title="Total claims"
                value={metrics.total}
                caption="All records in the active portfolio."
                icon={FileCheck2}
                tone="slate"
              />
              <MetricCard
                title="Pending review"
                value={metrics.pending}
                caption={t ? `${shareOfTotal(metrics.pending, t)}% of portfolio` : '—'}
                icon={FileSearch}
                tone="amber"
              />
              <MetricCard
                title="Approved"
                value={metrics.approved}
                caption={t ? `${shareOfTotal(metrics.approved, t)}% of portfolio` : '—'}
                icon={CheckCircle2}
                tone="emerald"
              />
              <MetricCard
                title="Rejected"
                value={metrics.rejected}
                caption={t ? `${shareOfTotal(metrics.rejected, t)}% of portfolio` : '—'}
                icon={XCircle}
                tone="rose"
              />
            </section>

            <section className="mt-2 grid gap-6 xl:grid-cols-[1fr_300px]">
              <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-card">
                <div className="border-b border-zinc-100 px-4 py-4 sm:px-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h2 className="font-display text-base font-semibold tracking-tight text-zinc-950">Submitted claims</h2>
                      <p className="mt-1 text-sm text-zinc-600">Search and filter the intake queue. Select a row to open the case file.</p>
                    </div>
                    <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto lg:max-w-xl">
                      <label className="group relative min-w-0 flex-1 sm:max-w-xs lg:max-w-[280px]">
                        <span className="sr-only">Search claims</span>
                        <Search
                          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400 transition group-focus-within:text-indigo-600"
                          strokeWidth={2}
                        />
                        <input
                          type="search"
                          value={searchTerm}
                          onChange={(event) => setSearchTerm(event.target.value)}
                          placeholder="Search plate, driver, date…"
                          className="h-10 w-full rounded-xl border border-zinc-200/90 bg-zinc-50/80 pl-10 pr-3 text-[13px] text-zinc-900 shadow-inner outline-none transition placeholder:text-zinc-400 focus:border-indigo-400/80 focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                        />
                      </label>
                      <div
                        className="inline-flex shrink-0 rounded-xl border border-zinc-200/90 bg-zinc-100/90 p-0.5 shadow-inner"
                        role="group"
                        aria-label="Filter by status"
                      >
                        {STATUS_OPTIONS.map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => setStatusFilter(option)}
                            className={`whitespace-nowrap rounded-lg px-3 py-2 text-2xs font-semibold uppercase tracking-wide transition ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 ${
                              statusFilter === option
                                ? 'bg-white text-zinc-900 shadow-lift ring-1 ring-zinc-200/80'
                                : 'text-zinc-600 hover:text-zinc-900'
                            }`}
                          >
                            {option === 'All' ? 'All' : option === 'Pending Review' ? 'Pending' : option}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-2 border-t border-zinc-100 pt-4 sm:grid-cols-3">
                    <QueueStat label="Awaiting action" value={metrics.pending} />
                    <QueueStat label="In view" value={filteredClaims.length} />
                    <QueueStat label="High priority" value={claims.filter((item) => item.priority === 'High').length} />
                  </div>
                </div>

                <div className="overflow-x-auto scrollbar-thin">
                  <table className="min-w-[720px] w-full border-collapse text-left text-[13px]">
                    <thead>
                      <tr className="border-b border-zinc-200 bg-zinc-50/95">
                        <th className="w-10 px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-zinc-500">#</th>
                        <th className="px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-zinc-500">Reference</th>
                        <th className="min-w-[140px] px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-zinc-500">Plate</th>
                        <th className="min-w-[160px] px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-zinc-500">Driver</th>
                        <th className="whitespace-nowrap px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-zinc-500">Submitted</th>
                        <th className="whitespace-nowrap px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-zinc-500">Incident</th>
                        <th className="px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-zinc-500">Priority</th>
                        <th className="px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-zinc-500">Status</th>
                        <th className="w-10 px-3 py-2.5" aria-hidden />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {filteredClaims.map((item, index) => {
                        const active = selectedClaim?.id === item.id;
                        return (
                          <tr
                            key={item.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => openRow(item)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                openRow(item);
                              }
                            }}
                            className={`cursor-pointer transition ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500/90 ${
                              active ? 'bg-indigo-50/80 shadow-[inset_3px_0_0_0_rgb(99,102,241)]' : 'hover:bg-zinc-50/90'
                            }`}
                          >
                            <td className="px-3 py-2.5 font-mono text-2xs tabular-nums text-zinc-400">{index + 1}</td>
                            <td className="px-3 py-2.5 font-mono text-2xs text-zinc-500">{claimRef(item.id)}</td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                    item.priority === 'High'
                                      ? 'bg-rose-500'
                                      : item.priority === 'Needs Docs'
                                        ? 'bg-amber-500'
                                        : 'bg-emerald-500'
                                  }`}
                                  title={item.priority}
                                  aria-hidden
                                />
                                <span className="font-mono text-[13px] font-semibold text-zinc-900">{item.plateNumber}</span>
                              </div>
                            </td>
                            <td className="max-w-[200px] px-3 py-2.5">
                              <p className="truncate font-medium text-zinc-900">{item.driverName}</p>
                              <p className="truncate text-2xs text-zinc-500">{item.summary}</p>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 font-mono text-2xs tabular-nums text-zinc-600">
                              {item.submittedAt}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 font-mono text-2xs tabular-nums text-zinc-600">
                              {item.dateOfIncident}
                            </td>
                            <td className="px-3 py-2.5">
                              <PriorityBadge priority={item.priority} />
                            </td>
                            <td className="px-3 py-2.5">
                              <StatusBadge status={item.status} />
                            </td>
                            <td className="px-3 py-2.5 text-zinc-300">
                              <ChevronRight className="h-4 w-4" strokeWidth={2} aria-hidden />
                            </td>
                          </tr>
                        );
                      })}
                      {!filteredClaims.length && (
                        <tr>
                          <td colSpan={9} className="px-4 py-12">
                            <div className="mx-auto max-w-md rounded-xl border border-dashed border-zinc-200 bg-zinc-50/80 px-5 py-8 text-center shadow-inner">
                              <p className="text-sm font-semibold text-zinc-900">No matching claims</p>
                              <p className="mt-1.5 text-sm text-zinc-600">
                                Adjust search or status filters to broaden the result set.
                              </p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <aside className="flex min-w-0 flex-col gap-4">
                <div className="rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-card">
                  <div className="flex gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200/90 bg-zinc-50 text-zinc-700 shadow-inner">
                      <Shield className="h-4 w-4" strokeWidth={2} />
                    </span>
                    <div>
                      <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Policy</p>
                      <p className="mt-1 text-sm leading-snug text-zinc-600">
                        {isModerator
                          ? 'Moderators have full visibility into claim records for oversight and triage. Disposition, document requests, and exports are administrator-only.'
                          : 'Use documented criteria when changing status. Export generates an insurer-ready print layout.'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-card">
                  <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Workflow</p>
                  <ol className="mt-3 space-y-3">
                    {(isModerator
                      ? ['Scan the queue and filters', 'Open a row to read the full case file (all tabs)']
                      : ['Validate intake data', 'Confirm liability signals', 'Record disposition', 'Export if required']
                    ).map((step, i) => (
                      <li key={step} className="flex gap-3 text-sm text-zinc-700">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-zinc-200/90 bg-zinc-50 font-mono text-2xs font-semibold text-zinc-600 shadow-inner">
                          {i + 1}
                        </span>
                        <span className="pt-0.5 leading-snug">{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                <div className="rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-card">
                  <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Guidance</p>
                  <ul className="mt-3 space-y-3">
                    <AdminHint
                      icon={LayoutDashboard}
                      title="Queue hygiene"
                      text={isModerator ? 'Use search and status filters to narrow the list; all columns remain visible.' : 'Process incoming claims and keep the queue moving.'}
                    />
                    <AdminHint
                      icon={MapPinned}
                      title="Case file"
                      text={
                        isModerator
                          ? 'Open any row: Overview, Vehicle & incident, and Parties & witnesses match the administrator view (read-only).'
                          : 'Open any row for structured fields and disposition actions.'
                      }
                    />
                    {!isModerator && (
                      <AdminHint icon={Download} title="Print handoff" text="Export for workshop or insurer packets." />
                    )}
                  </ul>
                </div>

                <div className="rounded-2xl border border-zinc-200/90 bg-gradient-to-b from-zinc-50/90 to-white p-5 shadow-inner">
                  <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Checklist</p>
                  {isModerator ? (
                    <p className="mt-2.5 text-sm leading-relaxed text-zinc-700">
                      For status changes, document requests, or PDF exports, ask an <span className="font-medium text-zinc-900">Administrator</span> to act in this workspace.
                    </p>
                  ) : (
                    <ul className="mt-2.5 space-y-2">
                      {queueHighlights.map((item) => (
                        <li key={item.title} className="border-l-2 border-indigo-300/80 pl-3 text-sm text-zinc-700">
                          <span className="font-medium text-zinc-900">{item.title}.</span>{' '}
                          <span className="text-zinc-600">{item.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </aside>
            </section>
              </>
          </main>
        </div>
      </div>

      {selectedClaim && (
        <ClaimModal
          claimItem={selectedClaim}
          role={session.role}
          onClose={() => setSelectedClaim(null)}
          onApprove={() => updateClaimStatus(selectedClaim.id, 'Approved')}
          onRequestInfo={() => updateClaimStatus(selectedClaim.id, 'Pending Review')}
          onReject={() => updateClaimStatus(selectedClaim.id, 'Rejected')}
          onExport={() => exportClaimToPdf(selectedClaim)}
          onPatchClaim={patchClaim}
        />
      )}
    </div>
  );
}

function MetricCard({ title, value, caption, icon: Icon, tone }) {
  const tones = {
    slate: 'border-zinc-200/90 bg-white text-zinc-700',
    amber: 'border-amber-200/80 bg-amber-50/50 text-amber-900',
    emerald: 'border-emerald-200/80 bg-emerald-50/50 text-emerald-900',
    rose: 'border-rose-200/80 bg-rose-50/50 text-rose-900',
  };

  return (
    <div
      className={`rounded-2xl border px-3 py-3 shadow-card transition ease-out hover:shadow-card-hover sm:px-4 sm:py-4 ${tones[tone]}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">{title}</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums tracking-tight text-zinc-950">{value}</p>
          <p className="mt-1 text-2xs leading-relaxed text-zinc-600">{caption}</p>
        </div>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200/80 bg-zinc-50/80 text-zinc-600 shadow-inner">
          <Icon className="h-4 w-4" strokeWidth={2} />
        </span>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const styles =
    status === 'Approved'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : status === 'Rejected'
        ? 'border-rose-200 bg-rose-50 text-rose-900'
        : 'border-amber-200 bg-amber-50 text-amber-950';

  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide ${styles}`}
    >
      {status === 'Pending Review' ? 'Pending' : status}
    </span>
  );
}

function PriorityBadge({ priority }) {
  const styles =
    priority === 'High'
      ? 'border-rose-200 bg-white text-rose-800'
      : priority === 'Needs Docs'
        ? 'border-amber-200 bg-white text-amber-950'
        : 'border-zinc-200/90 bg-white text-zinc-700';

  return (
    <span className={`inline-flex rounded border px-1.5 py-0.5 text-2xs font-semibold ${styles}`}>{priority}</span>
  );
}

function QueueStat({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-2 rounded-xl border border-zinc-100 bg-zinc-50/90 px-3 py-2 shadow-inner">
      <span className="text-2xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
      <span className="font-mono text-sm font-semibold tabular-nums text-zinc-900">{value}</span>
    </div>
  );
}

function AdminHint({ icon: Icon, title, text }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-zinc-200/90 bg-zinc-50 text-zinc-600 shadow-inner">
        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-zinc-900">{title}</p>
        <p className="mt-0.5 text-2xs leading-relaxed text-zinc-600">{text}</p>
      </div>
    </li>
  );
}

function SummaryItem({ label, value }) {
  return (
    <div className="border-b border-zinc-100 py-2.5 last:border-0 sm:grid sm:grid-cols-[minmax(0,140px)_1fr] sm:gap-3 sm:py-2">
      <dt className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-zinc-900 sm:mt-0">{value || '—'}</dd>
    </div>
  );
}

function DetailCard({ title, items }) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-inner">
      <div className="border-b border-zinc-100 bg-zinc-50/50 px-4 py-2.5">
        <h3 className="text-[13px] font-semibold text-zinc-900">{title}</h3>
      </div>
      <dl className="divide-y divide-zinc-100 px-4 py-1">
        {items.map(([label, value]) => (
          <div key={label} className="grid gap-0.5 py-2.5 sm:grid-cols-[minmax(0,120px)_1fr] sm:gap-3">
            <dt className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">{label}</dt>
            <dd className="text-sm text-zinc-900">{value || '—'}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function OperationalPill({ title, text }) {
  return (
    <div className="rounded-xl border border-zinc-200/90 bg-white px-3 py-2.5 shadow-inner">
      <p className="text-xs font-semibold text-zinc-900">{title}</p>
      <p className="mt-1 text-2xs leading-relaxed text-zinc-600">{text}</p>
    </div>
  );
}

function ClaimModal({ claimItem, role, onClose, onApprove, onRequestInfo, onReject, onExport, onPatchClaim }) {
  const [tab, setTab] = useState('overview');
  const [pdfBusy, setPdfBusy] = useState(false);
  const isModerator = role === 'moderator';
  const fileInputRef = useRef(null);

  useEffect(() => {
    setTab('overview');
  }, [claimItem.id]);

  const patch = (partialOrFn) => onPatchClaim(claimItem.id, partialOrFn);

  const patchQuoteField = (quoteId, field, rawValue) => {
    patch((prev) => ({
      quoteOptions: (prev.quoteOptions ?? []).map((opt) => {
        if (opt.id !== quoteId) return opt;
        if (field === 'amount') {
          const n = Number(String(rawValue).replace(/,/g, ''));
          return { ...opt, amount: Number.isFinite(n) && n >= 0 ? n : 0 };
        }
        return { ...opt, [field]: rawValue };
      }),
    }));
  };

  const caseFiles = claimItem.caseFiles ?? [];
  const quoteOptions = claimItem.quoteOptions ?? [];
  const primaryQuoteId = claimItem.primaryQuoteId ?? null;
  const finalQuoteId = claimItem.finalQuoteId ?? null;

  const data = claimItem.data ?? {};
  const otherParties = data.otherParties ?? [];
  const witnessDetails = data.witnessDetails ?? {};
  const towingSummary = [
    data.damage?.towed ? `Towed: ${data.damage.towed}` : null,
    data.damage?.towCompany ? `Tow company: ${data.damage.towCompany}` : null,
    data.damage?.towLocation ? `Tow destination: ${data.damage.towLocation}` : null,
    data.damage?.currentVehicleLocation ? `Vehicle now at: ${data.damage.currentVehicleLocation}` : null,
  ].filter(Boolean);
  const damageMarkerCount = data.damage?.points
    ? Object.values(data.damage.points).reduce((count, list) => count + list.length, 0)
    : 0;

  const primaryQuote = quoteOptions.find((q) => q.id === primaryQuoteId);
  const finalQuote = quoteOptions.find((q) => q.id === finalQuoteId);

  const handlePdfInput = async (ev) => {
    const picked = [...(ev.target.files || [])].filter((f) => f.type === 'application/pdf');
    ev.target.value = '';
    if (!picked.length || isModerator) return;
    const MAX_PDF_BYTES = 2 * 1024 * 1024;
    const ok = [];
    const skip = [];
    for (const f of picked) {
      if (f.size > MAX_PDF_BYTES) skip.push(f.name);
      else ok.push(f);
    }
    if (skip.length) {
      window.alert(
        `These files were skipped (max ${formatFileSize(MAX_PDF_BYTES)} each for browser storage): ${skip.join(', ')}`,
      );
    }
    if (!ok.length) return;
    setPdfBusy(true);
    try {
      const added = await Promise.all(ok.map((f) => fileToCaseFile(f)));
      patch((prev) => ({
        caseFiles: [...(prev.caseFiles ?? []), ...added],
      }));
    } catch {
      window.alert('Could not read one or more PDFs. Try another file.');
    } finally {
      setPdfBusy(false);
    }
  };

  const removePdf = (fileId) => {
    if (isModerator) return;
    patch((prev) => {
      const list = prev.caseFiles ?? [];
      const target = list.find((f) => f.id === fileId);
      if (target?.url?.startsWith('blob:')) URL.revokeObjectURL(target.url);
      return { caseFiles: list.filter((f) => f.id !== fileId) };
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <div
        className="flex max-h-[100dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border border-zinc-200/90 bg-white shadow-sheet-lg sm:max-h-[min(92vh,880px)] sm:rounded-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="claim-modal-title"
      >
        <div className="flex shrink-0 flex-col gap-3 border-b border-zinc-200/90 bg-gradient-to-b from-white to-zinc-50/90 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-6 sm:py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-2xs text-zinc-500">
              <span className="font-mono font-medium text-zinc-600">{claimRef(claimItem.id)}</span>
              <span className="text-zinc-300" aria-hidden>
                ·
              </span>
              <span>Claims</span>
              <ChevronRight className="h-3 w-3 text-zinc-300" aria-hidden />
              <span>Review</span>
            </div>
            <h2 id="claim-modal-title" className="font-display mt-1.5 truncate text-lg font-semibold tracking-tight text-zinc-950 sm:text-xl">
              {claimItem.driverName}
            </h2>
            <p className="mt-0.5 font-mono text-sm text-zinc-600">{claimItem.plateNumber}</p>
            <p className="mt-2 max-w-prose text-sm leading-relaxed text-zinc-600">{claimItem.summary}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
            <div className="flex flex-wrap items-center justify-end gap-2">
              {isModerator && (
                <span className="rounded-lg border border-zinc-300/90 bg-zinc-100 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-zinc-800 shadow-inner">
                  View only
                </span>
              )}
              <StatusBadge status={claimItem.status} />
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200/90 bg-white text-zinc-600 shadow-sm transition hover:bg-zinc-50 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80 focus-visible:ring-offset-2"
              aria-label="Close"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 gap-1 border-b border-zinc-200/90 bg-white px-2 sm:gap-2 sm:px-4">
            {MODAL_TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`relative -mb-px border-b-2 px-3 py-3 text-2xs font-semibold uppercase tracking-wide transition ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80 focus-visible:ring-offset-2 sm:px-4 sm:text-xs ${
                  tab === item.id
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-zinc-500 hover:text-zinc-800'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin bg-zinc-50/40 px-4 py-4 sm:px-6 sm:py-5">
            {tab === 'overview' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-zinc-200/90 bg-white p-4 shadow-inner">
                  <h3 className="text-[13px] font-semibold text-zinc-900">Case facts</h3>
                  <dl className="mt-1 divide-y divide-zinc-100">
                    <SummaryItem label="Status" value={claimItem.status} />
                    <SummaryItem label="Submitted" value={claimItem.submittedAt} />
                    <SummaryItem label="Incident date" value={claimItem.dateOfIncident} />
                    <SummaryItem label="Plate" value={claimItem.plateNumber} />
                    <SummaryItem
                      label="PDFs on file"
                      value={caseFiles.length ? `${caseFiles.length} PDF${caseFiles.length === 1 ? '' : 's'}` : undefined}
                    />
                    <SummaryItem
                      label="Primary quote"
                      value={
                        primaryQuote
                          ? `${primaryQuote.supplier} (${formatAud(primaryQuote.amount)})`
                          : undefined
                      }
                    />
                    <SummaryItem
                      label="Final quote"
                      value={
                        finalQuote ? `${finalQuote.supplier} (${formatAud(finalQuote.amount)})` : undefined
                      }
                    />
                  </dl>
                  {!isModerator && (
                    <div className="mt-4 rounded-xl border border-indigo-200/90 bg-indigo-50/70 p-3.5">
                      <p className="text-xs leading-relaxed text-indigo-950">
                        The fields above stay on Overview for a quick read. To type quote details, choose primary/final,
                        and upload PDFs, open <span className="font-semibold">Quotes & PDFs</span>. Changes persist in this
                        browser until you wire a backend.
                      </p>
                      <button
                        type="button"
                        onClick={() => setTab('quotes')}
                        className="mt-2.5 inline-flex h-9 items-center gap-2 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      >
                        <FileText className="h-3.5 w-3.5" strokeWidth={2} />
                        Open Quotes & PDFs
                      </button>
                    </div>
                  )}
                </div>
                <div className="rounded-xl border border-zinc-200/90 bg-white p-4 shadow-inner">
                  <h3 className="text-[13px] font-semibold text-zinc-900">Summary</h3>
                  <dl className="mt-1 divide-y divide-zinc-100">
                    {detailFields.map((field) => (
                      <SummaryItem key={field.label} label={field.label} value={field.getter(data)} />
                    ))}
                    <SummaryItem label="Description" value={data.incident?.description || claimItem.summary} />
                  </dl>
                </div>
                <div>
                  <h3 className="mb-2 text-[13px] font-semibold text-zinc-900">Review signals</h3>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <OperationalPill
                      title="Liability"
                      text={
                        data.driver?.admittedLiability || data.driver?.otherDriverAdmittedLiability
                          ? 'Liability indicators were captured in the claim.'
                          : 'No liability admission noted in this record.'
                      }
                    />
                    <OperationalPill
                      title="Damage mapping"
                      text={
                        damageMarkerCount
                          ? `${damageMarkerCount} damage marker(s) on the vehicle diagram.`
                          : 'No visual damage markers were placed.'
                      }
                    />
                    <OperationalPill
                      title="Third parties"
                      text={
                        otherParties.length
                          ? `${otherParties.length} other party record(s) attached.`
                          : 'No other party records were attached.'
                      }
                    />
                  </div>
                </div>
              </div>
            )}

            {tab === 'records' && (
              <div className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  <DetailCard
                    title="Claimant and driver"
                    items={[
                      ['Owner', data.memberVehicle?.ownerName],
                      ['Driver', claimItem.driverName],
                      ['Vehicle', [data.memberVehicle?.make, data.memberVehicle?.model].filter(Boolean).join(' ')],
                      ['Claim type', data.memberVehicle?.claimType],
                    ]}
                  />
                  <DetailCard
                    title="Incident context"
                    items={[
                      ['Street', data.incident?.streetName],
                      ['Suburb', data.incident?.suburb],
                      ['Road surface', data.incident?.roadSurface],
                      ['Traffic controls', data.incident?.trafficControls?.join(', ')],
                    ]}
                  />
                </div>
                <div className="overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-inner">
                  <div className="border-b border-zinc-100 bg-zinc-50/50 px-4 py-2.5">
                    <h3 className="text-[13px] font-semibold text-zinc-900">Towing and damage</h3>
                  </div>
                  <dl className="grid gap-0 px-4 sm:grid-cols-2 sm:divide-x sm:divide-zinc-100">
                    <div className="divide-y divide-zinc-100 py-1 sm:pr-4">
                      <SummaryItem label="Claiming damage" value={data.damage?.claimingDamage} />
                      <SummaryItem label="Vehicle towed" value={data.damage?.towed} />
                    </div>
                    <div className="divide-y divide-zinc-100 py-1 sm:pl-4">
                      <SummaryItem label="Damage markers" value={damageMarkerCount ? `${damageMarkerCount} mapped` : 'None mapped'} />
                      <SummaryItem label="Current vehicle location" value={data.damage?.currentVehicleLocation} />
                    </div>
                  </dl>
                  {towingSummary.length > 0 && (
                    <div className="border-t border-zinc-100 px-4 py-3">
                      <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Handling notes</p>
                      <div className="mt-2 flex flex-col gap-1.5">
                        {towingSummary.map((item) => (
                          <span
                            key={item}
                            className="rounded-lg border border-zinc-200/90 bg-zinc-50 px-2.5 py-1.5 font-mono text-2xs text-zinc-700 shadow-inner"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === 'parties' && (
              <div className="grid gap-4 lg:grid-cols-2">
                <DetailCard
                  title="Witness details"
                  items={[
                    ['Witness 1', witnessDetails.witness1Name],
                    ['Witness 1 mobile', witnessDetails.witness1Mobile],
                    ['Witness 2', witnessDetails.witness2Name],
                    ['Witness 2 mobile', witnessDetails.witness2Mobile],
                  ]}
                />
                <div className="overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-inner">
                  <div className="border-b border-zinc-100 bg-zinc-50/50 px-4 py-2.5">
                    <h3 className="text-[13px] font-semibold text-zinc-900">Other parties involved</h3>
                  </div>
                  <div className="p-4">
                    {otherParties.length ? (
                      <ul className="space-y-3">
                        {otherParties.map((party, index) => (
                          <li
                            key={`${party.plateNumber || 'party'}-${index}`}
                            className="rounded-xl border border-zinc-200/90 bg-zinc-50/80 p-3 shadow-inner"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-zinc-900">Vehicle {index + 1}</span>
                              <span className="rounded-lg border border-zinc-200/90 bg-white px-1.5 py-0.5 font-mono text-2xs font-semibold text-zinc-700 shadow-sm">
                                {party.plateNumber || 'No plate'}
                              </span>
                            </div>
                            <dl className="mt-2 space-y-1 text-sm text-zinc-600">
                              <div>
                                <dt className="inline text-2xs font-semibold uppercase text-zinc-500">Driver </dt>
                                <dd className="inline text-zinc-800">{party.driverName || '—'}</dd>
                              </div>
                              <div>
                                <dt className="inline text-2xs font-semibold uppercase text-zinc-500">Vehicle </dt>
                                <dd className="inline">{[party.make, party.model, party.color].filter(Boolean).join(' / ') || '—'}</dd>
                              </div>
                              <div>
                                <dt className="inline text-2xs font-semibold uppercase text-zinc-500">Insurance </dt>
                                <dd className="inline">{party.insuranceCompany || '—'}</dd>
                              </div>
                            </dl>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-3 py-6 text-center text-sm text-zinc-500 shadow-inner">
                        No other party records were attached to this claim.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {tab === 'quotes' && (
              <div className="space-y-6">
                <section className="rounded-xl border border-zinc-200/90 bg-white p-4 shadow-inner sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-[13px] font-semibold text-zinc-900">Case PDFs</h3>
                      <p className="mt-1 text-2xs leading-relaxed text-zinc-600 sm:text-xs">
                        PDFs are stored in this browser (base64 in localStorage, max 2&nbsp;MB per file). Replace with your
                        upload API for production.
                      </p>
                    </div>
                    {!isModerator && (
                      <>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="application/pdf,.pdf"
                          multiple
                          className="sr-only"
                          onChange={handlePdfInput}
                        />
                        <button
                          type="button"
                          disabled={pdfBusy}
                          onClick={() => !pdfBusy && fileInputRef.current?.click()}
                          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-indigo-200/90 bg-indigo-50 px-3 text-xs font-semibold text-indigo-900 transition hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80 disabled:cursor-wait disabled:opacity-70"
                        >
                          <Upload className="h-4 w-4" strokeWidth={2} />
                          {pdfBusy ? 'Reading PDF…' : 'Upload PDF'}
                        </button>
                      </>
                    )}
                  </div>
                  {caseFiles.length === 0 ? (
                    <p className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-500">
                      No PDFs uploaded yet.
                    </p>
                  ) : (
                    <ul className="mt-4 divide-y divide-zinc-100 rounded-xl border border-zinc-100">
                      {caseFiles.map((file) => (
                        <li key={file.id} className="flex flex-wrap items-center gap-3 px-3 py-3 first:pt-3">
                          <FileText className="h-4 w-4 shrink-0 text-indigo-600" strokeWidth={2} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-zinc-900">{file.name}</p>
                            <p className="text-2xs text-zinc-500">
                              {formatFileSize(file.size)} · {file.uploadedAt}
                            </p>
                          </div>
                          <a
                            href={file.dataUrl || file.url}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-lg border border-zinc-200 px-2 py-1 text-2xs font-semibold text-zinc-700 hover:bg-zinc-50"
                          >
                            Open
                          </a>
                          {!isModerator && (
                            <button
                              type="button"
                              onClick={() => removePdf(file.id)}
                              className="rounded-lg border border-rose-200/90 p-1.5 text-rose-700 hover:bg-rose-50"
                              aria-label={`Remove ${file.name}`}
                            >
                              <Trash2 className="h-4 w-4" strokeWidth={2} />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="rounded-xl border border-zinc-200/90 bg-white p-4 shadow-inner sm:p-5">
                  <h3 className="text-[13px] font-semibold text-zinc-900">Repair quotes</h3>
                  <p className="mt-1 text-2xs leading-relaxed text-zinc-600 sm:text-xs">
                    Type workshop name, reference, and amount for each line, then mark which line is{' '}
                    <span className="font-medium text-zinc-800">primary</span> and which is{' '}
                    <span className="font-medium text-zinc-800">final</span>. Both can point at the same line if needed.
                  </p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {quoteOptions.map((q) => {
                      const isPrimary = primaryQuoteId === q.id;
                      const isFinal = finalQuoteId === q.id;
                      return (
                        <div
                          key={q.id}
                          className={`rounded-xl border px-4 py-4 shadow-inner ${
                            isPrimary && isFinal
                              ? 'border-indigo-300/90 bg-gradient-to-br from-indigo-50/60 to-violet-50/50 ring-1 ring-indigo-200/40'
                              : isFinal
                                ? 'border-violet-300/90 bg-violet-50/35 ring-1 ring-violet-200/60'
                                : isPrimary
                                  ? 'border-indigo-300/90 bg-indigo-50/30 ring-1 ring-indigo-200/50'
                                  : 'border-zinc-200/90 bg-zinc-50/40'
                          }`}
                        >
                          <div className="mb-3 flex flex-wrap items-center justify-end gap-1">
                            {isPrimary && (
                              <span className="rounded-md border border-indigo-200 bg-white px-1.5 py-0.5 text-2xs font-bold uppercase tracking-wide text-indigo-800">
                                Primary
                              </span>
                            )}
                            {isFinal && (
                              <span className="inline-flex items-center gap-0.5 rounded-md border border-violet-200 bg-white px-1.5 py-0.5 text-2xs font-bold uppercase tracking-wide text-violet-900">
                                <BadgeCheck className="h-3 w-3" strokeWidth={2} aria-hidden />
                                Final
                              </span>
                            )}
                          </div>

                          {!isModerator ? (
                            <div className="space-y-3">
                              <div>
                                <label className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">
                                  Workshop / supplier
                                </label>
                                <input
                                  type="text"
                                  value={q.supplier}
                                  onChange={(e) => patchQuoteField(q.id, 'supplier', e.target.value)}
                                  className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-2.5 text-sm text-zinc-900 shadow-inner outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15"
                                  placeholder="e.g. Northside Panels"
                                  autoComplete="off"
                                />
                              </div>
                              <div>
                                <label className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">
                                  Quote reference
                                </label>
                                <input
                                  type="text"
                                  value={q.reference}
                                  onChange={(e) => patchQuoteField(q.id, 'reference', e.target.value)}
                                  className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-2.5 font-mono text-sm text-zinc-900 shadow-inner outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15"
                                  placeholder="e.g. NSP-2026-041"
                                  autoComplete="off"
                                />
                              </div>
                              <div>
                                <label className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">
                                  Amount (AUD)
                                </label>
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={Number.isFinite(q.amount) ? q.amount : 0}
                                  onChange={(e) => patchQuoteField(q.id, 'amount', e.target.value)}
                                  className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-2.5 font-mono text-sm text-zinc-900 shadow-inner outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15"
                                />
                                <p className="mt-1 font-mono text-2xs text-zinc-500">{formatAud(q.amount)}</p>
                              </div>
                              <div className="space-y-2.5 border-t border-zinc-200/80 pt-3">
                                <label className="flex cursor-pointer items-center gap-2 text-2xs font-semibold text-zinc-700">
                                  <input
                                    type="radio"
                                    name={`primary-quote-${claimItem.id}`}
                                    className="h-4 w-4 border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                                    checked={isPrimary}
                                    onChange={() => patch({ primaryQuoteId: q.id })}
                                  />
                                  Use as primary quote
                                </label>
                                <label className="flex cursor-pointer items-center gap-2 text-2xs font-semibold text-zinc-700">
                                  <input
                                    type="radio"
                                    name={`final-quote-${claimItem.id}`}
                                    className="h-4 w-4 border-zinc-300 text-violet-600 focus:ring-violet-500"
                                    checked={isFinal}
                                    onChange={() => patch({ finalQuoteId: q.id })}
                                  />
                                  Use as final quote
                                </label>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <p className="font-mono text-xl font-semibold tabular-nums text-zinc-900">
                                {formatAud(q.amount)}
                              </p>
                              <p className="text-sm font-semibold text-zinc-900">{q.supplier}</p>
                              <p className="font-mono text-2xs text-zinc-500">{q.reference}</p>
                              {(isPrimary || isFinal) && (
                                <p className="mt-3 text-2xs leading-relaxed text-zinc-600">
                                  {isPrimary && <span className="font-medium text-zinc-800">Primary quote. </span>}
                                  {isFinal && <span className="font-medium text-zinc-800">Final quote.</span>}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {!isModerator && (
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-100 pt-4">
                      {primaryQuoteId && (
                        <button
                          type="button"
                          onClick={() => patch({ primaryQuoteId: null })}
                          className="rounded-lg border border-zinc-200/90 bg-white px-2.5 py-1.5 text-2xs font-semibold text-zinc-600 hover:bg-zinc-50"
                        >
                          Clear primary
                        </button>
                      )}
                      {finalQuoteId && (
                        <button
                          type="button"
                          onClick={() => patch({ finalQuoteId: null })}
                          className="rounded-lg border border-zinc-200/90 bg-white px-2.5 py-1.5 text-2xs font-semibold text-zinc-600 hover:bg-zinc-50"
                        >
                          Clear final
                        </button>
                      )}
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>

          {isModerator ? (
            <div className="flex shrink-0 flex-col gap-3 border-t border-zinc-200/90 bg-zinc-50/95 px-4 py-4 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p className="text-2xs leading-relaxed text-zinc-600 sm:max-w-xl sm:text-xs">
                This case file is read-only. You can read every tab and field shown to administrators; you cannot change
                status, request documents, export, upload PDFs, set primary quotes, set final quotes, or otherwise modify the
                record from this role.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="h-10 shrink-0 rounded-xl border border-zinc-300/90 bg-white px-4 text-xs font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80"
              >
                Close case file
              </button>
            </div>
          ) : (
            <div className="flex shrink-0 flex-col gap-2 border-t border-zinc-200/90 bg-white/95 px-4 py-3 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.08)] backdrop-blur-md sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p className="hidden text-2xs text-zinc-500 sm:block">Actions apply immediately to this case file.</p>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <button
                  type="button"
                  onClick={onExport}
                  className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-zinc-200/90 bg-white px-3 text-xs font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80 sm:flex-none"
                >
                  <Download className="h-3.5 w-3.5" strokeWidth={2} />
                  Export PDF
                </button>
                <button
                  type="button"
                  onClick={onReject}
                  className="h-10 flex-1 rounded-xl border border-rose-200/90 bg-rose-50 px-3 text-xs font-semibold text-rose-900 transition hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/80 sm:flex-none"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={onRequestInfo}
                  className="h-10 flex-1 rounded-xl border border-amber-200/90 bg-amber-50 px-3 text-xs font-semibold text-amber-950 transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/80 sm:flex-none"
                >
                  Request info
                </button>
                <button
                  type="button"
                  onClick={onApprove}
                  className="h-10 flex-1 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white shadow-md shadow-emerald-900/10 transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/80 sm:flex-none"
                >
                  Approve
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
