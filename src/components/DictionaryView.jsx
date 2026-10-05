import { useMemo, useState } from 'react';
import { tr } from '../lib/strings.js';
import {
  DEPT_DICT,
  DESIG_DICT,
  NAME_DICT,
  REASON_DICT,
} from '../lib/transliterate.js';
import {
  DICT_CATEGORIES,
  saveDictionaryEntry,
  deleteDictionaryEntry,
} from '../lib/supabase.js';

const BUILTIN = [
  ['designation', DESIG_DICT],
  ['department', DEPT_DICT],
  ['name', NAME_DICT],
  ['reason', REASON_DICT],
];

/**
 * DictionaryView — browse the built-in English->Urdu dictionaries and manage
 * the user's own entries. Custom entries override built-ins during import.
 * Props: { lang, customRows, onCustomChange }
 */
export default function DictionaryView({ lang = 'en', customRows = [], onCustomChange = () => {} }) {
  const t = (k, ...a) => tr(lang, k, ...a);
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('all');
  const [en, setEn] = useState('');
  const [ur, setUr] = useState('');
  const [newCat, setNewCat] = useState('designation');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const catLabel = (c) =>
    c === 'designation' ? t('dict.catDesignation')
    : c === 'department' ? t('dict.catDepartment')
    : c === 'name' ? t('dict.catName')
    : t('dict.catReason');

  const allEntries = useMemo(() => {
    const list = [];
    const customKeys = new Set(
      (customRows || []).map((r) => `${r.category}::${String(r.english || '').trim().toUpperCase()}`)
    );
    for (const [category, dict] of BUILTIN) {
      for (const [english, urdu] of Object.entries(dict)) {
        const overridden = customKeys.has(`${category}::${english}`);
        list.push({ english, urdu, category, builtin: true, overridden });
      }
    }
    for (const r of customRows || []) {
      list.push({ id: r.id, english: r.english, urdu: r.urdu, category: r.category, builtin: false });
    }
    list.sort((a, b) =>
      a.category.localeCompare(b.category) || a.english.localeCompare(b.english)
    );
    return list;
  }, [customRows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allEntries.filter((e) => {
      if (cat !== 'all' && e.category !== cat) return false;
      if (!q) return true;
      return (
        e.english.toLowerCase().includes(q) ||
        String(e.urdu).includes(search.trim())
      );
    });
  }, [allEntries, search, cat]);

  // Cap rendered rows for smooth scrolling on phones.
  const shown = filtered.slice(0, 400);

  const handleSave = async () => {
    setError('');
    if (!en.trim() || !ur.trim()) return;
    setSaving(true);
    try {
      const saved = await saveDictionaryEntry({ english: en, urdu, category: newCat });
      if (!saved) {
        setError(t('dict.saveFail'));
        return;
      }
      const next = [...(customRows || []).filter((r) => r.id !== saved.id), saved];
      onCustomChange(next);
      setEn('');
      setUr('');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm(t('dict.confirmDelete'))) return;
    setError('');
    const ok = await deleteDictionaryEntry(id);
    if (!ok) {
      setError(t('dict.deleteFail'));
      return;
    }
    onCustomChange((customRows || []).filter((r) => r.id !== id));
  };

  const inputCls =
    'min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900';

  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="text-xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50">
        {t('dict.title')}
      </h1>
      <p className="mb-5 mt-1 text-sm text-zinc-500 dark:text-slate-400">{t('dict.sub')}</p>

      {/* Add form */}
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-bold">{t('dict.addTitle')}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <input
            value={en}
            onChange={(e) => setEn(e.target.value)}
            placeholder={t('dict.englishPh')}
            className={inputCls}
            dir="ltr"
          />
          <input
            value={ur}
            onChange={(e) => setUr(e.target.value)}
            placeholder={t('dict.urduPh')}
            className={inputCls + ' font-urdu'}
            dir="rtl"
            lang="ur"
          />
        </div>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <select
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
            className={inputCls + ' sm:max-w-[220px]'}
            aria-label={t('dict.category')}
          >
            {DICT_CATEGORIES.map((c) => (
              <option key={c} value={c}>{catLabel(c)}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !en.trim() || !ur.trim()}
            className="min-h-[44px] rounded-lg bg-emerald-600 px-5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? t('dict.saving') : t('dict.save')}
          </button>
        </div>
        {error && (
          <p className="mt-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
      </section>

      {/* Search + filter */}
      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('dict.searchPh')}
          className={inputCls}
        />
        <select
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          className={inputCls + ' sm:max-w-[200px]'}
          aria-label={t('dict.category')}
        >
          <option value="all">{t('dict.all')}</option>
          {DICT_CATEGORIES.map((c) => (
            <option key={c} value={c}>{catLabel(c)}</option>
          ))}
        </select>
      </div>
      <p className="mt-2 text-xs text-zinc-500 dark:text-slate-400">
        {t('dict.count', filtered.length)}
        {filtered.length > shown.length ? ` (${t('dict.count', shown.length)} shown)` : ''}
      </p>

      {/* List */}
      <div className="mt-3 space-y-2">
        {shown.length === 0 && (
          <p className="rounded-2xl border border-slate-200 bg-white p-5 text-center text-sm text-zinc-500 dark:border-slate-800 dark:bg-slate-900">
            {t('dict.empty')}
          </p>
        )}
        {shown.map((e, i) => (
          <div
            key={(e.builtin ? 'b' : 'c') + e.category + e.english + i}
            className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold" dir="ltr" style={{ textAlign: 'left' }}>
                {e.english}
              </div>
              <div className="text-xs text-zinc-500 dark:text-slate-400">{catLabel(e.category)}</div>
            </div>
            <div className="font-urdu shrink-0 text-base" dir="rtl" lang="ur">
              {e.urdu}
            </div>
            {e.builtin ? (
              <span
                className={
                  'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ' +
                  (e.overridden
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                    : 'bg-zinc-100 text-zinc-500 dark:bg-slate-800 dark:text-slate-400')
                }
                title={e.overridden ? t('dict.customBadge') : ''}
              >
                {e.overridden ? t('dict.customBadge') : t('dict.builtinBadge')}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => handleDelete(e.id)}
                className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
              >
                {t('remove')}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
