// src/components/Settings.jsx
// App settings: Gemini API key, Smart Urdu fix toggle, public holidays per month.
// Props: { apiKey, onApiKey, smartFixOn, onSmartFix, holidays, onHolidays }
//   apiKey: current Gemini key string
//   onApiKey: (key) => void
//   smartFixOn: boolean, onSmartFix: (bool) => void
//   holidays: string[] (the currently active holiday list, session scope)
//   onHolidays: (list) => void

import { useEffect, useState } from 'react';
import { fetchKarachiHolidays } from '../lib/gemini.js';
import { isConfigured, fetchHolidays, saveHolidays } from '../lib/supabase.js';

const LS_KEY = 'crown-leave-gemini-key';

const currentMonth = () => new Date().toISOString().slice(0, 7);

// Normalize whatever the sibling's fetchKarachiHolidays returns into YYYY-MM-DD strings.
function normalizeDates(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    const str = typeof item === 'string' ? item : item && (item.date || item.holiday || item.day);
    if (!str) continue;
    const m = String(str).match(/(\d{4}-\d{2}-\d{2})/);
    if (m) out.push(m[1]);
  }
  return [...new Set(out)].sort();
}

export default function Settings({
  apiKey = '',
  onApiKey = () => {},
  smartFixOn = false,
  onSmartFix = () => {},
  holidays = [],
  onHolidays = () => {},
}) {
  const [keyInput, setKeyInput] = useState(apiKey || '');
  const [keySaved, setKeySaved] = useState(false);
  const [month, setMonth] = useState(currentMonth());
  const [review, setReview] = useState(null); // null = not reviewing, array = draft date rows
  const [reviewSource, setReviewSource] = useState('manual');
  const [geminiBusy, setGeminiBusy] = useState(false);
  const [dbList, setDbList] = useState(null);
  const [dbSource, setDbSource] = useState('');
  const [dbBusy, setDbBusy] = useState(false);
  const [error, setError] = useState('');

  // Mount: restore saved key from localStorage.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LS_KEY) || '';
      if (stored) {
        setKeyInput(stored);
        if (stored !== apiKey) onApiKey(stored);
      }
    } catch (e) {
      console.warn('[settings] localStorage read failed:', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Month change: pull confirmed holidays from DB when configured.
  useEffect(() => {
    let alive = true;
    setDbList(null);
    setDbSource('');
    if (isConfigured()) {
      setDbBusy(true);
      (async () => {
        const res = await fetchHolidays(month);
        if (!alive) return;
        if (res) {
          setDbList(res.holidays || []);
          setDbSource(res.source || '');
        }
        setDbBusy(false);
      })();
    }
    return () => {
      alive = false;
    };
  }, [month]);

  const saveKey = () => {
    const k = keyInput.trim();
    try {
      if (k) localStorage.setItem(LS_KEY, k);
      else localStorage.removeItem(LS_KEY);
    } catch (e) {
      console.warn('[settings] localStorage write failed:', e);
    }
    onApiKey(k);
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 2000);
  };

  const loadFromGemini = async () => {
    if (!apiKey || geminiBusy) return;
    setGeminiBusy(true);
    setError('');
    try {
      const dates = await fetchKarachiHolidays(month, apiKey);
      const list = normalizeDates(dates);
      if (list.length === 0) {
        setError('Gemini se koi holiday nahi mili. Manual add kar lein.');
      }
      setReview(list);
      setReviewSource('gemini');
    } catch (e) {
      console.warn('[settings] fetchKarachiHolidays failed:', e);
      setError('Gemini se holidays nahi mil sake. Manual add kar lein.');
    } finally {
      setGeminiBusy(false);
    }
  };

  const manualAdd = () => {
    setError('');
    setReviewSource('manual');
    setReview((prev) => [...(prev || []), '']);
  };

  const updateReviewRow = (i, val) => {
    setReview((prev) => prev.map((d, idx) => (idx === i ? val : d)));
  };

  const removeReviewRow = (i) => {
    setReview((prev) => prev.filter((_, idx) => idx !== i));
  };

  const confirmReview = async () => {
    const clean = [...new Set((review || []).map((d) => d.trim()).filter(Boolean))].sort();
    setDbBusy(true);
    setError('');
    try {
      let ok = true;
      if (isConfigured()) ok = await saveHolidays(month, clean, reviewSource);
      onHolidays(clean);
      setDbList(clean);
      setDbSource(reviewSource);
      setReview(null);
      if (!ok) setError('Database me save nahi ho saka, lekin list is session me set hai.');
    } finally {
      setDbBusy(false);
    }
  };

  const savedList = dbList || holidays || [];
  const savedSource = dbSource;

  return (
    <div style={s.wrap}>
      {/* Gemini API key */}
      <section style={s.section}>
        <h3 style={s.h3}>Gemini API key</h3>
        <div style={s.row}>
          <input
            type="password"
            style={{ ...s.input, flex: 1 }}
            placeholder="AIza..."
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            autoComplete="off"
          />
          <button style={s.btn} onClick={saveKey}>
            {keySaved ? 'Saved' : 'Save'}
          </button>
        </div>
        <p style={s.note}>Key sirf aapke browser me rehti hai, kahin upload nahi hoti.</p>

        <label style={s.toggleRow}>
          <input
            type="checkbox"
            checked={!!smartFixOn}
            onChange={(e) => onSmartFix(e.target.checked)}
            style={s.checkbox}
          />
          <span style={s.toggleText}>Smart Urdu fix</span>
        </label>
        <p style={s.note}>
          Smart Urdu fix aapki key ke sath gemini-2.5-flash-lite use karta hai. Cheapest model,
          minimal tokens.
        </p>
      </section>

      {/* Public holidays */}
      <section style={s.section}>
        <h3 style={s.h3}>Public holidays</h3>
        <label style={s.fieldLabel}>Month</label>
        <input
          type="month"
          style={s.input}
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
        />

        <div style={s.btnRow}>
          <button
            style={{ ...s.btn, flex: 1, opacity: apiKey ? 1 : 0.5 }}
            onClick={loadFromGemini}
            disabled={!apiKey || geminiBusy}
          >
            {geminiBusy ? 'La rahe hain...' : 'Gemini se Karachi holidays lao'}
          </button>
          <button style={{ ...s.btn, ...s.ghostBtn }} onClick={manualAdd}>
            Manual add
          </button>
        </div>

        {!apiKey && (
          <p style={s.note}>
            API key ke baghair manual mode hai. Sundays automatically off hote hain, baqi holidays
            yahan add kar lein.
          </p>
        )}
        {error && <div style={s.error}>{error}</div>}

        {/* Review list */}
        {review !== null && (
          <div style={s.reviewBox}>
            <p style={s.reviewTitle}>Review karein, phir confirm karein</p>
            {review.length === 0 && <p style={s.note}>Koi date nahi. Neeche se add karein.</p>}
            {review.map((d, i) => (
              <div key={i} style={s.row}>
                <input
                  type="date"
                  style={{ ...s.input, flex: 1 }}
                  value={d}
                  onChange={(e) => updateReviewRow(i, e.target.value)}
                />
                <button style={{ ...s.btn, ...s.ghostBtn }} onClick={() => removeReviewRow(i)}>
                  X
                </button>
              </div>
            ))}
            <div style={s.btnRow}>
              <button style={{ ...s.btn, ...s.ghostBtn, flex: 1 }} onClick={manualAdd}>
                Date add karein
              </button>
              <button style={{ ...s.btn, ...s.primaryBtn, flex: 1 }} onClick={confirmReview} disabled={dbBusy}>
                {dbBusy ? 'Saving...' : 'Confirm save'}
              </button>
            </div>
          </div>
        )}

        {/* Confirmed list for the month */}
        <div style={s.savedBox}>
          <p style={s.reviewTitle}>
            {month} ki confirmed holidays
            {savedSource ? ` (${savedSource === 'gemini' ? 'Gemini se' : 'Manual'})` : ''}
          </p>
          {dbBusy && savedList.length === 0 ? (
            <p style={s.note}>Loading...</p>
          ) : savedList.length === 0 ? (
            <p style={s.note}>Is month ke liye koi holiday save nahi hai.</p>
          ) : (
            <div style={s.chipWrap}>
              {savedList.map((d) => (
                <span key={d} style={s.chip}>
                  {d}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

const s = {
  wrap: { maxWidth: 560, margin: '0 auto', padding: '12px 12px 24px' },
  section: {
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    padding: 14,
    marginBottom: 14,
    background: '#fff',
  },
  h3: { fontSize: 17, margin: '0 0 12px' },
  row: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 },
  btnRow: { display: 'flex', gap: 8, marginTop: 10 },
  input: {
    width: '100%',
    fontSize: 16,
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    boxSizing: 'border-box',
    background: '#fff',
    color: '#0f172a',
  },
  btn: {
    padding: '10px 16px',
    fontSize: 15,
    borderRadius: 8,
    border: 'none',
    background: '#1f2937',
    color: '#fff',
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: 44,
    whiteSpace: 'nowrap',
  },
  primaryBtn: { background: '#25d366' },
  ghostBtn: { background: '#f1f5f9', color: '#0f172a', border: '1px solid #cbd5e1' },
  note: { fontSize: 13, color: '#64748b', margin: '8px 0 0', lineHeight: 1.5 },
  error: {
    background: '#fdecec',
    border: '1px solid #f3a3a3',
    color: '#a33',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 13,
    marginTop: 10,
  },
  toggleRow: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, cursor: 'pointer' },
  checkbox: { width: 22, height: 22, accentColor: '#25d366' },
  toggleText: { fontSize: 16, fontWeight: 600 },
  fieldLabel: { fontSize: 13, color: '#64748b', display: 'block', marginBottom: 6 },
  reviewBox: {
    marginTop: 12,
    border: '1px dashed #94a3b8',
    borderRadius: 10,
    padding: 12,
    background: '#f8fafc',
  },
  reviewTitle: { fontSize: 14, fontWeight: 600, margin: '0 0 10px' },
  savedBox: { marginTop: 12 },
  chipWrap: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  chip: {
    fontSize: 14,
    background: '#eef2ff',
    border: '1px solid #c7d2fe',
    color: '#3730a3',
    borderRadius: 999,
    padding: '6px 12px',
  },
};
