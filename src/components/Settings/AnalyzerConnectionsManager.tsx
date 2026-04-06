import React, { useState, useEffect } from 'react';
import { supabase } from '../../utils/supabase';
import { Plus, Edit2, Trash2, Wifi, Server, HardDrive, ChevronDown, ChevronUp, Copy, CheckCircle } from 'lucide-react';

interface AnalyzerProfile {
  id: string;
  name: string;
  manufacturer: string;
  model: string | null;
  protocol: string;
}

interface AnalyzerConnection {
  id: string;
  lab_id: string;
  name: string;
  profile_id: string | null;
  connection_type: 'tcp' | 'serial' | 'file';
  config: Record<string, any>;
  status: 'active' | 'inactive';
  host_mode: 'client' | 'server';
  created_at: string;
  analyzer_profiles?: AnalyzerProfile | null;
}

const EMPTY_FORM = {
  name: '',
  profile_id: '',
  connection_type: 'tcp' as 'tcp' | 'serial' | 'file',
  host: '',
  port: '5000',
  device_path: '',
  host_mode: 'client' as 'client' | 'server',
  status: 'active' as 'active' | 'inactive',
};

export default function AnalyzerConnectionsManager({ labId }: { labId: string }) {
  const [connections, setConnections] = useState<AnalyzerConnection[]>([]);
  const [profiles, setProfiles] = useState<AnalyzerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    fetchAll();
  }, [labId]);

  async function fetchAll() {
    setLoading(true);
    const [{ data: conns }, { data: profs }] = await Promise.all([
      supabase
        .from('analyzer_connections')
        .select('*, analyzer_profiles(id, name, manufacturer, model, protocol)')
        .eq('lab_id', labId)
        .order('created_at', { ascending: false }),
      supabase
        .from('analyzer_profiles')
        .select('id, name, manufacturer, model, protocol')
        .eq('is_active', true)
        .order('manufacturer'),
    ]);
    if (conns) setConnections(conns as AnalyzerConnection[]);
    if (profs) setProfiles(profs as AnalyzerProfile[]);
    setLoading(false);
  }

  function openCreate() {
    setForm({ ...EMPTY_FORM });
    setEditingId(null);
    setError(null);
    setShowForm(true);
  }

  function openEdit(conn: AnalyzerConnection) {
    setForm({
      name: conn.name,
      profile_id: conn.profile_id ?? '',
      connection_type: conn.connection_type,
      host: conn.config?.host ?? '',
      port: conn.config?.port?.toString() ?? '5000',
      device_path: conn.config?.device ?? '',
      host_mode: conn.host_mode ?? 'client',
      status: conn.status ?? 'active',
    });
    setEditingId(conn.id);
    setError(null);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setError(null);
  }

  function buildConfig() {
    if (form.connection_type === 'tcp') {
      return { host: form.host.trim(), port: parseInt(form.port, 10) || 5000 };
    }
    if (form.connection_type === 'serial') {
      return { device: form.device_path.trim() };
    }
    return {};
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Name is required.'); return; }
    if (form.connection_type === 'tcp' && !form.host.trim()) { setError('Host / IP address is required for TCP.'); return; }
    setSaving(true);
    setError(null);

    const payload = {
      lab_id: labId,
      name: form.name.trim(),
      profile_id: form.profile_id || null,
      connection_type: form.connection_type,
      config: buildConfig(),
      status: form.status,
      host_mode: form.host_mode,
    };

    let err;
    if (editingId) {
      ({ error: err } = await supabase.from('analyzer_connections').update(payload).eq('id', editingId));
    } else {
      ({ error: err } = await supabase.from('analyzer_connections').insert(payload));
    }

    setSaving(false);
    if (err) { setError(err.message); return; }
    closeForm();
    fetchAll();
  }

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete analyzer connection "${name}"? This cannot be undone and will break any test groups linked to it.`)) return;
    await supabase.from('analyzer_connections').delete().eq('id', id);
    fetchAll();
  }

  function copyId(id: string) {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  const connectionTypeIcon = (type: string) => {
    if (type === 'tcp') return <Wifi className="h-4 w-4" />;
    if (type === 'serial') return <HardDrive className="h-4 w-4" />;
    return <Server className="h-4 w-4" />;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-800">Analyzer Connections</h3>
          <p className="text-sm text-gray-500 mt-0.5">Register physical instruments that the Bridge will communicate with.</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Analyzer
        </button>
      </div>

      {/* Create / Edit Form */}
      {showForm && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 space-y-4">
          <h4 className="text-sm font-semibold text-gray-700">{editingId ? 'Edit Connection' : 'New Analyzer Connection'}</h4>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {/* Name */}
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Display Name *</label>
              <input
                type="text"
                placeholder="e.g. Sysmex XN-1000 (Main Lab)"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Profile */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Analyzer Profile</label>
              <select
                value={form.profile_id}
                onChange={e => setForm(f => ({ ...f, profile_id: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Select profile —</option>
                {profiles.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.manufacturer} {p.model ?? ''} ({p.protocol})
                  </option>
                ))}
              </select>
            </div>

            {/* Connection type */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Connection Type</label>
              <select
                value={form.connection_type}
                onChange={e => setForm(f => ({ ...f, connection_type: e.target.value as any }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="tcp">TCP / Network</option>
                <option value="serial">Serial / RS-232</option>
                <option value="file">File / Folder Watch</option>
              </select>
            </div>

            {/* TCP fields */}
            {form.connection_type === 'tcp' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Analyzer IP / Hostname *</label>
                  <input
                    type="text"
                    placeholder="e.g. 192.168.1.100"
                    value={form.host}
                    onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Port</label>
                  <input
                    type="number"
                    placeholder="5000"
                    value={form.port}
                    onChange={e => setForm(f => ({ ...f, port: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </>
            )}

            {/* Serial field */}
            {form.connection_type === 'serial' && (
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Device Path</label>
                <input
                  type="text"
                  placeholder="e.g. COM3 or /dev/ttyUSB0"
                  value={form.device_path}
                  onChange={e => setForm(f => ({ ...f, device_path: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}

            {/* Host mode */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Bridge Role</label>
              <select
                value={form.host_mode}
                onChange={e => setForm(f => ({ ...f, host_mode: e.target.value as any }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="client">Client (Bridge connects to analyzer)</option>
                <option value="server">Server (Analyzer connects to Bridge)</option>
              </select>
            </div>

            {/* Status */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
              <select
                value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value as any }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Connection'}
            </button>
            <button
              onClick={closeForm}
              className="px-4 py-2 border border-gray-300 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Connection list */}
      {loading ? (
        <div className="text-sm text-gray-500 py-4 text-center">Loading connections…</div>
      ) : connections.length === 0 ? (
        <div className="text-center py-10 border-2 border-dashed border-gray-200 rounded-xl">
          <Wifi className="h-8 w-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No analyzer connections yet.</p>
          <p className="text-xs text-gray-400 mt-1">Add one above, then link it to your test groups.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {connections.map(conn => (
            <div
              key={conn.id}
              className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-start justify-between gap-4"
            >
              <div className="flex items-start gap-3 min-w-0">
                <div className={`mt-0.5 p-1.5 rounded-lg ${conn.status === 'active' ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                  {connectionTypeIcon(conn.connection_type)}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-800">{conn.name}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${conn.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {conn.status}
                    </span>
                  </div>
                  {conn.analyzer_profiles && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      {conn.analyzer_profiles.manufacturer} {conn.analyzer_profiles.model} &middot; {conn.analyzer_profiles.protocol}
                    </p>
                  )}
                  <p className="text-xs text-gray-400 mt-0.5">
                    {conn.connection_type.toUpperCase()}
                    {conn.connection_type === 'tcp' && conn.config?.host
                      ? ` · ${conn.config.host}:${conn.config.port ?? 5000}`
                      : ''}
                    {conn.connection_type === 'serial' && conn.config?.device
                      ? ` · ${conn.config.device}`
                      : ''}
                    {' · '}{conn.host_mode}
                  </p>
                  {/* Connection ID — needed for linking test groups */}
                  <div className="flex items-center gap-1 mt-1">
                    <span className="text-xs font-mono text-gray-400 truncate max-w-xs">{conn.id}</span>
                    <button
                      onClick={() => copyId(conn.id)}
                      className="text-gray-400 hover:text-blue-600 transition-colors flex-shrink-0"
                      title="Copy connection ID"
                    >
                      {copiedId === conn.id
                        ? <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                        : <Copy className="h-3.5 w-3.5" />}
                    </button>
                    <span className="text-xs text-gray-400">{copiedId === conn.id ? 'Copied!' : 'Copy ID'}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => openEdit(conn)}
                  className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  title="Edit"
                >
                  <Edit2 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleDelete(conn.id, conn.name)}
                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-400 pt-1">
        After creating a connection, copy its ID and assign it to test groups under <strong>Tests → Edit Test Group → Analyzer</strong>.
      </p>
    </div>
  );
}
