import { useEffect, useMemo, useState, useRef } from 'react';
import Upload from './components/Upload.jsx';
import ManualEntry from './components/ManualEntry.jsx';
import Review from './components/Review.jsx';
import Generate from './components/Generate.jsx';
import PinLock from './components/PinLock.jsx';
import { hasPin } from './lib/pin.js';
import { transliterateRow, buildCustomDict, dictMatch } from './lib/transliterate.js';
import { URDU_FONT_DATA_URI } from './lib/urduFont.js';

// Make the proper Urdu (Nastaliq) font available to the whole app shell,
// so on-screen Urdu text uses the same font as the printed forms.
try {
  if (!document.querySelector('style[data-urdu-font]')) {
    const el = document.createElement('style');
    el.setAttribute('data-urdu-font', '');
    el.textContent =
      "@font-face{font-family:'Noto Nastaliq Urdu';src:url(" +
      URDU_FONT_DATA_URI +
      ") format('woff2');font-weight:400 700;font-display:swap;}";
    document.head.appendChild(el);
  }
} catch (e) {
  /* ignore */
}
import { smartUrduFix } from './lib/gemini.js';
import {
  BUYER_MODE,
  smartFixViaProxy,
  checkLicense,
  checkForUpdate,
  validateOnline,
  getLicenseKey,
  setLicenseKey,
  clearLicense,
  isWellFormedKey,
  getBranding,
  APP_VERSION,
} from './lib/license.js';
import { parseLeaveDate, nextWorkingDay, fmt } from './lib/dates.js';
import { isConfigured, getUser, onAuthChange, signOut, adoptOrphanRows, fetchSignatures, fetchHolidays, fetchApiKeys, saveApiKey, deleteApiKey, fetchDictionary } from './lib/supabase.js';
import AuthScreen from './components/AuthScreen.jsx';
import ApiKeysView from './components/ApiKeysView.jsx';
import SignaturesView from './components/SignaturesView.jsx';
import DictionaryView from './components/DictionaryView.jsx';
import SettingsView from './components/SettingsView.jsx';
import { tr } from './lib/strings.js';
import {
  isLocalMode,
  LOCAL_USER,
  loadLocalSignatures,
  saveLocalSignatures,
  loadLocalDictionary,
  saveLocalDictionary,
  loadLocalHolidays,
  saveLocalHolidays,
  loadOnlineMode,
  saveOnlineMode,
} from './lib/localMode.js';

// True inside the Electron PC build (window.electronAPI injected by preload).
// Local mode: no login, everything stored on the PC, master online/offline switch.
const LOCAL_MODE = isLocalMode();

// LocalStorage keys. Settings.jsx (sibling) uses GEMINI_KEYS_LS too so the
// key list and App state never disagree. App writes it on every change anyway.
const GEMINI_KEYS_LS = 'crown-leave-gemini-keys';
const GEMINI_KEY_LS_OLD = 'crown-leave-gemini-key'; // legacy single key, migrated once
const SMARTFIX_LS = 'crown-leave-smartfix';
const HR_DEFAULT_OFF_LS = 'crown-leave-hr-default-off'; // '1' = user removed the bundled HR signature

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
const LANG_LS = 'crown-leave-lang';

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
  const { apiKeys, smartFixOn, month, year, onProgress, customDict, leaveType } = opts || {};
  const keys = (Array.isArray(apiKeys) ? apiKeys : []).filter(Boolean);
  const forms = rawRows.map((row) => {
    let t = {};
    try {
      t = transliterateRow(row, mapping, { month, year, customDict }) || {};
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
      leaveType: opts.leaveType || 'sick',
      english: englishFromRow(row, mapping),
      _raw: row,
    };
  });

  // Stats so the UI can tell the user whether Gemini actually ran.
  // Buyer mode: the fix runs through the license server proxy (keys never
  // touch the app), so no local keys are needed.
  const useProxy = BUYER_MODE && smartFixOn;
  const stats = { attempted: 0, fixed: 0, failed: false, skipped: !(smartFixOn && (keys.length || useProxy)), keyErrors: [] };

  if ((smartFixOn && keys.length) || useProxy) {
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
        if (!text) return;
        // PROTECT trusted dictionary mappings: when the English value has an
        // exact dictionary match (built-in or the user's own), the local
        // result is final and Gemini must not overwrite it
        // (e.g. KNITTING -> نیٹنگ was being replaced by ٹسٹنگ).
        if (orig.trim() && dictMatch(orig, k, customDict)) {
          stats.protected = (stats.protected || 0) + 1;
          return;
        }
        items.push({ fi, k, text });
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
      let fixed;
      if (useProxy) {
        try {
          fixed = await smartFixViaProxy(items.map((it) => ({ t: it.text, kind: it.k })));
        } catch (proxyErr) {
          // Fallback: if the server proxy has no keys configured but the user
          // added local keys, use those directly instead of failing.
          if (keys.length) {
            fixed = await smartUrduFix(
              items.map((it) => it.text),
              items.map((it) => it.k),
              keys,
              (done, total) => {
                if (typeof onProgress === 'function') {
                  try { onProgress(done, total); } catch (e) { /* ignore */ }
                }
              }
            );
          } else {
            throw proxyErr;
          }
        }
      } else {
        fixed = await smartUrduFix(
          items.map((it) => it.text),
          items.map((it) => it.k),
          keys,
          (done, total) => {
            if (typeof onProgress === 'function') {
              try { onProgress(done, total); } catch (e) { /* ignore */ }
            }
          }
        );
      }
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
  // Language: English default (WAbot-style), Urdu toggle. Persisted.
  const [lang, setLang] = useState(() => {
    try {
      return localStorage.getItem(LANG_LS) || 'en';
    } catch (e) {
      return 'en';
    }
  });
  const changeLang = (l) => {
    setLang(l);
    try {
      localStorage.setItem(LANG_LS, l);
    } catch (e) {
      // ignore
    }
  };
  const t = (p, ...a) => tr(lang, p, ...a);

  // Top-level view (WAbot-style app sections, not one mixed page).
  const [view, setView] = useState('forms');
  // Workflow step inside the Forms view: 0 upload → 1 review → 2 generate.
  const [step, setStep] = useState(0);
  // Step 0 entry mode: 'file' (Excel upload) or 'manual' (type details by hand).
  const [entryMode, setEntryMode] = useState('file');

  // Settings live here at the top level and are NEVER wiped by a new upload.
  const [apiKeys, setApiKeys] = useState(loadApiKeys);
  const apiKeysRef = useRef(null);
  if (apiKeysRef.current === null) apiKeysRef.current = apiKeys;
  const [smartFixOn, setSmartFixOn] = useState(() => {
    try {
      // Default ON: Gemini verifies names, designations, departments and
      // reasons internally so nothing slips through in English. The user can
      // still turn it off; that choice is remembered.
      return localStorage.getItem(SMARTFIX_LS) !== '0';
    } catch (e) {
      return true;
    }
  });
  const [signatures, setSignatures] = useState(() =>
    LOCAL_MODE ? loadLocalSignatures() : []
  );
  const [holidays, setHolidays] = useState(() =>
    LOCAL_MODE ? loadLocalHolidays() : []
  );
  const [customDictRows, setCustomDictRows] = useState(() =>
    LOCAL_MODE ? loadLocalDictionary() : []
  );
  // Local mode: persist everything on the PC itself.
  useEffect(() => {
    if (LOCAL_MODE) saveLocalSignatures(signatures);
  }, [signatures]);
  useEffect(() => {
    if (LOCAL_MODE) saveLocalDictionary(customDictRows);
  }, [customDictRows]);
  useEffect(() => {
    if (LOCAL_MODE) saveLocalHolidays(holidays);
  }, [holidays]);
  // Master network switch (PC build): the superadmin decides whether the app
  // may touch the internet at all. Offline = Gemini never called, zero
  // external requests. Persisted, and reported to the Electron shell so it
  // can hard-block the network.
  const [onlineMode, setOnlineMode] = useState(loadOnlineMode);
  const setOnlineModePersist = (on) => {
    setOnlineMode(!!on);
    saveOnlineMode(!!on);
  };
  // Gemini only runs when the user enabled Smart Fix AND the master switch
  // allows the network. (Web build: onlineMode is always true.)
  const effectiveSmartFix = smartFixOn && onlineMode;
  const customDict = useMemo(() => buildCustomDict(customDictRows), [customDictRows]);
  const defaultHrSignUrl = useDefaultHrSignUrl();
  // The bundled HR signature prints on every form unless the user removes it.
  // Removing it is a deliberate choice, so it is remembered (and the default
  // stays off until the user restores it).
  const [hrDefaultOff, setHrDefaultOff] = useState(() => {
    try {
      return localStorage.getItem(HR_DEFAULT_OFF_LS) === '1';
    } catch (e) {
      return false;
    }
  });
  const setHrDefaultOffPersist = (off) => {
    setHrDefaultOff(off);
    try {
      localStorage.setItem(HR_DEFAULT_OFF_LS, off ? '1' : '0');
    } catch (e) {
      /* ignore */
    }
  };

  const [sheetMonth, setSheetMonth] = useState(() => new Date().getMonth() + 1);
  const [sheetYear, setSheetYear] = useState(() => new Date().getFullYear());
  const [leaveType, setLeaveType] = useState('sick');

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

  // App PIN lock: session-only, a fresh page load locks again.
  const [pinSet] = useState(hasPin);
  const [unlocked, setUnlocked] = useState(() => !hasPin());

  // Buyer license gate (licensed PC builds only; master builds skip).
  // status: 'checking' | 'ok' | 'no-key' | 'locked'
  const [licenseState, setLicenseState] = useState(() =>
    BUYER_MODE ? { status: 'checking' } : { status: 'ok' }
  );
  const [licenseKeyInput, setLicenseKeyInput] = useState('');
  const [licenseBusy, setLicenseBusy] = useState(false);
  const [licenseError, setLicenseError] = useState('');
  const [updateInfo, setUpdateInfo] = useState(null);

  const runLicenseCheck = async () => {
    if (!BUYER_MODE) return;
    setLicenseState({ status: 'checking' });
    const res = await checkLicense();
    if (res.ok) {
      setLicenseState({ status: 'ok', branding: res.branding || null, offline: !!res.offline });
      // Update check (online only, failures are silent).
      try {
        const upd = await checkForUpdate();
        if (upd) setUpdateInfo(upd);
      } catch { /* ignore */ }
    } else {
      setLicenseState({ status: res.reason === 'no-key' ? 'no-key' : 'locked', reason: res.reason, branding: res.branding || null });
    }
  };

  useEffect(() => {
    if (BUYER_MODE) runLicenseCheck();
  }, []);

  const submitLicenseKey = async () => {
    const k = licenseKeyInput.trim().toUpperCase();
    if (!isWellFormedKey(k)) {
      setLicenseError('Key sahi nahi lag rahi. Format: PREFIX-XXXXXXXX');
      return;
    }
    setLicenseBusy(true);
    setLicenseError('');
    try {
      setLicenseKey(k);
      const res = await validateOnline(k);
      if (res.status === 'valid') {
        setLicenseState({ status: 'ok', branding: res.branding || null });
      } else {
        clearLicense();
        setLicenseError('Ye key valid nahi hai (' + (res.reason || 'invalid') + ').');
      }
    } catch {
      setLicenseError('Internet nahi mil raha. Pehli dafa key activate karne ke liye online hona zaroori hai.');
    } finally {
      setLicenseBusy(false);
    }
  };

  // Auth: the whole app sits behind a confirmed login. No local mode.
  // (PC build: LOCAL_MODE skips all of this — the superadmin is signed in
  // locally, no account needed.)
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const userRef = useRef(null);
  const cloudSyncedRef = useRef(false);

  useEffect(() => {
    if (LOCAL_MODE) {
      userRef.current = LOCAL_USER;
      setUser(LOCAL_USER);
      setAuthReady(true);
      saveOnlineMode(loadOnlineMode());
      return;
    }
    let alive = true;
    const syncCloud = async () => {
      const u = userRef.current;
      if (!u || cloudSyncedRef.current) return;
      cloudSyncedRef.current = true;
      await adoptOrphanRows();
      const vaultKeys = await fetchApiKeys();
      if (alive && Array.isArray(vaultKeys) && vaultKeys.length) {
        const merged = [...(apiKeysRef.current || [])];
        vaultKeys.forEach((k) => {
          if (!merged.includes(k)) merged.push(k);
        });
        if (merged.length !== (apiKeysRef.current || []).length) {
          handleApiKeys(merged);
          setNotice(t('keys.keyCount', merged.length));
        }
      }
      const rows = await fetchSignatures();
      if (alive && Array.isArray(rows)) setSignatures(rows);
      const dictRows = await fetchDictionary();
      if (alive && Array.isArray(dictRows)) setCustomDictRows(dictRows);
      const hm =
        sheetMonth && sheetYear
          ? `${sheetYear}-${String(sheetMonth).padStart(2, '0')}`
          : null;
      if (hm) {
        const hres = await fetchHolidays(hm);
        if (alive) setHolidays(hres ? hres.holidays : []);
      }
    };
    (async () => {
      const u = await getUser();
      if (!alive) return;
      userRef.current = u;
      setUser(u);
      setAuthReady(true);
      if (u) syncCloud();
    })();
    const off = onAuthChange(async (u) => {
      if (!alive) return;
      const wasOut = !userRef.current && u;
      userRef.current = u;
      setUser(u);
      if (u && wasOut) {
        cloudSyncedRef.current = false;
      }
      if (u) {
        syncCloud();
      } else {
        cloudSyncedRef.current = false;
        setSignatures([]);
        setHolidays([]);
        setView('forms');
        setStep(0);
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

  // Saved batches — user can save finalized forms for later use without data loss
  const SAVED_KEY = 'crown-leave-saved-batches';
  const [savedBatches, setSavedBatches] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]');
    } catch { return []; }
  });
  const persistSaved = (list) => {
    setSavedBatches(list);
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch {}
  };
  const saveCurrentBatch = (name) => {
    if (!forms.length) return;
    const batch = {
      id: Date.now().toString(),
      name: name || `Batch ${new Date().toLocaleString()}`,
      created: new Date().toISOString(),
      count: forms.length,
      forms: forms,
      mapping: mapping || {},
    };
    persistSaved([batch, ...savedBatches]);
    setNotice(lang === 'ur' ? `✅ "${batch.name}" save ho gaya` : `✅ "${batch.name}" saved`);
    setTimeout(() => setNotice(''), 3000);
  };
  const loadBatch = (id) => {
    const b = savedBatches.find(x => x.id === id);
    if (b) {
      setForms(b.forms || []);
      // Saved batches now store their mapping; older batches saved before
      // that need a fallback so manual entries can continue without the
      // "columns must be mapped" block.
      if (b.mapping && Object.keys(b.mapping).length) {
        setMapping(b.mapping);
      } else {
        const identity = {};
        ['ecode', 'name', 'father', 'designation', 'department', 'date', 'reason']
          .forEach((f) => { identity[f] = f; });
        setMapping(identity);
      }
    }
  };
  const deleteBatch = (id) => {
    persistSaved(savedBatches.filter(x => x.id !== id));
    setNotice(lang === 'ur' ? '🗑️ Batch delete ho gaya' : '🗑️ Batch deleted');
    setTimeout(() => setNotice(''), 3000);
  };

  const [busy, setBusy] = useState(false);
  const [busyMsg, setBusyMsg] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Floating scroll buttons: show "top" when scrolled down, "bottom" when not near bottom.
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY || document.documentElement.scrollTop || 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setShowScrollTop(y > 300);
      setShowScrollBottom(max > 400 && y < max - 300);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  const handleApiKeys = (keys) => {
    const arr = (Array.isArray(keys) ? keys : [])
      .map((k) => String(k || '').trim())
      .filter(Boolean);
    const prev = apiKeysRef.current || [];
    setApiKeys(arr);
    apiKeysRef.current = arr;
    try {
      localStorage.setItem(GEMINI_KEYS_LS, JSON.stringify(arr));
    } catch (e) {
      // ignore
    }
    if (userRef.current) {
      const added = arr.filter((k) => !prev.includes(k));
      const removed = prev.filter((k) => !arr.includes(k));
      added.forEach((k) => {
        saveApiKey(k);
      });
      removed.forEach((k) => {
        deleteApiKey(k);
      });
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

  const handleParsed = async ({ headers, rows, mapping: detected }) => {
    setError('');
    const useMapping = mapping || detected || {};
    setBusy(true);
    setBusyMsg(t('busy.parsing'));
    try {
      const built = await buildForms(rows, useMapping, {
        apiKeys,
        smartFixOn: effectiveSmartFix,
        month: sheetMonth,
        year: sheetYear,
        customDict,
        leaveType,
        onProgress: (d, total) => setBusyMsg(t('busy.fixing', d, total)),
      });
      setHeaders(headers);
      setMapping(useMapping);
      setForms(built);
      reportGeminiStats(built);
      setStep(1);
    } catch (e) {
      setError(t('busy.parseFail'));
    } finally {
      setBusy(false);
      setBusyMsg('');
    }
  };

  // Manual entry: the operator types one employee's details by hand.
  // Reuses the exact same buildForms pipeline (dictionary, smart fix, dates)
  // as the Excel flow, so a hand-typed row behaves identically.
  const handleManualSubmit = async (values) => {
    setError('');
    const headers = ['ecode', 'name', 'father', 'designation', 'department', 'date', 'reason'];
    const row = {};
    headers.forEach((h) => {
      row[h] = values[h] != null ? String(values[h]) : '';
    });
    const useMapping = {};
    headers.forEach((h) => {
      useMapping[h] = h;
    });
    setBusy(true);
    setBusyMsg(t('busy.parsing'));
    try {
      const built = await buildForms([row], useMapping, {
        apiKeys,
        smartFixOn: effectiveSmartFix,
        month: sheetMonth,
        year: sheetYear,
        customDict,
        leaveType,
        onProgress: (d, total) => setBusyMsg(t('busy.fixing', d, total)),
      });
      setHeaders(headers);
      setMapping(useMapping);
      setForms(built);
      reportGeminiStats(built);
      setStep(1);
    } catch (e) {
      setError(t('busy.parseFail'));
    } finally {
      setBusy(false);
      setBusyMsg('');
    }
  };

  const handleMappingChange = async (newMapping) => {
    setMapping(newMapping);
    setBusy(true);
    setBusyMsg(t('busy.mapping'));
    try {
      const rawRows = forms.map((f) => f._raw).filter(Boolean);
      const rebuilt = await buildForms(rawRows, newMapping, {
        apiKeys: [],
        smartFixOn: false,
        month: sheetMonth,
        year: sheetYear,
        customDict,
        leaveType: (forms[0] && forms[0].leaveType) || leaveType,
      });
      setForms(rebuilt);
    } finally {
      setBusy(false);
      setBusyMsg('');
    }
  };

  const reportGeminiStats = (built) => {
    const st = built && built._geminiStats;
    if (!st || st.skipped) return;
    if (st.failed) {
      const reasons = (st.keyErrors || []).slice(0, 3).join(' | ');
      setError(t('busy.geminiFail', st.fixed, st.attempted) + (reasons ? ` ${reasons}` : ''));
    } else if (st.fixed > 0) {
      setNotice(t('busy.geminiOk', st.fixed));
    }
  };

  const rerunSmartFix = async () => {
    const rawRows = forms.map((f) => f._raw).filter(Boolean);
    if (!rawRows.length) return;
    setError('');
    setBusy(true);
    setBusyMsg(t('busy.rerun'));
    handleSmartFix(true);
    try {
      const rebuilt = await buildForms(rawRows, mapping || {}, {
        apiKeys,
        smartFixOn: effectiveSmartFix,
        month: sheetMonth,
        year: sheetYear,
        customDict,
        leaveType: (forms[0] && forms[0].leaveType) || leaveType,
        onProgress: (d, total) => setBusyMsg(t('busy.fixing', d, total)),
      });
      setForms(rebuilt);
      reportGeminiStats(rebuilt);
    } catch (e) {
      setError(t('busy.rerunFail'));
    } finally {
      setBusy(false);
      setBusyMsg('');
    }
  };

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
          if (
            defaultHrSignUrl &&
            !hrDefaultOff &&
            !placements.some((p) => p.position === 'hrManager')
          ) {
            placements.push({ imageUrl: defaultHrSignUrl, position: 'hrManager' });
          }
          return placements;
        })(),
        _valid: !!leaveDate,
      };
    });
  }, [forms, signatures, holidays, defaultHrSignUrl, hrDefaultOff]);

  const doSignOut = async () => {
    await signOut();
  };

  // ---- Gates ----
  if (!authReady) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#faf9f7] dark:bg-slate-950">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600" />
      </div>
    );
  }
  if (!user) {
    return <AuthScreen lang={lang} onLang={changeLang} onAuth={(u) => setUser(u)} />;
  }
  if (pinSet && !unlocked) {
    return <PinLock onUnlock={() => setUnlocked(true)} />;
  }

  // ---- Buyer license gates ----
  if (BUYER_MODE && licenseState.status === 'checking') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#faf9f7] dark:bg-slate-950">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600" />
          <p className="mt-3 text-sm font-semibold text-zinc-500">License check ho rahi hai…</p>
        </div>
      </div>
    );
  }
  if (BUYER_MODE && licenseState.status === 'no-key') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#faf9f7] p-4 dark:bg-slate-950">
        <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl dark:bg-slate-900">
          <div className="text-center text-4xl">🔑</div>
          <h1 className="mt-2 text-center text-xl font-extrabold">License Key</h1>
          <p className="mt-1 text-center text-sm text-zinc-500">
            Apni license key darj karein jo aap ko di gayi thi.
          </p>
          <input
            value={licenseKeyInput}
            onChange={(e) => setLicenseKeyInput(e.target.value.toUpperCase())}
            placeholder="CROWN-XXXXXXXX"
            className="mt-4 w-full rounded-2xl border-2 border-zinc-200 px-4 py-3 text-center font-mono text-lg font-bold tracking-widest dark:border-slate-700 dark:bg-slate-800"
          />
          {licenseError && <p className="mt-2 text-center text-sm font-semibold text-red-600">{licenseError}</p>}
          <button
            onClick={submitLicenseKey}
            disabled={licenseBusy}
            className="mt-4 min-h-[48px] w-full rounded-2xl bg-emerald-600 text-base font-extrabold text-white disabled:opacity-50"
          >
            {licenseBusy ? 'Check ho rahi hai…' : 'Activate'}
          </button>
        </div>
      </div>
    );
  }
  if (BUYER_MODE && licenseState.status === 'locked') {
    const reasonText = {
      'suspended': 'Ye license suspend kar di gayi hai. Apne provider se rabta karein.',
      'revoked': 'Ye license revoke kar di gayi hai. Apne provider se rabta karein.',
      'invalid': 'Ye license valid nahi hai.',
      'grace-expired': 'Offline muddat khatam. Internet on karke dobara kholein taake license verify ho sake.',
      'offline': 'Internet nahi mil raha aur koi valid license cache nahi hai.',
    }[licenseState.reason] || 'License ka masla hai.';
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#faf9f7] p-4 dark:bg-slate-950">
        <div className="w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-xl dark:bg-slate-900">
          <div className="text-4xl">🔒</div>
          <h1 className="mt-2 text-xl font-extrabold">App Locked</h1>
          <p className="mt-2 text-sm text-zinc-500">{reasonText}</p>
          <button
            onClick={runLicenseCheck}
            className="mt-4 min-h-[48px] w-full rounded-2xl bg-emerald-600 text-base font-extrabold text-white"
          >
            Dobara check karein
          </button>
          <button
            onClick={() => {
              clearLicense();
              setLicenseKeyInput('');
              setLicenseError('');
              setLicenseState({ status: 'no-key' });
            }}
            className="mt-2 min-h-[48px] w-full rounded-2xl border-2 border-zinc-200 text-base font-bold text-zinc-600 dark:border-slate-700 dark:text-zinc-300"
          >
            Nayi license key darj karein
          </button>
        </div>
      </div>
    );
  }

  // ---- App shell (WAbot-style): sidebar on desktop, bottom nav on mobile ----
  // Buyer builds show only the basic features: forms, signatures, settings.
  const NAV = BUYER_MODE
    ? [
        { id: 'forms', label: t('nav.forms'), icon: '📋' },
        { id: 'signs', label: t('nav.signs'), icon: '✍️' },
        { id: 'dict', label: t('nav.dict'), icon: '📖' },
        { id: 'settings', label: t('nav.settings'), icon: '⚙️' },
      ]
    : [
        { id: 'forms', label: t('nav.forms'), icon: '📋' },
        { id: 'keys', label: t('nav.keys'), icon: '🔑' },
        { id: 'signs', label: t('nav.signs'), icon: '✍️' },
        { id: 'dict', label: t('nav.dict'), icon: '📖' },
        { id: 'settings', label: t('nav.settings'), icon: '⚙️' },
      ];
  const FORM_STEPS = [t('steps.upload'), t('steps.review'), t('steps.generate')];
  const userEmail = user.email || '';

  const navBtn = (item, mobile) =>
    mobile ? (
      <button
        key={item.id}
        onClick={() => setView(item.id)}
        className={
          'flex flex-1 flex-col items-center gap-0.5 rounded-2xl py-2 text-[11px] font-bold transition ' +
          (view === item.id
            ? 'text-emerald-700 dark:text-emerald-400'
            : 'text-zinc-400 dark:text-slate-500')
        }
      >
        <span className="text-xl">{item.icon}</span>
        {item.label}
      </button>
    ) : (
      <button
        key={item.id}
        onClick={() => setView(item.id)}
        className={
          'flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold transition ' +
          (view === item.id
            ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/25'
            : 'text-zinc-600 hover:bg-zinc-100 dark:text-slate-300 dark:hover:bg-slate-800')
        }
      >
        <span className="text-lg">{item.icon}</span>
        {item.label}
      </button>
    );

  return (
    <div className="min-h-dvh bg-[#faf9f7] text-zinc-900 dark:bg-slate-950 dark:text-zinc-100 md:flex">
      {/* Desktop sidebar — locked: sticky so it stays visible while content scrolls */}
      <aside className="no-print sticky top-0 hidden h-dvh w-64 shrink-0 flex-col self-start overflow-y-auto border-r border-zinc-200/70 bg-white px-4 py-6 dark:border-slate-800 dark:bg-slate-900 md:flex">
        <div className="mb-8 flex items-center gap-2.5 px-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-600 text-xl text-white shadow-md shadow-emerald-600/30">
            📋
          </span>
          <div>
            <p className="text-base font-extrabold tracking-tight">{t('appName')}</p>
            <p className="text-[11px] text-zinc-400">{t('appTag')}</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1.5">{NAV.map((n) => navBtn(n, false))}</nav>
        <div className="mt-6 rounded-2xl bg-zinc-50 p-3 dark:bg-slate-800">
          <p className="truncate text-xs font-semibold text-zinc-500 dark:text-slate-400">
            {LOCAL_MODE ? '👑 Superadmin' : t('user.signedInAs')}
          </p>
          <p className="truncate text-sm font-bold">{userEmail}</p>
          {LOCAL_MODE ? (
            <button
              onClick={() => setView('settings')}
              title={t('superadmin.modePill')}
              className={
                'mt-2 flex w-full items-center justify-center gap-1.5 rounded-full border py-1.5 text-xs font-extrabold transition ' +
                (onlineMode
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                  : 'border-zinc-300 bg-zinc-100 text-zinc-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300')
              }
            >
              {onlineMode ? '🟢 ' + t('superadmin.online') : '🔴 ' + t('superadmin.offline')}
            </button>
          ) : (
            <button
              onClick={doSignOut}
              className="mt-2 w-full rounded-full border border-zinc-200 bg-white py-1.5 text-xs font-bold text-zinc-600 transition hover:bg-zinc-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            >
              {t('user.signOut')}
            </button>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="no-print sticky top-0 z-20 flex items-center justify-between border-b border-zinc-200/70 bg-white/90 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 md:hidden">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-lg text-white">
              📋
            </span>
            <span className="text-base font-extrabold tracking-tight">{t('appName')}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => changeLang(lang === 'en' ? 'ur' : 'en')}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-bold text-zinc-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              {lang === 'en' ? 'اردو' : 'EN'}
            </button>
            {LOCAL_MODE ? (
              <button
                onClick={() => setView('settings')}
                className={
                  'rounded-full border px-3 py-1.5 text-xs font-extrabold ' +
                  (onlineMode
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                    : 'border-zinc-300 bg-zinc-100 text-zinc-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300')
                }
              >
                {onlineMode ? '🟢 ' + t('superadmin.online') : '🔴 ' + t('superadmin.offline')}
              </button>
            ) : (
              <button
                onClick={doSignOut}
                title={t('user.signOut')}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
              >
                {userEmail ? userEmail[0].toUpperCase() : '•'}
              </button>
            )}
          </div>
        </header>

        {/* Banners */}
        <div className="no-print mx-auto w-full max-w-6xl space-y-2 px-4 pt-4">
          {BUYER_MODE && updateInfo && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
              <span>🚀 <b>Naya version {updateInfo.version} available hai.</b>{updateInfo.notes ? ' ' + updateInfo.notes : ''}</span>
              <div className="flex gap-2">
                <a
                  href={updateInfo.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full bg-amber-600 px-4 py-1.5 text-xs font-extrabold text-white"
                >
                  Download
                </a>
                <button
                  onClick={() => setUpdateInfo(null)}
                  className="rounded-full px-3 py-1.5 text-xs font-bold hover:bg-amber-100 dark:hover:bg-amber-900"
                >
                  ✕
                </button>
              </div>
            </div>
          )}
          {BUYER_MODE && licenseState.offline && (
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold text-zinc-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
              📴 Offline mode — license cache se chal raha hai.
            </div>
          )}
          {notice && (
            <div className="flex items-start justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200">
              <span>✅ {notice}</span>
              <button
                onClick={() => setNotice('')}
                className="shrink-0 rounded-lg px-2 font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-900"
                aria-label={t('close')}
              >
                ✕
              </button>
            </div>
          )}
          {error && (
            <div className="flex items-start justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200">
              <span>❌ {error}</span>
              <button
                onClick={() => setError('')}
                className="shrink-0 rounded-lg px-2 font-semibold hover:bg-red-100 dark:hover:bg-red-900"
                aria-label={t('close')}
              >
                ✕
              </button>
            </div>
          )}
        </div>

        {/* Main */}
        <main className="no-print mx-auto w-full max-w-6xl flex-1 px-4 py-5 pb-28 md:pb-10">
          {view === 'forms' && (
            <div>
              {savedBatches.length > 0 && (
                <div className="mb-5 rounded-3xl bg-blue-50 px-4 py-3 shadow-sm ring-1 ring-blue-100 dark:bg-slate-800 dark:ring-slate-700">
                  <h3 className="mb-2 text-sm font-bold text-blue-900 dark:text-blue-200">
                    {lang === 'ur' ? '💾 Save kiye gaye batches' : '💾 Saved batches'}
                  </h3>
                  <div className="flex flex-col gap-2">
                    {savedBatches.map((b) => (
                      <div key={b.id} className="flex items-center justify-between rounded-xl bg-white px-3 py-2 shadow-sm dark:bg-slate-900">
                        <div>
                          <div className="text-sm font-semibold">{b.name}</div>
                          <div className="text-xs text-zinc-500">
                            {b.count} forms · {new Date(b.created).toLocaleString()}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => { loadBatch(b.id); setStep(1); }}
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
                          >
                            {lang === 'ur' ? 'Kholein' : 'Open'}
                          </button>
                          <button
                            onClick={() => deleteBatch(b.id)}
                            className="rounded-lg bg-red-100 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-200"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <nav
                className="mb-5 rounded-3xl bg-white px-4 py-3 shadow-sm ring-1 ring-zinc-100 dark:bg-slate-900 dark:ring-slate-800"
                aria-label="Steps"
              >
                <ol className="flex items-center">
                  {FORM_STEPS.map((label, i) => (
                    <li key={label} className="flex min-w-0 flex-1 items-center last:flex-none">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={
                            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition ' +
                            (i < step || (i === step && step === 2 && forms.length)
                              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                              : i === step
                                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30 ring-4 ring-emerald-600/20'
                                : 'bg-zinc-100 text-zinc-400 dark:bg-slate-800 dark:text-slate-500')
                          }
                        >
                          {i < step ? '✓' : i + 1}
                        </span>
                        <span
                          className={
                            'truncate text-xs font-bold sm:text-sm ' +
                            (i <= step
                              ? 'text-zinc-900 dark:text-zinc-100'
                              : 'text-zinc-400 dark:text-slate-500')
                          }
                        >
                          {label}
                        </span>
                      </div>
                      {i < FORM_STEPS.length - 1 && (
                        <span className="relative mx-2 h-1 min-w-4 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-slate-800 sm:mx-3">
                          <span
                            className={
                              'absolute inset-y-0 right-0 rounded-full bg-emerald-500 transition-all ' +
                              (i < step ? 'left-0' : 'left-full')
                            }
                          />
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </nav>

              {step === 0 && (
                <div>
                  <div
                    className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-white p-1 shadow-sm ring-1 ring-zinc-100 dark:bg-slate-900 dark:ring-slate-800"
                    role="tablist"
                    aria-label="Entry mode"
                  >
                    {[
                      ['file', '📁', t('manual.tabFile')],
                      ['manual', '✍️', t('manual.tabManual')],
                    ].map(([id, icon, label]) => (
                      <button
                        key={id}
                        role="tab"
                        aria-selected={entryMode === id}
                        type="button"
                        onClick={() => setEntryMode(id)}
                        className={
                          'min-h-[48px] rounded-xl text-sm font-extrabold transition ' +
                          (entryMode === id
                            ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/25'
                            : 'text-zinc-500 hover:bg-zinc-50 dark:text-slate-400 dark:hover:bg-slate-800')
                        }
                      >
                        {icon} {label}
                      </button>
                    ))}
                  </div>
                  {entryMode === 'file' ? (
                    <Upload
                      lang={lang}
                      onParsed={handleParsed}
                      month={sheetMonth}
                      year={sheetYear}
                      onMonthYear={(m, y) => {
                        setSheetMonth(m);
                        setSheetYear(y);
                      }}
                      leaveType={leaveType}
                      onLeaveType={setLeaveType}
                      holidays={holidays}
                      onHolidays={setHolidays}
                      apiKeys={apiKeys}
                    />
                  ) : (
                    <ManualEntry
                      lang={lang}
                      leaveType={leaveType}
                      onLeaveType={setLeaveType}
                      onSubmit={handleManualSubmit}
                      busy={busy}
                    />
                  )}
                </div>
              )}
              {step === 1 && (
                <Review
                  lang={lang}
                  headers={headers}
                  rows={forms}
                  mapping={mapping || {}}
                  onMappingChange={handleMappingChange}
                  onRowsChange={setForms}
                  onBack={() => setStep(0)}
                  onContinue={() => setStep(2)}
                  apiKeys={apiKeys}
                  onManageKeys={() => setView('keys')}
                  smartFixOn={smartFixOn}
                  onSmartFix={handleSmartFix}
                  onRerunSmartFix={rerunSmartFix}
                  busy={busy}
                />
              )}
              {step === 2 && (
                <Generate
                  lang={lang}
                  forms={printableForms}
                  signatures={signatures}
                  branding={licenseState.branding || null}
                  onPrint={printHtmlDocument}
                  onDownload={downloadHtmlDocument}
                  onSave={saveCurrentBatch}
                  onBack={() => setStep(1)}
                  onNewBatch={() => {
                    setForms([]);
                    setHeaders([]);
                    setMapping(null);
                    setStep(0);
                    setView('forms');
                  }}
                />
              )}
            </div>
          )}

          {view === 'keys' && (
            <ApiKeysView lang={lang} apiKeys={apiKeys} onApiKeys={handleApiKeys} />
          )}

          {view === 'signs' && (
            <SignaturesView
              lang={lang}
              signatures={signatures}
              onChange={setSignatures}
              userId={user?.id}
              defaultHrSignUrl={defaultHrSignUrl}
              hrDefaultOff={hrDefaultOff}
              onRemoveDefaultHr={() => setHrDefaultOffPersist(true)}
              onRestoreDefaultHr={() => setHrDefaultOffPersist(false)}
            />
          )}

          {view === 'dict' && (
            <DictionaryView
              lang={lang}
              customRows={customDictRows}
              onCustomChange={setCustomDictRows}
            />
          )}

          {view === 'settings' && (
            <SettingsView
              lang={lang}
              onLang={changeLang}
              dark={dark}
              onDark={setDark}
              apiKeys={apiKeys}
              holidays={holidays}
              onHolidays={setHolidays}
              sheetMonth={sheetMonth}
              sheetYear={sheetYear}
              onMonthYear={(m, y) => {
                setSheetMonth(m);
                setSheetYear(y);
              }}
              localMode={LOCAL_MODE}
              onlineMode={onlineMode}
              onOnlineMode={setOnlineModePersist}
            />
          )}
        </main>

        {/* Mobile bottom nav */}
        <nav className="no-print fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200/70 bg-white/95 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 md:hidden">
          <div className="flex">{NAV.map((n) => navBtn(n, true))}</div>
        </nav>
      </div>

      {/* Floating scroll buttons — all views; hidden when printing; above mobile bottom nav */}
      {(showScrollTop || showScrollBottom) && (
        <div className="no-print fixed bottom-20 right-4 z-30 flex flex-col gap-2 md:bottom-6 md:right-6">
          {showScrollBottom && (
            <button
              onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })}
              title="Neeche jayein"
              aria-label="Scroll to bottom"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-600 text-lg font-bold text-white shadow-lg shadow-emerald-600/30 transition hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
            >
              ↓
            </button>
          )}
          {showScrollTop && (
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              title="Oopar jayein"
              aria-label="Scroll to top"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-600 text-lg font-bold text-white shadow-lg shadow-emerald-600/30 transition hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
            >
              ↑
            </button>
          )}
        </div>
      )}

      {busy && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xs rounded-3xl bg-white px-6 py-6 text-center shadow-2xl dark:bg-slate-900">
            <div className="relative mx-auto mb-4 h-14 w-14">
              <div className="absolute inset-0 animate-spin rounded-full border-4 border-emerald-100 border-t-emerald-600 dark:border-slate-700 dark:border-t-emerald-500" />
              <div className="absolute inset-0 flex items-center justify-center text-xl">⚙️</div>
            </div>
            <p className="text-sm font-medium">{busyMsg || t('busy.working')}</p>
          </div>
        </div>
      )}
    </div>
  );
}
