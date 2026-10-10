// src/components/SignatureManager.jsx
// Manage leave-form signature images — simplified.
//
// Each signature: an image + a name + which line it prints on
// (Employee / Department Head / HR) + EITHER "on every form"
// OR "only when the department/designation matches a value".
// Edits save automatically (debounced); there is no per-card Save button.

import { useEffect, useRef, useState } from 'react';
import {
  isConfigured,
  fetchSignatures,
  upsertSignature,
  deleteSignature,
  uploadSignatureImage,
} from '../lib/supabase.js';
import { tr } from '../lib/strings.js';

const emptyDraft = () => ({
  file: null,
  preview: '',
  label: '',
  position: 'dept_head',
  applyAll: true,
  field: 'department',
  exact: false,
  value: '',
});

// Draft/card UI state -> DB row shape.
const toRowPatch = (d) => ({
  conditionField: d.applyAll ? 'department' : d.field,
  conditionOp: d.exact && !d.applyAll ? 'equals' : 'contains',
  conditionValue: d.applyAll ? '' : String(d.value || '').trim(),
});

// DB row -> card UI state.
const fromRow = (sig) => ({
  applyAll: !String(sig.conditionValue || sig.value || '').trim(),
  field: sig.conditionField || sig.field || 'department',
  exact: (sig.conditionOp || sig.op) === 'equals',
  value: sig.conditionValue || sig.value || '',
});

export default function SignatureManager({
  lang = 'en',
  signatures = [],
  onChange = () => {},
  defaultHrSignUrl = null,
  userId = null,
  hrDefaultOff = false,
  onRemoveDefaultHr = () => {},
  onRestoreDefaultHr = () => {},
}) {
  const t = (k, ...a) => tr(lang, k, ...a);

  const POSITIONS = [
    { value: 'employee', label: t('signs.posEmployee') },
    { value: 'dept_head', label: t('signs.posDeptHead') },
    { value: 'hr', label: t('signs.posHr') },
  ];

  const CONDITION_FIELDS = [
    { value: 'department', label: t('signs.fldDepartment') },
    { value: 'designation', label: t('signs.fldDesignation') },
    { value: 'reason', label: t('signs.fldReason') },
  ];

  // Plain-language summary: which line, and on which forms.
  const describeSig = (sig) => {
    const pos =
      (POSITIONS.find((p) => p.value === (sig.position || 'dept_head')) || {}).label ||
      t('signs.posDeptHead');
    const ui = fromRow(sig);
    if (ui.applyAll) return t('signs.ruleAll', pos);
    const field =
      (CONDITION_FIELDS.find((f) => f.value === ui.field) || {}).label ||
      t('signs.fldDepartment');
    const opText = ui.exact ? t('signs.opEqualsText') : t('signs.opContainsText');
    return t('signs.ruleWhen', pos, field, ui.value.trim(), opText);
  };

  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  // Per-card autosave state: 'saving' | 'saved' | 'error'
  const [saveState, setSaveState] = useState({});
  const timers = useRef({});
  const sigsRef = useRef(signatures);
  // Remembers the typed rule value while "On every form" is switched on,
  // so switching it back off restores what the user had typed.
  const lastValue = useRef({});
  useEffect(() => {
    sigsRef.current = signatures;
  }, [signatures]);
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  // Load from DB when logged in, else session-memory mode. Reloads on login/logout.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      if (isConfigured() && userId) {
        const rows = await fetchSignatures();
        if (!alive) return;
        if (Array.isArray(rows)) {
          onChange(rows);
          setNotice('');
        } else {
          setNotice(t('signs.loadFail'));
        }
      } else if (isConfigured() && !userId) {
        onChange([]);
        setNotice(t('signs.loginPrompt'));
      } else {
        setNotice(t('signs.sessionOnly'));
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const doPersist = async (id) => {
    const sig = (sigsRef.current || []).find((x) => x.id === id);
    if (!sig) return;
    if (!isConfigured()) {
      setSaveState((p) => ({ ...p, [id]: 'saved' }));
      return;
    }
    try {
      const saved = await upsertSignature(sig);
      if (saved) {
        const next = (sigsRef.current || []).map((x) => (x.id === id ? saved : x));
        onChange(next);
        // The DB row may carry a new id after the first insert.
        setSaveState((p) => ({ ...p, [id]: 'saved', [saved.id]: 'saved' }));
      } else {
        setSaveState((p) => ({ ...p, [id]: 'error' }));
      }
    } catch (e) {
      setSaveState((p) => ({ ...p, [id]: 'error' }));
    }
  };

  // Every edit updates the UI instantly and saves itself shortly after.
  const updateSig = (id, patch) => {
    const next = (sigsRef.current || []).map((x) =>
      x.id === id ? { ...x, ...patch } : x
    );
    onChange(next);
    if (timers.current[id]) clearTimeout(timers.current[id]);
    setSaveState((p) => ({ ...p, [id]: 'saving' }));
    timers.current[id] = setTimeout(() => doPersist(id), 900);
  };

  // Apply the simplified card controls onto the DB-shaped row.
  const applyCardChange = (sig, uiPatch) => {
    const ui = { ...fromRow(sig), ...uiPatch };
    if (uiPatch.applyAll === true) {
      lastValue.current[sig.id] = ui.value;
      ui.value = '';
    } else if (uiPatch.applyAll === false && !String(ui.value || '').trim()) {
      ui.value = lastValue.current[sig.id] || '';
    }
    updateSig(sig.id, { ...toRowPatch(ui) });
    return ui;
  };

  const pickFile = (file) => {
    if (!file) return;
    if (draft.preview && draft.preview.startsWith('blob:')) URL.revokeObjectURL(draft.preview);
    setDraft({ ...draft, file, preview: URL.createObjectURL(file) });
  };

  const saveNew = async () => {
    if (!draft.file || saving) return;
    setSaving(true);
    setError('');
    try {
      const base = {
        label: draft.label.trim() || 'Signature',
        position: draft.position,
        ...toRowPatch(draft),
      };
      let sig;
      if (isConfigured()) {
        const imageUrl = await uploadSignatureImage(draft.file);
        const saved = await upsertSignature({ ...base, imageUrl });
        sig = saved || { ...base, id: 'local-' + Date.now(), imageUrl };
      } else {
        sig = { ...base, id: 'local-' + Date.now(), imageUrl: draft.preview };
      }
      onChange([...(sigsRef.current || []), sig]);
      if (draft.preview && draft.preview.startsWith('blob:')) URL.revokeObjectURL(draft.preview);
      setDraft(emptyDraft());
    } catch (e) {
      setError(e && e.message ? e.message : t('signs.saveFail'));
    } finally {
      setSaving(false);
    }
  };

  // Replace the bundled default HR signature with the user's own upload.
  const saveHrReplacement = async (file) => {
    if (!file || saving) return;
    setSaving(true);
    setError('');
    try {
      const base = {
        label: 'HR Manager',
        position: 'hr',
        conditionField: 'department',
        conditionOp: 'contains',
        conditionValue: '',
      };
      let sig;
      if (isConfigured()) {
        const imageUrl = await uploadSignatureImage(file);
        const saved = await upsertSignature({ ...base, imageUrl });
        sig = saved || { ...base, id: 'local-' + Date.now(), imageUrl };
      } else {
        sig = { ...base, id: 'local-' + Date.now(), imageUrl: URL.createObjectURL(file) };
      }
      onChange([...(sigsRef.current || []), sig]);
    } catch (e) {
      setError(t('signs.replaceFail'));
    } finally {
      setSaving(false);
    }
  };

  const customHr = (signatures || []).find((s) => s.position === 'hr');

  const removeSig = async (sig) => {
    if (!window.confirm(t('signs.confirmDelete'))) return;
    setBusyId(sig.id);
    try {
      if (isConfigured() && !String(sig.id).startsWith('local-')) {
        const ok = await deleteSignature(sig.id);
        if (!ok) {
          setError(t('signs.deleteFail'));
          return;
        }
      }
      onChange((sigsRef.current || []).filter((x) => x.id !== sig.id));
    } finally {
      setBusyId(null);
    }
  };

  const saveBadge = (id) => {
    const st = saveState[id];
    if (st === 'saving') return <span style={s.badgeMuted}>{t('signs.saving')}</span>;
    if (st === 'error')
      return <span style={s.badgeError}>{t('signs.saveFail')}</span>;
    return <span style={s.badgeOk}>{t('signs.savedOk')}</span>;
  };

  // One signature card, used for the new-sign draft and every saved sign.
  const cardControls = (ui, setUi, isDraft) => (
    <div>
      <p style={s.fieldLabel}>{t('signs.whereLine')}</p>
      <select
        style={s.input}
        value={ui.position}
        onChange={(e) => setUi({ position: e.target.value })}
      >
        {POSITIONS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={() => setUi({ applyAll: !ui.applyAll })}
        style={{ ...s.toggle, ...(ui.applyAll ? s.toggleOn : s.toggleOff) }}
        aria-pressed={ui.applyAll}
      >
        <span style={s.toggleDot} />
        {t('signs.everyForm')}
      </button>

      {!ui.applyAll && (
        <div style={s.condBox}>
          <p style={s.fieldLabel}>{t('signs.onlyWhen')}</p>
          <div style={s.condRow}>
            <select
              style={{ ...s.input, flex: 1 }}
              value={ui.field}
              onChange={(e) => setUi({ field: e.target.value })}
            >
              {CONDITION_FIELDS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <input
              style={{ ...s.input, flex: 1.6 }}
              placeholder={t('signs.valuePh')}
              value={ui.value}
              onChange={(e) => setUi({ value: e.target.value })}
            />
          </div>
          <label style={s.checkRow}>
            <input
              type="checkbox"
              checked={!!ui.exact}
              onChange={(e) => setUi({ exact: e.target.checked })}
              style={s.checkbox}
            />
            <span style={s.checkLabel}>{t('signs.exactMatch')}</span>
          </label>
        </div>
      )}
      {!isDraft && <div style={s.ruleLine}>{describeSig({ ...ui, ...toRowPatch(ui) })}</div>}
    </div>
  );

  const draftUi = { ...draft };

  return (
    <div style={s.wrap}>
      <h3 style={s.h3}>{t('signs.title')}</h3>

      {/* 4-line guide */}
      <div style={s.guide}>
        {(t('signs.guide') || []).map((line, i) => (
          <p key={i} style={s.guideLine}>
            {line}
          </p>
        ))}
      </div>

      {notice && <div style={s.notice}>{notice}</div>}
      {error && <div style={s.error}>{error}</div>}

      {/* Default HR signature (bundled, common to every form, replaceable/removable) */}
      {!customHr && defaultHrSignUrl && !hrDefaultOff && (
        <div style={s.card}>
          <div style={s.row}>
            <img src={defaultHrSignUrl} alt="Default HR signature" style={s.thumb} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: 'var(--clf-text)' }}>
                {t('signs.posHr')}
                <span style={s.badge}>{t('signs.defaultBadge')}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--clf-text-dim)', marginTop: 4 }}>
                {t('signs.defaultHrNote')}
              </div>
            </div>
          </div>
          <div style={s.ruleLine}>{t('signs.ruleAll', t('signs.posHr'))}</div>
          <div style={s.btnRow}>
            <label style={{ ...s.smallBtn, textAlign: 'center' }}>
              {saving ? t('signs.saving') : t('signs.replace')}
              <input
                type="file"
                accept="image/png,image/jpeg"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files && e.target.files[0];
                  if (f) saveHrReplacement(f);
                  e.target.value = '';
                }}
              />
            </label>
            <button
              type="button"
              style={{ ...s.smallBtn, ...s.dangerBtn }}
              onClick={() => {
                if (window.confirm(t('signs.confirmDelete'))) onRemoveDefaultHr();
              }}
            >
              {t('signs.removeDefault')}
            </button>
          </div>
        </div>
      )}

      {/* Default HR signature was removed by the user: offer to restore it */}
      {!customHr && hrDefaultOff && (
        <div style={s.card}>
          <div style={{ fontSize: 13, color: 'var(--clf-text-dim)' }}>
            {t('signs.defaultRemovedNote')}
          </div>
          <div style={s.btnRow}>
            <button
              type="button"
              style={{ ...s.smallBtn, textAlign: 'center' }}
              onClick={() => onRestoreDefaultHr()}
            >
              {t('signs.restoreDefault')}
            </button>
          </div>
        </div>
      )}

      {/* New signature */}
      <div style={s.card}>
        <div style={s.row}>
          <label style={s.uploadBox}>
            {draft.preview ? (
              <img src={draft.preview} alt="Signature preview" style={s.thumb} />
            ) : (
              <span style={s.uploadHint}>{t('signs.uploadHint')}</span>
            )}
            <input
              type="file"
              accept="image/png,image/jpeg"
              style={{ display: 'none' }}
              onChange={(e) => pickFile(e.target.files && e.target.files[0])}
            />
          </label>
          <div style={{ flex: 1, minWidth: 0 }}>
            <input
              style={s.input}
              placeholder={t('signs.labelPh')}
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            />
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          {cardControls(draftUi, (patch) => setDraft({ ...draft, ...patch }), true)}
        </div>
        <div style={s.ruleLine}>{describeSig({ position: draft.position, ...toRowPatch(draft) })}</div>
        <button style={s.primaryBtn} onClick={saveNew} disabled={!draft.file || saving}>
          {saving ? t('signs.saving') : t('signs.save')}
        </button>
      </div>

      {/* Existing signatures */}
      {loading ? (
        <p style={s.muted}>{t('signs.loading')}</p>
      ) : signatures.length === 0 ? (
        <p style={s.muted}>{t('signs.empty')}</p>
      ) : (
        signatures.map((sig) => {
          const rawPos = sig.position === 'custom' ? 'dept_head' : sig.position;
          const ui = { ...fromRow(sig), position: rawPos || 'dept_head', label: sig.label };
          return (
            <div key={sig.id} style={s.card}>
              <div style={s.row}>
                {sig.imageUrl ? (
                  <img src={sig.imageUrl} alt={sig.label} style={s.thumb} />
                ) : (
                  <div style={{ ...s.thumb, ...s.thumbEmpty }}>?</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <input
                    style={s.input}
                    value={sig.label || ''}
                    onChange={(e) => updateSig(sig.id, { label: e.target.value })}
                    aria-label={t('signs.labelPh')}
                  />
                  <div style={{ marginTop: 6 }}>{saveBadge(sig.id)}</div>
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                {cardControls(ui, (patch) => {
                  if (patch.position !== undefined) {
                    updateSig(sig.id, { position: patch.position });
                    return;
                  }
                  applyCardChange(sig, patch);
                }, false)}
              </div>
              <div style={s.btnRow}>
                <button
                  style={{ ...s.smallBtn, ...s.dangerBtn }}
                  onClick={() => removeSig(sig)}
                  disabled={busyId === sig.id}
                >
                  {t('signs.delete')}
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

const s = {
  wrap: { maxWidth: 560, margin: '0 auto', padding: '12px 12px 24px' },
  h3: { fontSize: 18, margin: '4px 0 12px' },
  guide: {
    background: 'var(--clf-chip-bg)',
    border: '1px solid var(--clf-chip-border)',
    borderRadius: 14,
    padding: '12px 14px',
    marginBottom: 14,
  },
  guideLine: { fontSize: 13, lineHeight: 1.7, margin: '2px 0', color: 'var(--clf-text)' },
  notice: {
    background: 'var(--clf-notice-bg)',
    border: '1px solid var(--clf-notice-border)',
    color: 'var(--clf-notice-text)',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 13,
    marginBottom: 12,
  },
  error: {
    background: 'var(--clf-error-bg)',
    border: '1px solid var(--clf-error-border)',
    color: 'var(--clf-error-text)',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 13,
    marginBottom: 12,
  },
  card: {
    border: '1px solid var(--clf-border)',
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    background: 'var(--clf-surface)',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  },
  row: { display: 'flex', gap: 10, alignItems: 'flex-start' },
  uploadBox: {
    width: 96,
    height: 64,
    border: '2px dashed var(--clf-input-border)',
    borderRadius: 14,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    overflow: 'hidden',
    flexShrink: 0,
    background: 'var(--clf-surface-soft)',
  },
  uploadHint: { fontSize: 11, color: 'var(--clf-text-dim)', textAlign: 'center', padding: 4 },
  thumb: { width: 96, height: 64, objectFit: 'contain', background: '#fff', flexShrink: 0 },
  thumbEmpty: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--clf-text-faint)',
    fontSize: 20,
  },
  fieldLabel: { fontSize: 13, fontWeight: 700, color: 'var(--clf-text)', margin: '10px 0 6px' },
  condBox: {
    marginTop: 10,
    border: '1px dashed var(--clf-input-border)',
    borderRadius: 12,
    padding: 10,
  },
  condRow: { display: 'flex', gap: 8 },
  input: {
    width: '100%',
    fontSize: 16,
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid var(--clf-input-border)',
    boxSizing: 'border-box',
    background: 'var(--clf-surface)',
    color: 'var(--clf-text)',
  },
  toggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    marginTop: 12,
    padding: '12px 14px',
    fontSize: 15,
    fontWeight: 700,
    borderRadius: 12,
    border: '1px solid var(--clf-input-border)',
    cursor: 'pointer',
    minHeight: 48,
    background: 'var(--clf-surface-soft)',
    color: 'var(--clf-text)',
  },
  toggleOn: { borderColor: '#25d366', background: 'rgba(37,211,102,0.12)' },
  toggleOff: {},
  toggleDot: {
    width: 14,
    height: 14,
    borderRadius: '50%',
    background: '#25d366',
    flexShrink: 0,
  },
  checkRow: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, cursor: 'pointer' },
  checkbox: { width: 20, height: 20, accentColor: '#25d366' },
  checkLabel: { fontSize: 14, color: 'var(--clf-text)' },
  primaryBtn: {
    width: '100%',
    marginTop: 12,
    padding: '12px 16px',
    fontSize: 16,
    borderRadius: 8,
    border: 'none',
    background: '#25d366',
    color: '#fff',
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: 44,
  },
  btnRow: { display: 'flex', gap: 8, marginTop: 10 },
  smallBtn: {
    flex: 1,
    padding: '10px 12px',
    fontSize: 15,
    borderRadius: 8,
    border: '1px solid var(--clf-input-border)',
    background: 'var(--clf-surface-soft)',
    color: 'var(--clf-text)',
    cursor: 'pointer',
    minHeight: 44,
  },
  dangerBtn: { background: 'var(--clf-surface)', borderColor: 'var(--clf-error-border)', color: '#c0392b' },
  muted: { fontSize: 14, color: 'var(--clf-text-dim)', textAlign: 'center', marginTop: 16 },
  ruleLine: {
    marginTop: 10,
    padding: '8px 10px',
    borderRadius: 8,
    background: 'var(--clf-chip-bg)',
    border: '1px solid var(--clf-chip-border)',
    color: 'var(--clf-chip-text)',
    fontSize: 13,
    lineHeight: 1.5,
  },
  badge: {
    display: 'inline-block',
    fontSize: 11,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: 999,
    background: 'var(--clf-chip-bg)',
    border: '1px solid var(--clf-chip-border)',
    color: 'var(--clf-chip-text)',
    marginLeft: 6,
  },
  badgeOk: {
    display: 'inline-block',
    fontSize: 12,
    fontWeight: 700,
    color: '#1a9e54',
  },
  badgeMuted: {
    display: 'inline-block',
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--clf-text-dim)',
  },
  badgeError: {
    display: 'inline-block',
    fontSize: 12,
    fontWeight: 700,
    color: '#c0392b',
  },
};
