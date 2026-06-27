import React, { useMemo, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { supabase } from '../../utils/supabase';

export type AccessionFieldType = 'boolean' | 'select' | 'text';

export interface AccessionFlowItem {
  id: string;
  label: string;
  type: AccessionFieldType;
  required?: boolean;
  options?: string[];
  passValue?: string;
}

export interface AccessionCollectionConfig {
  sample_type_flows?: Record<string, { items?: AccessionFlowItem[] }>;
}

interface AccessionSettingsProps {
  labId: string;
  value?: AccessionCollectionConfig | null;
  onSaved?: (config: AccessionCollectionConfig) => void;
}

const defaultItems: AccessionFlowItem[] = [
  { id: 'sample-volume', label: 'Sample volume proper', type: 'boolean', required: true, passValue: 'yes' },
  { id: 'seal-proper', label: 'Seal proper', type: 'boolean', required: true, passValue: 'yes' },
  { id: 'hemolysis', label: 'No hemolysis', type: 'boolean', required: true, passValue: 'yes' },
];

const normalizeConfig = (config?: AccessionCollectionConfig | null): AccessionCollectionConfig => ({
  sample_type_flows: config?.sample_type_flows && typeof config.sample_type_flows === 'object'
    ? config.sample_type_flows
    : {},
});

const makeId = () => `field-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const AccessionSettings: React.FC<AccessionSettingsProps> = ({ labId, value, onSaved }) => {
  const [config, setConfig] = useState<AccessionCollectionConfig>(() => normalizeConfig(value));
  const [sampleType, setSampleType] = useState('Serum');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const flows = config.sample_type_flows || {};
  const sampleTypes = useMemo(() => Object.keys(flows).sort(), [flows]);

  const setFlowItems = (type: string, items: AccessionFlowItem[]) => {
    setConfig((current) => ({
      sample_type_flows: {
        ...(current.sample_type_flows || {}),
        [type]: { items },
      },
    }));
  };

  const addSampleType = () => {
    const type = sampleType.trim();
    if (!type) return;
    if (flows[type]) return;
    setFlowItems(type, defaultItems);
    setSampleType('');
  };

  const removeSampleType = (type: string) => {
    setConfig((current) => {
      const next = { ...(current.sample_type_flows || {}) };
      delete next[type];
      return { sample_type_flows: next };
    });
  };

  const updateItem = (type: string, itemId: string, patch: Partial<AccessionFlowItem>) => {
    const items = flows[type]?.items || [];
    setFlowItems(type, items.map((item) => item.id === itemId ? { ...item, ...patch } : item));
  };

  const addItem = (type: string) => {
    setFlowItems(type, [
      ...(flows[type]?.items || []),
      { id: makeId(), label: 'New check', type: 'boolean', required: true, passValue: 'yes' },
    ]);
  };

  const removeItem = (type: string, itemId: string) => {
    setFlowItems(type, (flows[type]?.items || []).filter((item) => item.id !== itemId));
  };

  const save = async () => {
    try {
      setSaving(true);
      setMessage(null);
      const cleaned: AccessionCollectionConfig = {
        sample_type_flows: Object.fromEntries(
          Object.entries(flows).map(([type, flow]) => [
            type,
            {
              items: (flow.items || [])
                .map((item) => ({
                  ...item,
                  label: item.label.trim(),
                  options: item.type === 'select' ? (item.options || []).map((option) => option.trim()).filter(Boolean) : undefined,
                  passValue: item.type === 'boolean' ? (item.passValue || 'yes') : item.passValue,
                }))
                .filter((item) => item.label),
            },
          ]),
        ),
      };
      const { error } = await supabase
        .from('labs')
        .update({ accession_collection_config: cleaned })
        .eq('id', labId);
      if (error) throw error;
      setConfig(cleaned);
      onSaved?.(cleaned);
      setMessage('Accession settings saved.');
    } catch (err: any) {
      setMessage(err.message || 'Failed to save accession settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Accession Settings</h2>
        <p className="mt-1 text-sm text-gray-500">Configure sample-type collection checks shown before marking samples collected.</p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={sampleType}
            onChange={(event) => setSampleType(event.target.value)}
            placeholder="Sample type, e.g. Serum, EDTA Blood"
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={addSampleType}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Add Sample Type
          </button>
        </div>
      </div>

      {sampleTypes.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          No accession flows configured yet.
        </div>
      ) : (
        <div className="space-y-4">
          {sampleTypes.map((type) => (
            <div key={type} className="rounded-lg border border-gray-200 bg-white">
              <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                <div>
                  <h3 className="font-semibold text-gray-900">{type}</h3>
                  <p className="text-xs text-gray-500">{flows[type]?.items?.length || 0} collection checks</p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => addItem(type)}
                    className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <Plus className="h-4 w-4" />
                    Add Field
                  </button>
                  <button
                    type="button"
                    onClick={() => removeSampleType(type)}
                    className="rounded-md p-2 text-red-500 hover:bg-red-50"
                    title="Remove sample type"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="divide-y divide-gray-100">
                {(flows[type]?.items || []).map((item) => (
                  <div key={item.id} className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_140px_110px_minmax(0,1fr)_40px]">
                    <input
                      value={item.label}
                      onChange={(event) => updateItem(type, item.id, { label: event.target.value })}
                      className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <select
                      value={item.type}
                      onChange={(event) => updateItem(type, item.id, { type: event.target.value as AccessionFieldType })}
                      className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="boolean">Yes / No</option>
                      <option value="select">Select</option>
                      <option value="text">Text</option>
                    </select>
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={item.required !== false}
                        onChange={(event) => updateItem(type, item.id, { required: event.target.checked })}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      Required
                    </label>
                    {item.type === 'select' ? (
                      <input
                        value={(item.options || []).join(', ')}
                        onChange={(event) => updateItem(type, item.id, { options: event.target.value.split(',') })}
                        placeholder="Options separated by comma"
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    ) : item.type === 'boolean' ? (
                      <select
                        value={item.passValue || 'yes'}
                        onChange={(event) => updateItem(type, item.id, { passValue: event.target.value })}
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="yes">Pass when Yes</option>
                        <option value="no">Pass when No</option>
                      </select>
                    ) : (
                      <div className="text-xs text-gray-400 self-center">Free text response</div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeItem(type, item.id)}
                      className="rounded-md p-2 text-red-500 hover:bg-red-50"
                      title="Remove field"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">{message}</div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {saving ? 'Saving...' : 'Save Accession Settings'}
        </button>
      </div>
    </div>
  );
};

export default AccessionSettings;
