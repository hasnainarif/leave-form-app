// src/components/SignatureManager.jsx
// Manage leave-form signature images.
// Props: { lang, signatures, onChange }
//   signatures: array of { id, label, imageUrl, position, conditionField, conditionOp, conditionValue }
//   onChange: (signatures) => void
// On mount, if Supabase is configured, loads signatures from the DB and calls onChange.
// Otherwise runs in session-memory mode with a gentle notice.

import { useEffect, useState } from 'react';
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
  field: 'department',
  op: 'contains',
  value: '',
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
    { value: 'custom', label: t('signs.posCustom') },
  ];

  const CONDITION_FIELDS = [
    { value: 'department', label: t('signs.fldDepartment') },
    { value: 'designation', label: t('signs.fldDesignation') },
    { value: 'reason', label: t('signs.fldReason') },
  ];

  const CONDITION_OPS = [
    { value: 'contains', label: t('signs.opContains') },
    { value: 'equals', label: t('signs.opEquals') },
  ];

  // Plain-language summary so the user can SEE which sign goes where and when:
  // position decides the line on the form, the rule decides which forms.
  // Empty rule = every form.
  const describeSig = (sig) => {
    const pos =
      (POSITIONS.find((p) => p.value === (sig.position || 'dept_head')) || {}).label ||
      t('signs.posDeptHead');
    const needle = String(sig.conditionValue || sig.value || '').trim();
    if (!needle) return t('signs.ruleAll', pos);
    const field =
      (CONDITION_FIELDS.find((f) => f.value === (sig.conditionField || sig.field)) || {})
        .label || t('signs.fldDepartment');
    const opText =
      (sig.conditionOp || sig.op) === 'equals' ? t('signs.opEqualsText') : t('signs.opContainsText');
    return t('signs.ruleWhen', pos, field, needle, opText);
  };

  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

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

  const updateSig = (id, patch) => {
    onChange(signatures.map((s) => (s.id === id ? { ...s, ...patch } : s)));
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
        conditionField: draft.field,
        conditionOp: draft.op,
        conditionValue: draft.value.trim(),
      };
      let sig;
      if (isConfigured()) {
        const imageUrl = await uploadSignatureImage(draft.file);
        const saved = await upsertSignature({ ...base, imageUrl });
        sig = saved || { ...base, id: 'local-' + Date.now(), imageUrl };
      } else {
        sig = { ...base, id: 'local-' + Date.now(), imageUrl: draft.preview };
      }
      onChange([...signatures, sig]);
      if (draft.preview && draft.preview.startsWith('blob:')) URL.revokeObjectURL(draft.preview);
      setDraft(emptyDraft());
    } catch (e) {
      setError(e && e.message ? e.message : t('signs.saveFail'));
    } finally {
      setSaving(false);
    }
  };

  // Replace the bundled default HR signature with the user's own upload.
  // The new signature gets position 'hr' and an empty rule (every form).
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
      onChange([...signatures, sig]);
    } catch (e) {
      setError(t('signs.replaceFail'));
    } finally {
      setSaving(false);
    }
  };

  const customHr = (signatures || []).find((s) => s.position === 'hr');

  const persistSig = async (sig) => {
    if (!isConfigured()) return;
    setBusyId(sig.id);
    try {
      const saved = await upsertSignature(sig);
      if (saved) {
        onChange(signatures.map((s) => (s.id === sig.id ? saved : s)));
      } else {
        setError(t('signs.saveFail'));
      }
    } finally {
      setBusyId(null);
    }
  };

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
      onChange(signatures.filter((s) => s.id !== sig.id));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={s.wrap}>
      <h3 style={s.h3}>{t('signs.title')}</h3>
      <p style={s.explainer}>{t('signs.explainer')}</p>
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
          <div style={s.ruleLine}>{describeSig({ position: 'hr' })}</div>
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
            <select
              style={{ ...s.input, marginTop: 8 }}
              value={draft.position}
              onChange={(e) => setDraft({ ...draft, position: e.target.value })}
            >
              {POSITIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={s.condRow}>
          <select
            style={{ ...s.input, flex: 1 }}
            value={draft.field}
            onChange={(e) => setDraft({ ...draft, field: e.target.value })}
          >
            {CONDITION_FIELDS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <select
            style={{ ...s.input, flex: 1 }}
            value={draft.op}
            onChange={(e) => setDraft({ ...draft, op: e.target.value })}
          >
            {CONDITION_OPS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <input
            style={{ ...s.input, flex: 1.4 }}
            placeholder={t('signs.valuePh')}
            value={draft.value}
            onChange={(e) => setDraft({ ...draft, value: e.target.value })}
          />
        </div>
        <div style={s.ruleLine}>{describeSig(draft)}</div>
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
        signatures.map((sig) => (
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
                />
                <select
                  style={{ ...s.input, marginTop: 8 }}
                  value={sig.position || 'dept_head'}
                  onChange={(e) => updateSig(sig.id, { position: e.target.value })}
                >
                  {POSITIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div style={s.condRow}>
              <select
                style={{ ...s.input, flex: 1 }}
                value={sig.conditionField || 'department'}
                onChange={(e) => updateSig(sig.id, { conditionField: e.target.value })}
              >
                {CONDITION_FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              <select
                style={{ ...s.input, flex: 1 }}
                value={sig.conditionOp || 'contains'}
                onChange={(e) => updateSig(sig.id, { conditionOp: e.target.value })}
              >
                {CONDITION_OPS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <input
                style={{ ...s.input, flex: 1.4 }}
                placeholder={t('signs.valuePh')}
                value={sig.conditionValue || ''}
                onChange={(e) => updateSig(sig.id, { conditionValue: e.target.value })}
              />
            </div>
            <div style={s.ruleLine}>{describeSig(sig)}</div>
            <div style={s.btnRow}>
              <button
                style={s.smallBtn}
                onClick={() => persistSig(sig)}
                disabled={busyId === sig.id || !isConfigured()}
                title={isConfigured() ? t('signs.saveTitle') : t('signs.sessionSavedTitle')}
              >
                {busyId === sig.id ? t('signs.saving') : isConfigured() ? t('signs.saveDb') : t('signs.saved')}
              </button>
              <button
                style={{ ...s.smallBtn, ...s.dangerBtn }}
                onClick={() => removeSig(sig)}
                disabled={busyId === sig.id}
              >
                {t('signs.delete')}
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

const s = {
  wrap: { maxWidth: 560, margin: '0 auto', padding: '12px 12px 24px' },
  h3: { fontSize: 18, margin: '4px 0 12px' },
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
  condRow: { display: 'flex', gap: 8, marginTop: 10 },
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
  explainer: { fontSize: 13, color: 'var(--clf-text-dim)', lineHeight: 1.6, margin: '0 0 12px' },
};
