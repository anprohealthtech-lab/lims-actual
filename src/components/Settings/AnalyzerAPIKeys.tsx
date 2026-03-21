import React, { useState, useEffect } from 'react';
import { supabase } from '../../utils/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { Plus, Trash2, Copy, CheckCircle, XCircle, Activity, AlertTriangle, Eye, EyeOff } from 'lucide-react';

interface ApiKey {
  id: string;
  label: string;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
}

// Generates a cryptographically random key and its SHA-256 hash
async function generateApiKey(): Promise<{ plaintext: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const plaintext = 'lims_' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plaintext));
  const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  return { plaintext, hash };
}

export default function AnalyzerAPIKeys() {
  const { user } = useAuth();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLabel, setNewLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [newKeyPlaintext, setNewKeyPlaintext] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ingestEndpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyzer-ingest`;

  useEffect(() => {
    fetchKeys();
  }, []);

  async function fetchKeys() {
    setLoading(true);
    const { data, error } = await supabase
      .from('lab_api_keys')
      .select('id, label, is_active, created_at, last_used_at')
      .order('created_at', { ascending: false });

    if (!error && data) setKeys(data);
    setLoading(false);
  }

  async function handleCreate() {
    if (!newLabel.trim()) return;
    setCreating(true);
    setError(null);

    try {
      const { plaintext, hash } = await generateApiKey();

      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('lab_id')
        .eq('id', user?.id)
        .single();

      if (userError || !userData?.lab_id) throw new Error('Could not determine lab. Please re-login.');

      const { error: insertError } = await supabase.from('lab_api_keys').insert({
        lab_id: userData.lab_id,
        label: newLabel.trim(),
        key_hash: hash,
        created_by: user?.id,
      });

      if (insertError) throw insertError;

      setNewKeyPlaintext(plaintext);
      setShowKey(false);
      setNewLabel('');
      await fetchKeys();
    } catch (err: any) {
      setError(err.message || 'Failed to create key');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!window.confirm('Revoke this API key? The bridge using it will stop working immediately.')) return;
    await supabase.from('lab_api_keys').update({ is_active: false }).eq('id', id);
    await fetchKeys();
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Permanently delete this key? This cannot be undone.')) return;
    await supabase.from('lab_api_keys').delete().eq('id', id);
    await fetchKeys();
  }

  async function copyToClipboard(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function formatDate(iso: string | null) {
    if (!iso) return 'Never';
    return new Date(iso).toLocaleString();
  }

  return (
    <div className="space-y-6">
      {/* Info Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-blue-800 mb-1">LIS Bridge Authentication</h3>
        <p className="text-xs text-blue-700 mb-3">
          Configure your bridge app with an API key below — no service role key needed.
          Each key is lab-scoped and can be revoked independently.
        </p>
        <div className="flex items-center gap-2 bg-white border border-blue-200 rounded px-3 py-2">
          <span className="text-xs text-gray-500 font-medium shrink-0">Endpoint:</span>
          <code className="text-xs text-gray-800 flex-1 truncate">{ingestEndpoint}</code>
          <button
            onClick={() => copyToClipboard(ingestEndpoint)}
            className="text-blue-500 hover:text-blue-700 shrink-0"
            title="Copy endpoint"
          >
            {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
          </button>
        </div>
        <p className="text-xs text-blue-600 mt-2">
          Bridge config: <code className="bg-blue-100 px-1 rounded">x-lab-api-key: &lt;your-key&gt;</code> header
        </p>
      </div>

      {/* New key plaintext — shown once after creation */}
      {newKeyPlaintext && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
          <div className="flex items-start gap-2 mb-2">
            <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
            <p className="text-sm font-semibold text-amber-800">
              Copy this key now — it won't be shown again
            </p>
          </div>
          <div className="flex items-center gap-2 bg-white border border-amber-200 rounded px-3 py-2">
            <code className="text-xs text-gray-800 flex-1 truncate font-mono">
              {showKey ? newKeyPlaintext : '•'.repeat(40)}
            </code>
            <button onClick={() => setShowKey(v => !v)} className="text-gray-400 hover:text-gray-600 shrink-0">
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button
              onClick={() => copyToClipboard(newKeyPlaintext)}
              className="text-amber-600 hover:text-amber-800 shrink-0"
              title="Copy key"
            >
              {copied ? <CheckCircle size={14} className="text-green-500" /> : <Copy size={14} />}
            </button>
          </div>
          <button
            onClick={() => setNewKeyPlaintext(null)}
            className="mt-2 text-xs text-amber-600 hover:underline"
          >
            I've saved it, dismiss
          </button>
        </div>
      )}

      {/* Create new key */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Generate New API Key</h3>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Label (e.g. Sysmex XN-1000 Room 3)"
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            className="flex-1 text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleCreate}
            disabled={creating || !newLabel.trim()}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus size={14} />
            {creating ? 'Generating...' : 'Generate'}
          </button>
        </div>
        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
      </div>

      {/* Keys list */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">API Keys</h3>
        </div>

        {loading ? (
          <div className="p-6 text-center text-sm text-gray-400">Loading...</div>
        ) : keys.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-400">
            No API keys yet. Generate one above to connect your bridge app.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Label</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Status</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Created</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Last Used</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {keys.map(key => (
                <tr key={key.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-800">{key.label}</td>
                  <td className="px-4 py-3">
                    {key.is_active ? (
                      <span className="inline-flex items-center gap-1 text-green-700 bg-green-50 px-2 py-0.5 rounded-full text-xs font-medium">
                        <Activity size={10} /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full text-xs font-medium">
                        <XCircle size={10} /> Revoked
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(key.created_at)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(key.last_used_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      {key.is_active && (
                        <button
                          onClick={() => handleRevoke(key.id)}
                          className="text-xs text-amber-600 hover:text-amber-800 flex items-center gap-1"
                          title="Revoke"
                        >
                          <XCircle size={13} /> Revoke
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(key.id)}
                        className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
                        title="Delete"
                      >
                        <Trash2 size={13} /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
