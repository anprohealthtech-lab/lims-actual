import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../utils/supabase';
import { Save, Search, CheckCircle, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';

interface LabAnalyte {
  id: string;
  name: string | null;
  analyte_name: string | null;
  display_name: string | null;
  code: string | null;
  unit: string | null;
  lab_specific_unit: string | null;
  category: string | null;
}

interface InterfaceConfig {
  id?: string;
  lab_analyte_id: string;
  instrument_unit: string;
  lims_unit: string;
  multiply_by: string;
  add_offset: string;
  auto_verify: boolean;
  notes: string;
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  error: string | null;
}

export default function AnalyteInterfaceConfig({ labId }: { labId: string }) {
  const [analytes, setAnalytes] = useState<LabAnalyte[]>([]);
  const [configs, setConfigs] = useState<Map<string, InterfaceConfig>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showOnlyConfigured, setShowOnlyConfigured] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [{ data: laRows }, { data: cfgRows }] = await Promise.all([
      supabase
        .from('lab_analytes')
        .select('id, name, analyte_name, display_name, code, unit, lab_specific_unit, category')
        .eq('lab_id', labId)
        .eq('is_active', true)
        .order('name'),
      supabase
        .from('lab_analyte_interface_config')
        .select('id, lab_analyte_id, instrument_unit, lims_unit, multiply_by, add_offset, auto_verify, notes')
        .eq('lab_id', labId),
    ]);

    if (laRows) setAnalytes(laRows as LabAnalyte[]);

    const map = new Map<string, InterfaceConfig>();
    if (cfgRows) {
      for (const c of cfgRows) {
        map.set(c.lab_analyte_id, {
          id: c.id,
          lab_analyte_id: c.lab_analyte_id,
          instrument_unit: c.instrument_unit ?? '',
          lims_unit: c.lims_unit ?? '',
          multiply_by: String(c.multiply_by ?? '1'),
          add_offset: String(c.add_offset ?? '0'),
          auto_verify: c.auto_verify ?? false,
          notes: c.notes ?? '',
          dirty: false,
          saving: false,
          saved: false,
          error: null,
        });
      }
    }
    setConfigs(map);
    setLoading(false);
  }, [labId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  function getConfig(laId: string): InterfaceConfig {
    return configs.get(laId) ?? {
      lab_analyte_id: laId,
      instrument_unit: '',
      lims_unit: '',
      multiply_by: '1',
      add_offset: '0',
      auto_verify: false,
      notes: '',
      dirty: false,
      saving: false,
      saved: false,
      error: null,
    };
  }

  function updateConfig(laId: string, patch: Partial<InterfaceConfig>) {
    setConfigs(prev => {
      const next = new Map(prev);
      next.set(laId, { ...getConfig(laId), ...patch, dirty: true, saved: false });
      return next;
    });
  }

  async function saveConfig(laId: string) {
    const cfg = getConfig(laId);
    const multiplyNum = parseFloat(cfg.multiply_by);
    const offsetNum   = parseFloat(cfg.add_offset);

    if (isNaN(multiplyNum)) {
      setConfigs(prev => { const n = new Map(prev); n.set(laId, { ...cfg, error: 'Multiply By must be a number.' }); return n; });
      return;
    }

    setConfigs(prev => { const n = new Map(prev); n.set(laId, { ...cfg, saving: true, error: null }); return n; });

    const payload = {
      lab_id: labId,
      lab_analyte_id: laId,
      instrument_unit: cfg.instrument_unit.trim() || null,
      lims_unit:       cfg.lims_unit.trim()       || null,
      multiply_by:     multiplyNum,
      add_offset:      isNaN(offsetNum) ? 0 : offsetNum,
      auto_verify:     cfg.auto_verify,
      notes:           cfg.notes.trim() || null,
    };

    let err;
    if (cfg.id) {
      ({ error: err } = await supabase.from('lab_analyte_interface_config').update(payload).eq('id', cfg.id));
    } else {
      const { data: inserted, error: insertErr } = await supabase
        .from('lab_analyte_interface_config')
        .insert(payload)
        .select('id')
        .single();
      err = insertErr;
      if (!insertErr && inserted) {
        setConfigs(prev => { const n = new Map(prev); n.set(laId, { ...cfg, id: inserted.id }); return n; });
      }
    }

    setConfigs(prev => {
      const n = new Map(prev);
      n.set(laId, { ...getConfig(laId), saving: false, dirty: false, saved: !err, error: err?.message ?? null });
      return n;
    });

    if (!err) setTimeout(() => setConfigs(prev => {
      const n = new Map(prev);
      const c = n.get(laId); if (c) n.set(laId, { ...c, saved: false });
      return n;
    }), 2000);
  }

  const displayName = (a: LabAnalyte) =>
    a.display_name || a.name || a.analyte_name || a.code || a.id;

  const unit = (a: LabAnalyte) => a.lab_specific_unit || a.unit || '';

  const filtered = analytes.filter(a => {
    const q = search.toLowerCase();
    const matches = !q ||
      (a.name ?? '').toLowerCase().includes(q) ||
      (a.analyte_name ?? '').toLowerCase().includes(q) ||
      (a.display_name ?? '').toLowerCase().includes(q) ||
      (a.code ?? '').toLowerCase().includes(q) ||
      (a.category ?? '').toLowerCase().includes(q);
    if (!matches) return false;
    if (showOnlyConfigured) return configs.has(a.id);
    return true;
  });

  const configuredCount = analytes.filter(a => configs.has(a.id)).length;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-800">Analyte Interface Settings</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            Configure unit conversion and auto-verify per analyte. Applied to every result received from instruments.
          </p>
        </div>
        <span className="text-xs text-gray-400 mt-1">{configuredCount} of {analytes.length} configured</span>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search analytes…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={() => setShowOnlyConfigured(v => !v)}
          className={`px-3 py-2 text-sm rounded-lg border transition-colors ${showOnlyConfigured ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
        >
          Configured only
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-gray-400 py-6 text-center">Loading analytes…</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-gray-400 py-6 text-center">No analytes found.</div>
      ) : (
        <div className="space-y-2">
          {filtered.map(a => {
            const cfg = getConfig(a.id);
            const isConfigured = configs.has(a.id);
            const isDefault = cfg.multiply_by === '1' && cfg.add_offset === '0' && !cfg.auto_verify && !cfg.instrument_unit && !cfg.lims_unit;

            return (
              <div key={a.id} className={`bg-white border rounded-xl p-4 space-y-3 ${isConfigured && !isDefault ? 'border-blue-200' : 'border-gray-200'}`}>
                {/* Header row */}
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-semibold text-gray-800">{displayName(a)}</span>
                    {a.category && <span className="ml-2 text-xs text-gray-400">{a.category}</span>}
                    {unit(a) && <span className="ml-2 text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{unit(a)}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {cfg.saved && <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle className="h-3.5 w-3.5" />Saved</span>}
                    {cfg.error && <span className="flex items-center gap-1 text-xs text-red-500"><AlertCircle className="h-3.5 w-3.5" />{cfg.error}</span>}
                    {cfg.dirty && (
                      <button
                        onClick={() => saveConfig(a.id)}
                        disabled={cfg.saving}
                        className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      >
                        <Save className="h-3.5 w-3.5" />
                        {cfg.saving ? 'Saving…' : 'Save'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Config fields */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Instrument Unit</label>
                    <input
                      type="text"
                      placeholder={unit(a) || 'e.g. g/dL'}
                      value={cfg.instrument_unit}
                      onChange={e => updateConfig(a.id, { instrument_unit: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">LIMS Unit</label>
                    <input
                      type="text"
                      placeholder={unit(a) || 'e.g. g/L'}
                      value={cfg.lims_unit}
                      onChange={e => updateConfig(a.id, { lims_unit: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Multiply By</label>
                    <input
                      type="number"
                      step="any"
                      value={cfg.multiply_by}
                      onChange={e => updateConfig(a.id, { multiply_by: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Add Offset</label>
                    <input
                      type="number"
                      step="any"
                      value={cfg.add_offset}
                      onChange={e => updateConfig(a.id, { add_offset: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cfg.auto_verify}
                      onChange={e => updateConfig(a.id, { auto_verify: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">Auto-verify results for this analyte</span>
                  </label>
                  <div className="flex-1">
                    <input
                      type="text"
                      placeholder="Notes (optional)"
                      value={cfg.notes}
                      onChange={e => updateConfig(a.id, { notes: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Formula preview */}
                {(cfg.multiply_by !== '1' || cfg.add_offset !== '0') && (
                  <p className="text-xs text-blue-600 bg-blue-50 rounded px-2.5 py-1.5 font-mono">
                    lims_value = (instrument_value × {cfg.multiply_by || '1'}) + {cfg.add_offset || '0'}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
