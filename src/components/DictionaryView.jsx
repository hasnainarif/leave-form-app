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

const GROUP_ORDER = ['designation', 'department', 'name', 'reason'];
const PER_SECTION = 100;

/**
 * DictionaryView — browse the built-in English->Urdu dictionaries and manage
 * the user's own entries. Custom entries override built-ins during import.
 * Props: { lang, customRows, onCustomChange }
 */
export default function DictionaryView({ lang = 'en', customRows = [], onCustomChange = () => {} }) {
  const t = (k, ...a) => tr(lang, k, ...a);
  const [search, setSearch] = useState('');
  const [en, setEn] = useState('');
  const [ur, setUr] = useState('');
  const [newCat, setNewCat] = useState('designation');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Collapsed sections and per-section "show more" counts.
  const [collapsed, setCollapsed] = useState({});
  const [shownCount, setShownCount] = useState({});

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

  // Entries grouped by category: designations, departments, names, reasons —
  // each in its own section so nothing is mixed together.
  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const urduQ = search.trim();
    const groups = {};
    for (const c of GROUP_ORDER) groups[c] = [];
    for (const e of allEntries) {
      if (q) {
        const hitEn = e.english.toLowerCase().includes(q);
        const hitUr = urduQ && String(e.urdu).includes(urduQ);
        if (!hitEn && !hitUr) continue;
      }
      groups[e.category].push(e);
    }
    return groups;
  }, [allEntries, search]);

  const isSearching = search.trim().length > 0;
  const totalShown = GROUP_ORDER.reduce((n, c) => n + grouped[c].length, 0);

  const toggleSection = (c) =>
    setCollapsed((prev) => ({ ...prev, [c]: !prev[c] }));

  const showMoreIn = (c) =>
    setShownCount((prev) => ({ ...prev, [c]: (prev[c] || PER_SECTION) + PER_SECTION }));

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

      {/* Search */}
      <div className="mt-5">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('dict.searchPh')}
          className={inputCls}
        />
      </div>
      <p className="mt-2 text-xs text-zinc-500 dark:text-slate-400">
        {t('dict.count', totalShown)}
      </p>

      {/* Grouped sections: one per category, nothing mixed */}
      <div className="mt-3 space-y-4">
        {totalShown === 0 && (
          <p className="rounded-2xl border border-slate-200 bg-white p-5 text-center text-sm text-zinc-500 dark:border-slate-800 dark:bg-slate-900">
            {t('dict.empty')}
          </p>
        )}
        {GROUP_ORDER.map((c) => {
          const list = grouped[c];
          if (list.length === 0) return null;
          const isCollapsed = !isSearching && !!collapsed[c];
          const limit = shownCount[c] || PER_SECTION;
          const visible = isSearching ? list : list.slice(0, limit);
          const remaining = list.length - visible.length;
          return (
            <section key={c}>
              <button
                type="button"
                onClick={() => toggleSection(c)}
                className="flex min-h-[44px] w-full items-center gap-2 rounded-2xl bg-slate-100 px-4 py-2 text-left dark:bg-slate-800"
              >
                <span className="flex-1 text-sm font-extrabold text-slate-700 dark:text-slate-200">
                  {catLabel(c)}
                </span>
                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                  {t('dict.count', list.length)}
                </span>
                <span className="text-slate-400" aria-hidden="true">
                  {isCollapsed ? '▸' : '▾'}
                </span>
              </button>
              {!isCollapsed && (
                <div className="mt-2 space-y-2">
                  {visible.map((e, i) => (
                    <div
                      key={(e.builtin ? 'b' : 'c') + e.category + e.english + i}
                      className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div
                        className="min-w-0 flex-1 truncate text-sm font-bold"
                        dir="ltr"
                        style={{ textAlign: 'left' }}
                      >
                        {e.english}
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
                  {remaining > 0 && (
                    <button
                      type="button"
                      onClick={() => showMoreIn(c)}
                      className="min-h-[44px] w-full rounded-2xl border border-dashed border-slate-300 text-sm font-bold text-slate-500 hover:border-emerald-500 hover:text-emerald-600 dark:border-slate-700 dark:text-slate-400"
                    >
                      {t('dict.showMore', remaining)}
                    </button>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
