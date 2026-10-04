import { useEffect, useMemo, useState, useRef } from 'react';
import Upload from './components/Upload.jsx';
import Review from './components/Review.jsx';
import Generate from './components/Generate.jsx';
import SignatureManager from './components/SignatureManager.jsx';
import Settings from './components/Settings.jsx';
import PinLock from './components/PinLock.jsx';
import { hasPin } from './lib/pin.js';
import { transliterateRow } from './lib/transliterate.js';
import { smartUrduFix } from './lib/gemini.js';
import { parseLeaveDate, nextWorkingDay, fmt } from './lib/dates.js';
import { isConfigured, getUser, onAuthChange, signOut, adoptOrphanRows, fetchSignatures, fetchHolidays } from './lib/supabase.js';
import AuthModal from './components/AuthModal.jsx';

// LocalStorage keys. Settings.jsx (sibling) uses GEMINI_KEYS_LS too so the
// key list and App state never disagree. App writes it on every change anyway.
const GEMINI_KEYS_LS = 'crown-leave-gemini-keys';
const GEMINI_KEY_LS_OLD = 'crown-leave-gemini-key'; // legacy single key, migrated once
const SMARTFIX_LS = 'crown-leave-smartfix';

// Read saved keys; migrate the old single-key format on first run.
function loadApiKeys() {
  try {
    const raw = localStorage.getItem(GEMINI_KEYS_LS);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.map((k) => String(k || '').trim()).filter(Boolean);
    }
    const old = localStorage.getItem(GEMINI_KEY_LS_OLD);
    if (old && old.trim()) {
      const arr = [old.trim()];
      try { localStorage.setItem(GEMINI_KEYS_LS, JSON.stringify(arr)); } catch (e) { /* ignore */ }
      return arr;
    }
  } catch (e) {
    // ignore
  }
  return [];
}

const FIELDS = ['ecode', 'name', 'father', 'designation', 'department', 'date', 'reason'];
const STEPS = ['Upload', 'Review rows', 'Signatures', 'Generate'];

let uidCounter = 0;
function uid() {
  uidCounter += 1;
  return 'form-' + Date.now() + '-' + uidCounter;
}

// Pick the ENGLISH cell values for rule evaluation, using the column mapping.
function englishFromRow(row, mapping) {
  const eng = {};
  for (const f of FIELDS) {
    const h = mapping ? mapping[f] : null;
    eng[f] = h && row[h] != null ? String(row[h]).trim() : '';
  }
  return eng;
}

// Evaluate each signature's rule against the ENGLISH row values.
// Flat signature shape is the source of truth:
//   { id, label, imageUrl, position, conditionField, conditionOp, conditionValue }
// conditionField is one of: department | designation | reason (also accepts ecode, name, father).
// No rule (or empty conditionValue) means the signature applies to every form.
// Position mapping: SignatureManager/supabase.js store 'employee' | 'dept_head' | 'hr' | 'custom';
// lib/printForm.js SIG_POSITIONS expects 'employee' | 'departmentHead' | 'hrManager'.
// 'custom' has no dedicated spot on the paper form, so it lands on departmentHead.
const POSITION_MAP = {
  employee: 'employee',
  dept_head: 'departmentHead',
  hr: 'hrManager',
  custom: 'departmentHead',
};

function resolvePlacements(form, signatures) {
  return (signatures || [])
    .filter((s) => {
      const needle = String((s && s.conditionValue) || '').trim().toLowerCase();
      if (!needle) return true;
      const field = String((s && s.conditionField) || '').trim().toLowerCase();
      const hay = String((form.english && form.english[field]) || '').toLowerCase();
      if (s && s.conditionOp === 'equals') return hay === needle;
      return hay.indexOf(needle) !== -1; // 'contains' is the default
    })
    .map((s) => ({
      imageUrl: s.imageUrl,
      position: POSITION_MAP[s.position] || 'employee',
    }));
}

// Bundled default HR signature (extracted from the user's paper form).
// It is common to EVERY form unless the user uploads their own HR-position
// signature, which takes precedence. Fully replaceable from the
// SignatureManager screen.
function useDefaultHrSignUrl() {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(import.meta.env.BASE_URL + 'hr-sign.png');
        if (!res.ok) return;
        const blob = await res.blob();
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        if (alive && typeof dataUrl === 'string') setUrl(dataUrl);
      } catch (e) {
        // keep null; HR line simply stays blank
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return url;
}

// Transliterate every raw row, then optionally run Gemini smart-fix in batches.
// Any smart-fix failure falls back silently to the local transliteration.
// opts: { apiKeys, smartFixOn, month, year, onProgress } — month/year apply to
// bare day-number dates in the sheet (the register's month).
// onProgress(done, total) is called as Gemini values complete.
async function buildForms(rawRows, mapping, opts) {
  const { apiKeys, smartFixOn, month, year, onProgress } = opts || {};
  const keys = (Array.isArray(apiKeys) ? apiKeys : []).filter(Boolean);
  const forms = rawRows.map((row) => {
    let t = {};
    try {
      t = transliterateRow(row, mapping, { month, year }) || {};
    } catch (e) {
      t = {};
    }
    return {
      id: uid(),
      ecode: t.ecode || '',
      name: t.name || '',
      father: t.father || '',
      designation: t.designation || '',
      department: t.department || '',
      date: t.date || '',
      reason: t.reason || '',
      english: englishFromRow(row, mapping),
      _raw: row,
    };
  });

  // Stats so the UI can tell the user whether Gemini actually ran.
  const stats = { attempted: 0, fixed: 0, failed: false, skipped: !(smartFixOn && keys.length), keyErrors: [] };

  if (smartFixOn && keys.length) {
    const kinds = ['name', 'father', 'designation', 'department', 'reason'];
    // Collect EVERY value across ALL forms in one list. smartUrduFix
    // dedups (Ali asked once even if on 10 forms), splits into bunches and
    // runs all keys IN PARALLEL — then we map answers back to every form.
    const items = [];
    forms.forEach((f, fi) => {
      kinds.forEach((k) => {
        // IMPORTANT: always send Gemini the ORIGINAL ENGLISH text, never the
        // already-transliterated Urdu. Re-running on Gemini's own Urdu output
        // caused drift (e.g. a correct name turning wrong on the second run).
        const orig = (f.english && f.english[k]) || '';
        const text = (orig.trim() ? orig : f[k] || '').trim();
        if (text) items.push({ fi, k, text });
      });
    });
    stats.attempted = items.length;
    const applyValues = (values) => {
      items.forEach((it, idx) => {
        const v = values[idx];
        if (typeof v === 'string' && v.trim()) {
          forms[it.fi][it.k] = v;
          stats.fixed += 1;
        }
      });
    };
    try {
      const fixed = await smartUrduFix(
        items.map((it) => it.text),
        items.map((it) => it.k),
        keys,
        (done, total) => {
          if (typeof onProgress === 'function') {
            try { onProgress(done, total); } catch (e) { /* ignore */ }
          }
        }
      );
      applyValues(fixed);
      if (typeof onProgress === 'function') {
        try { onProgress(items.length, items.length); } catch (e) { /* ignore */ }
      }
    } catch (e) {
      // Partial failure still carries the good values — apply them, but
      // report the miss HONESTLY with the real per-key reasons.
      if (e && e.partial) applyValues(e.partial);
      stats.failed = true;
      stats.keyErrors = (e && e.keyErrors) || [(e && e.message) || 'Unknown error'];
    }
  }
  forms._geminiStats = stats;
  return forms;
}

function printHtmlDocument(html) {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.setAttribute('title', 'print-frame');
  document.body.appendChild(iframe);
  const cleanup = () => {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
  };
  try {
    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
  } catch (e) {
    cleanup();
    return;
  }
  setTimeout(() => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (e) {
      // ignore, still clean up
    }
    setTimeout(cleanup, 2000);
  }, 400);
}

function downloadHtmlDocument(html) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'crown-leave-forms.html';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export default function App() {
  const [step, setStep] = useState(0);

  // Settings live here at the top level and are NEVER wiped by a new upload.
  // Multiple Gemini keys: the smart fix rotates through them so every single
  // name gets processed even if one key is rate-limited or down.
  const [apiKeys, setApiKeys] = useState(loadApiKeys);
  const [smartFixOn, setSmartFixOn] = useState(() => {
    try {
      return localStorage.getItem(SMARTFIX_LS) === '1';
    } catch (e) {
      return false;
    }
  });
  const [signatures, setSignatures] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const defaultHrSignUrl = useDefaultHrSignUrl();

  // The register's month/year. Bare day numbers (18/19/20) in the sheet
  // belong to THIS month, never silently to "today".
  const [sheetMonth, setSheetMonth] = useState(() => new Date().getMonth() + 1);
  const [sheetYear, setSheetYear] = useState(() => new Date().getFullYear());

  // Dark mode for the app UI (the printed forms always stay black-on-white).
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem('crown-leave-theme') === 'dark';
    } catch (e) {
      return false;
    }
  });
  useEffect(() => {
    try {
      document.documentElement.classList.toggle('dark', dark);
      localStorage.setItem('crown-leave-theme', dark ? 'dark' : 'light');
    } catch (e) {
      // ignore
    }
  }, [dark]);

  // App PIN lock: when a PIN is set, the whole app stays behind the
  // lock screen until this session unlocks. Session-only: a fresh page
  // load locks again.
  const [pinSet] = useState(hasPin);
  const [unlocked, setUnlocked] = useState(() => !hasPin());

  // Supabase auth: login/signup se user ka data (signatures, holidays)
  // us ke account se sync hota hai. Logged out = sirf is device/session.
  const [user, setUser] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const userRef = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const u = await getUser();
      if (alive) {
        userRef.current = u;
        setUser(u);
        setAuthReady(true);
      }
    })();
    const off = onAuthChange(async (u) => {
      if (!alive) return;
      const wasOut = !userRef.current && u;
      userRef.current = u;
      setUser(u);
      if (u && wasOut) {
        // Fresh login: pehle purana shared data apne naam karo, phir reload.
        await adoptOrphanRows();
        const rows = await fetchSignatures();
        if (Array.isArray(rows)) setSignatures(rows);
        const hm = sheetMonth && sheetYear ? `${sheetYear}-${String(sheetMonth).padStart(2, '0')}` : null;
        if (hm) {
          const hres = await fetchHolidays(hm);
          setHolidays(hres ? hres.holidays : []);
        }
      } else if (!u) {
        // Logout: local mode.
        setSignatures([]);
        setHolidays([]);
      }
    });
    return () => {
      alive = false;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Row data (this is the only thing a new upload refreshes).
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState(null);
  const [forms, setForms] = useState([]);

  const [busy, setBusy] = useState(false);
  const [busyMsg, setBusyMsg] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [online] = useState(() => {
    try {
      return isConfigured();
    } catch (e) {
      return false;
    }
  });

  const handleApiKeys = (keys) => {
    const arr = (Array.isArray(keys) ? keys : []).map((k) => String(k || '').trim()).filter(Boolean);
    setApiKeys(arr);
    try {
      localStorage.setItem(GEMINI_KEYS_LS, JSON.stringify(arr));
    } catch (e) {
      // ignore
    }
  };

  const handleSmartFix = (on) => {
    setSmartFixOn(!!on);
    try {
      localStorage.setItem(SMARTFIX_LS, on ? '1' : '0');
    } catch (e) {
      // ignore
    }
  };

  // First upload sets the mapping from detectColumns. Later uploads keep the
  // existing mapping and only refresh the row data, per the standing rule.
  const handleParsed = async ({ headers, rows, mapping: detected }) => {
    setError('');
    const useMapping = mapping || detected || {};
    setBusy(true);
    setBusyMsg('File parh li. Urdu tayyar ki ja rahi hai...');
    try {
      const built = await buildForms(rows, useMapping, {
        apiKeys,
        smartFixOn,
        month: sheetMonth,
        year: sheetYear,
        onProgress: (d, t) => setBusyMsg(`Gemini se Urdu theek ho rahi hai... ${d}/${t}`),
      });
      setHeaders(headers);
      setMapping(useMapping);
      setForms(built);
      reportGeminiStats(built);
      setStep(1);
    } catch (e) {
      setError('Rows tayyar karne mein masla hua. Dobara koshish karein.');
    } finally {
      setBusy(false);
      setBusyMsg('');
    }
  };

  // Mapping edits re-derive Urdu text from the original raw rows (local only,
  // no extra Gemini call). Manual row edits made after upload get re-derived.
  const handleMappingChange = async (newMapping) => {
    setMapping(newMapping);
    setBusy(true);
    setBusyMsg('Column mapping update ho rahi hai...');
    try {
      const rawRows = forms.map((f) => f._raw).filter(Boolean);
      const rebuilt = await buildForms(rawRows, newMapping, {
        apiKeys: [],
        smartFixOn: false,
        month: sheetMonth,
        year: sheetYear,
      });
      setForms(rebuilt);
    } finally {
      setBusy(false);
      setBusyMsg('');
    }
  };

  // Tell the user plainly whether Gemini actually ran and fixed values,
  // so a silent fallback is never mistaken for a successful correction.
  // With key rotation + retries + batch splitting inside, a failure means
  // Gemini was truly unreachable — reported as an error, never a soft
  // "some remained" note.
  const reportGeminiStats = (built) => {
    const st = built && built._geminiStats;
    if (!st || st.skipped) return;
    if (st.failed) {
      const reasons = (st.keyErrors || []).slice(0, 3).join(' | ');
      setError(
        `Gemini se rabta nahi ho saka. ` +
        `${st.fixed}/${st.attempted} values theek huin, baqi par local Urdu lagi hai.` +
        (reasons ? ` Wajah: ${reasons}` : '')
      );
    } else if (st.fixed > 0) {
      setNotice(`Gemini ne ${st.fixed} naam/department/reason Urdu me theek kar diye.`);
    }
  };

  // Re-run Gemini smart fix on the ALREADY-UPLOADED rows with the current
  // key/toggle — no re-upload needed. This is the prominent "Gemini se Urdu
  // theek karwain" action shown on the Review step. Any failure keeps the
  // local Urdu values untouched.
  const rerunSmartFix = async () => {
    const rawRows = forms.map((f) => f._raw).filter(Boolean);
    if (!rawRows.length) return;
    setError('');
    setBusy(true);
    setBusyMsg('Gemini se naam aur department Urdu me theek kiye ja rahe hain...');
    handleSmartFix(true);
    try {
      const rebuilt = await buildForms(rawRows, mapping || {}, {
        apiKeys,
        smartFixOn: true,
        month: sheetMonth,
        year: sheetYear,
        onProgress: (d, t) => setBusyMsg(`Gemini se Urdu theek ho rahi hai... ${d}/${t}`),
      });
      setForms(rebuilt);
      reportGeminiStats(rebuilt);
    } catch (e) {
      setError('Smart fix nahi chal saka. Local Urdu wali values mehfooz hain.');
    } finally {
      setBusy(false);
      setBusyMsg('');
    }
  };

  // Enrich every form with computed dates and resolved signature placements.
  // Generate receives these ready-made ("already transliterated + dates computed").
  const printableForms = useMemo(() => {
    return forms.map((f) => {
      let leaveDate = null;
      try {
        leaveDate = parseLeaveDate(f.date);
      } catch (e) {
        leaveDate = null;
      }
      let toDate = null;
      try {
        // The upper date is the first working day AFTER the leave date.
        // nextWorkingDay() already advances one day internally and skips
        // Sundays + confirmed public holidays (Sundays must be remembered).
        toDate = leaveDate ? nextWorkingDay(leaveDate, holidays || []) : null;
      } catch (e) {
        toDate = null;
      }
      return {
        ...f,
        leaveDate: leaveDate ? fmt(leaveDate) : '',
        toDate: toDate ? fmt(toDate) : '',
        sigPlacements: (() => {
          const placements = resolvePlacements(f, signatures);
          // Default HR signature is common to every form. A user-uploaded
          // HR-position signature takes precedence when present.
          if (
            defaultHrSignUrl &&
            !placements.some((p) => p.position === 'hrManager')
          ) {
            placements.push({ imageUrl: defaultHrSignUrl, position: 'hrManager' });
          }
          return placements;
        })(),
        _valid: !!leaveDate,
      };
    });
  }, [forms, signatures, holidays, defaultHrSignUrl]);

  // PIN gate: nothing of the app renders until the session unlocks.
  if (pinSet && !unlocked) {
    return <PinLock onUnlock={() => setUnlocked(true)} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="no-print bg-gradient-to-l from-emerald-700 via-emerald-700 to-emerald-800 text-white shadow-lg dark:from-emerald-950 dark:via-emerald-950 dark:to-slate-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-2xl shadow-inner ring-1 ring-white/25">
              📋
            </div>
            <div>
              <h1 className="text-lg font-extrabold leading-tight tracking-tight sm:text-2xl">Crown Leave Form App</h1>
              <p className="text-xs text-emerald-100/90 sm:text-sm">Chutti ke form banayein, sign karein, print karein.</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => setDark(!dark)}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-white/15 text-xl text-white ring-1 ring-white/25 backdrop-blur transition hover:bg-white/25 active:scale-95"
              aria-label={dark ? 'Light mode' : 'Dark mode'}
              title={dark ? 'Light mode' : 'Dark mode'}
            >
              {dark ? '☀️' : '🌙'}
            </button>
            <button
              onClick={() => setStep(2)}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-white/15 text-xl text-white ring-1 ring-white/25 backdrop-blur transition hover:bg-white/25 active:scale-95"
              aria-label="Settings"
              title="Settings"
            >
              ⚙️
            </button>
            {authReady && (
              user ? (
                <button
                  onClick={async () => {
                    if (window.confirm('Logout karna hai?')) {
                      await signOut();
                    }
                  }}
                  className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-sm font-semibold text-white ring-1 ring-white/25 backdrop-blur transition hover:bg-white/25 active:scale-95"
                  title={user.email || 'Logged in'}
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold uppercase dark:bg-emerald-600">
                    {(user.email || '?')[0]}
                  </span>
                  <span className="hidden max-w-[90px] truncate sm:inline">
                    {(user.email || '').split('@')[0]}
                  </span>
                </button>
              ) : (
                <button
                  onClick={() => setAuthOpen(true)}
                  className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-sm font-semibold text-white ring-1 ring-white/25 backdrop-blur transition hover:bg-white/25 active:scale-95"
                >
                  👤 Login
                </button>
              )
            )}
          </div>
        </div>
      </header>
      {authOpen && (
        <AuthModal
          onClose={() => setAuthOpen(false)}
          onAuth={(u) => {
            userRef.current = u;
            setUser(u);
          }}
        />
      )}

      <div className="no-print mx-auto max-w-6xl space-y-2 px-4 pt-3">
        {!online && (
          <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
            <span className="text-base">⚠️</span>
            <span>Online save off hai. Signatures sirf is session ke liye kaam karein ge.</span>
          </div>
        )}

        {notice && (
          <div className="flex items-start justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-sm dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200">
            <div className="flex items-start gap-2.5">
              <span className="text-base">✅</span>
              <span>{notice}</span>
            </div>
            <button onClick={() => setNotice('')} className="shrink-0 rounded-lg px-2 py-0.5 font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-900" aria-label="Band karein">
              ✕
            </button>
          </div>
        )}

        {error && (
          <div className="flex items-start justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 shadow-sm dark:border-red-900 dark:bg-red-950/60 dark:text-red-200">
            <div className="flex items-start gap-2.5">
              <span className="text-base">❌</span>
              <span>{error}</span>
            </div>
            <button onClick={() => setError('')} className="shrink-0 rounded-lg px-2 py-0.5 font-semibold hover:bg-red-100 dark:hover:bg-red-900" aria-label="Band karein">
              ✕
            </button>
          </div>
        )}
      </div>

      <div className="no-print mx-auto max-w-6xl px-4 pt-3">
        <nav className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900" aria-label="Steps">
          <ol className="flex items-center">
            {STEPS.map((label, i) => (
              <li key={label} className="flex min-w-0 flex-1 items-center last:flex-none">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition ' +
                      (i < step
                        ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                        : i === step
                          ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30 ring-4 ring-emerald-600/20'
                          : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400')
                    }
                  >
                    {i < step ? '✓' : i + 1}
                  </span>
                  <span
                    className={
                      'truncate whitespace-nowrap text-xs font-semibold sm:text-sm ' +
                      (i <= step ? 'text-slate-900 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500')
                    }
                  >
                    {label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <span className="relative mx-2 h-1 min-w-4 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800 sm:mx-3">
                    <span
                      className={'absolute inset-y-0 right-0 rounded-full bg-emerald-500 transition-all ' + (i < step ? 'left-0' : 'left-full')}
                    />
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      </div>

      <main className="no-print mx-auto max-w-6xl px-4 py-5">
        {step === 0 && (
          <Upload
            onParsed={handleParsed}
            month={sheetMonth}
            year={sheetYear}
            onMonthYear={(m, y) => {
              setSheetMonth(m);
              setSheetYear(y);
            }}
          />
        )}

        {step === 1 && (
          <Review
            headers={headers}
            rows={forms}
            mapping={mapping || {}}
            onMappingChange={handleMappingChange}
            onRowsChange={setForms}
            onBack={() => setStep(0)}
            onContinue={() => setStep(2)}
            apiKeys={apiKeys}
            onApiKeys={handleApiKeys}
            smartFixOn={smartFixOn}
            onSmartFix={handleSmartFix}
            onRerunSmartFix={rerunSmartFix}
            busy={busy}
          />
        )}

        {step === 2 && (
          <div className="space-y-6">
            <SignatureManager
              signatures={signatures}
              onChange={setSignatures}
              defaultHrSignUrl={defaultHrSignUrl}
              userId={user ? user.id : null}
            />
            <Settings
              apiKeys={apiKeys}
              onApiKeys={handleApiKeys}
              smartFixOn={smartFixOn}
              onSmartFix={handleSmartFix}
              holidays={holidays}
              onHolidays={setHolidays}
              sheetMonth={sheetMonth}
              sheetYear={sheetYear}
              onMonthYear={(m, y) => {
                setSheetMonth(m);
                setSheetYear(y);
              }}
            />
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                onClick={() => setStep(1)}
                className="rounded-2xl border border-slate-200 bg-white px-6 py-3 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.98] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                ← Peeche
              </button>
              <button
                onClick={() => setStep(3)}
                className="rounded-2xl bg-emerald-600 px-6 py-3 text-sm font-bold text-white shadow-md shadow-emerald-600/25 transition hover:bg-emerald-700 active:scale-[0.98]"
              >
                Aagay →
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <Generate
            forms={printableForms}
            signatures={signatures}
            onPrint={printHtmlDocument}
            onDownload={downloadHtmlDocument}
            onBack={() => setStep(2)}
          />
        )}
      </main>

      {busy && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xs rounded-3xl bg-white px-6 py-6 text-center shadow-2xl dark:bg-slate-900">
            <div className="relative mx-auto mb-4 h-14 w-14">
              <div className="absolute inset-0 animate-spin rounded-full border-4 border-emerald-100 border-t-emerald-600 dark:border-slate-700 dark:border-t-emerald-500" />
              <div className="absolute inset-0 flex items-center justify-center text-xl">⚙️</div>
            </div>
            <p className="text-sm font-medium">{busyMsg || 'Kaam ho raha hai...'}</p>
          </div>
        </div>
      )}

      <footer className="no-print mt-8 border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-4 text-xs text-slate-500 dark:text-slate-400">
          <span>📋 Crown Leave Form App</span>
          <span>Crown Textile ka internal tool</span>
        </div>
      </footer>
    </div>
  );
}
