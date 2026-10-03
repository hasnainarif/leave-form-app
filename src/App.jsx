import { useEffect, useMemo, useState } from 'react';
import Upload from './components/Upload.jsx';
import Review from './components/Review.jsx';
import Generate from './components/Generate.jsx';
import SignatureManager from './components/SignatureManager.jsx';
import Settings from './components/Settings.jsx';
import { transliterateRow } from './lib/transliterate.js';
import { smartUrduFix } from './lib/gemini.js';
import { parseLeaveDate, nextWorkingDay, fmt } from './lib/dates.js';
import { isConfigured } from './lib/supabase.js';

// LocalStorage keys. Settings.jsx (sibling) should use GEMINI_KEY_LS too so the
// key field and App state never disagree. App writes it on every change anyway.
const GEMINI_KEY_LS = 'crown-leave-gemini-key';
const SMARTFIX_LS = 'crown-leave-smartfix';

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
// opts: { apiKey, smartFixOn, month, year } — month/year apply to bare
// day-number dates in the sheet (the register's month).
async function buildForms(rawRows, mapping, opts) {
  const { apiKey, smartFixOn, month, year } = opts || {};
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

  if (smartFixOn && apiKey) {
    const kinds = ['name', 'father', 'designation', 'department', 'reason'];
    const CHUNK = 8;
    for (let i = 0; i < forms.length; i += CHUNK) {
      const chunk = forms.slice(i, i + CHUNK);
      const items = [];
      chunk.forEach((f, ci) => {
        kinds.forEach((k) => {
          if ((f[k] || '').trim()) items.push({ ci, k });
        });
      });
      if (!items.length) continue;
      try {
        const fixed = await smartUrduFix(
          items.map((it) => chunk[it.ci][it.k]),
          items.map((it) => it.k),
          apiKey
        );
        if (Array.isArray(fixed) && fixed.length === items.length) {
          items.forEach((it, idx) => {
            const v = fixed[idx];
            if (typeof v === 'string' && v.trim()) chunk[it.ci][it.k] = v;
          });
        }
      } catch (e) {
        // silent fallback, keep local transliteration
      }
    }
  }
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
  const [apiKey, setApiKey] = useState(() => {
    try {
      return localStorage.getItem(GEMINI_KEY_LS) || '';
    } catch (e) {
      return '';
    }
  });
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

  // Row data (this is the only thing a new upload refreshes).
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState(null);
  const [forms, setForms] = useState([]);

  const [busy, setBusy] = useState(false);
  const [busyMsg, setBusyMsg] = useState('');
  const [error, setError] = useState('');
  const [online] = useState(() => {
    try {
      return isConfigured();
    } catch (e) {
      return false;
    }
  });

  const handleApiKey = (k) => {
    setApiKey(k || '');
    try {
      localStorage.setItem(GEMINI_KEY_LS, k || '');
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
        apiKey,
        smartFixOn,
        month: sheetMonth,
        year: sheetYear,
      });
      setHeaders(headers);
      setMapping(useMapping);
      setForms(built);
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
        apiKey: '',
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
        apiKey,
        smartFixOn: true,
        month: sheetMonth,
        year: sheetYear,
      });
      setForms(rebuilt);
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

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="no-print bg-emerald-700 text-white dark:bg-emerald-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="text-xl font-bold sm:text-2xl">Crown Leave Form App</h1>
            <p className="text-sm text-emerald-100 dark:text-emerald-200">Chutti ke form banayein, sign karein, print karein.</p>
          </div>
          <button
            onClick={() => setDark(!dark)}
            className="min-h-[44px] shrink-0 rounded-lg bg-emerald-800 px-3 py-2 text-sm font-semibold text-white ring-1 ring-emerald-500 hover:bg-emerald-600 dark:bg-slate-800 dark:ring-slate-600 dark:hover:bg-slate-700"
            aria-label={dark ? 'Light mode' : 'Dark mode'}
          >
            {dark ? '☀️ Light' : '🌙 Dark'}
          </button>
        </div>
      </header>

      {!online && (
        <div className="no-print bg-amber-100 text-amber-900">
          <div className="mx-auto max-w-6xl px-4 py-2 text-sm">
            Online save off hai. Signatures sirf is session ke liye kaam karein ge.
          </div>
        </div>
      )}

      {error && (
        <div className="no-print bg-red-100 text-red-900">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2 text-sm">
            <span>{error}</span>
            <button onClick={() => setError('')} className="shrink-0 font-semibold underline">
              Band karein
            </button>
          </div>
        </div>
      )}

      <nav className="no-print border-b bg-white dark:border-slate-800 dark:bg-slate-900" aria-label="Steps">
        <ol className="mx-auto flex max-w-6xl items-center px-4 py-3">
          {STEPS.map((label, i) => (
            <li key={label} className="flex min-w-0 flex-1 items-center">
              <span
                className={
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ' +
                  (i < step
                    ? 'bg-emerald-600 text-white'
                    : i === step
                      ? 'bg-emerald-100 text-emerald-800 ring-2 ring-emerald-600 dark:bg-emerald-900 dark:text-emerald-200'
                      : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300')
                }
              >
                {i < step ? '✓' : i + 1}
              </span>
              <span
                className={
                  'ml-1 truncate whitespace-nowrap text-[11px] font-medium sm:ml-2 sm:text-sm ' +
                  (i === step ? 'text-emerald-800 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400')
                }
              >
                {label}
              </span>
              {i < STEPS.length - 1 && <span className="mx-1 h-px min-w-2 flex-1 bg-slate-200 dark:bg-slate-800 sm:mx-2" />}
            </li>
          ))}
        </ol>
      </nav>

      <main className="no-print mx-auto max-w-6xl px-4 py-6">
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
            apiKey={apiKey}
            onApiKey={handleApiKey}
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
            />
            <Settings
              apiKey={apiKey}
              onApiKey={handleApiKey}
              smartFixOn={smartFixOn}
              onSmartFix={handleSmartFix}
              holidays={holidays}
              onHolidays={setHolidays}
            />
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                onClick={() => setStep(1)}
                className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Peeche
              </button>
              <button
                onClick={() => setStep(3)}
                className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Aagay
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
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="rounded-lg bg-white px-6 py-5 text-center shadow-xl dark:bg-slate-900">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
            <p className="text-sm">{busyMsg || 'Kaam ho raha hai...'}</p>
          </div>
        </div>
      )}

      <footer className="no-print border-t bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto max-w-6xl px-4 py-4 text-xs text-slate-500 dark:text-slate-400">
          Crown Textile ke liye banaya gaya internal tool.
        </div>
      </footer>
    </div>
  );
}
