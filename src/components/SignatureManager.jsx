// src/components/SignatureManager.jsx
// Manage leave-form signature images.
// Props: { signatures, onChange }
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

const POSITIONS = [
  { value: 'employee', label: 'دستخط ملازم' },
  { value: 'dept_head', label: 'ڈیپارٹمنٹ ہیڈ' },
  { value: 'hr', label: 'ایچ آر مینیجر' },
  { value: 'custom', label: 'Custom' },
];

const CONDITION_FIELDS = [
  { value: 'department', label: 'Department' },
  { value: 'designation', label: 'Designation' },
  { value: 'reason', label: 'Reason' },
];

const CONDITION_OPS = [
  { value: 'contains', label: 'contains' },
  { value: 'equals', label: 'equals' },
];

const emptyDraft = () => ({
  file: null,
  preview: '',
  label: '',
  position: 'dept_head',
  field: 'department',
  op: 'contains',
  value: '',
});

export default function SignatureManager({ signatures = [], onChange = () => {} }) {
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  // Mount: load from DB when configured, else session-memory mode.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (isConfigured()) {
        const rows = await fetchSignatures();
        if (!alive) return;
        if (Array.isArray(rows)) {
          onChange(rows);
          setNotice('');
        } else {
          setNotice('Supabase se load nahi ho saka. Is session ke liye local mode me chal raha hai.');
        }
      } else {
        setNotice('Signatures saved for this session only. Connect Supabase for permanent save.');
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      setError(e && e.message ? e.message : 'Save nahi ho saka. Dobara try karein.');
    } finally {
      setSaving(false);
    }
  };

  const persistSig = async (sig) => {
    if (!isConfigured()) return;
    setBusyId(sig.id);
    try {
      const saved = await upsertSignature(sig);
      if (saved) {
        onChange(signatures.map((s) => (s.id === sig.id ? saved : s)));
      } else {
        setError('Signature save nahi ho saki. Dobara try karein.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const removeSig = async (sig) => {
    if (!window.confirm('Is signature ko delete karein?')) return;
    setBusyId(sig.id);
    try {
      if (isConfigured() && !String(sig.id).startsWith('local-')) {
        const ok = await deleteSignature(sig.id);
        if (!ok) {
          setError('Delete nahi ho saka. Dobara try karein.');
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
      <h3 style={s.h3}>Signatures</h3>
      {notice && <div style={s.notice}>{notice}</div>}
      {error && <div style={s.error}>{error}</div>}

      {/* New signature */}
      <div style={s.card}>
        <div style={s.row}>
          <label style={s.uploadBox}>
            {draft.preview ? (
              <img src={draft.preview} alt="Signature preview" style={s.thumb} />
            ) : (
              <span style={s.uploadHint}>PNG / JPG upload karein</span>
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
              placeholder="Label, masalan Dept Head Sign"
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
            placeholder="e.g. STITCHING"
            value={draft.value}
            onChange={(e) => setDraft({ ...draft, value: e.target.value })}
          />
        </div>
        <button style={s.primaryBtn} onClick={saveNew} disabled={!draft.file || saving}>
          {saving ? 'Saving...' : 'Signature save karein'}
        </button>
      </div>

      {/* Existing signatures */}
      {loading ? (
        <p style={s.muted}>Loading...</p>
      ) : signatures.length === 0 ? (
        <p style={s.muted}>Abhi koi signature nahi hai. Upar se naya add karein.</p>
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
                placeholder="e.g. STITCHING"
                value={sig.conditionValue || ''}
                onChange={(e) => updateSig(sig.id, { conditionValue: e.target.value })}
              />
            </div>
            <div style={s.btnRow}>
              <button
                style={s.smallBtn}
                onClick={() => persistSig(sig)}
                disabled={busyId === sig.id || !isConfigured()}
                title={isConfigured() ? 'Database me save karein' : 'Session memory me already saved hai'}
              >
                {busyId === sig.id ? 'Saving...' : isConfigured() ? 'Save' : 'Saved'}
              </button>
              <button
                style={{ ...s.smallBtn, ...s.dangerBtn }}
                onClick={() => removeSig(sig)}
                disabled={busyId === sig.id}
              >
                Delete
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
    borderRadius: 8,
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
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    background: 'var(--clf-surface)',
  },
  row: { display: 'flex', gap: 10, alignItems: 'flex-start' },
  uploadBox: {
    width: 96,
    height: 64,
    border: '2px dashed var(--clf-input-border)',
    borderRadius: 8,
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
};
