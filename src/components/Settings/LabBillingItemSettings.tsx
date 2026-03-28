import React, { useState, useEffect } from 'react';
import { supabase } from '../../utils/supabase';
import {
  Plus, Edit2, Trash2, Save, X, Stethoscope, Bike,
  Lock, Share2, Loader2, AlertCircle, ReceiptText
} from 'lucide-react';

interface LabBillingItemType {
  id: string;
  name: string;
  description: string | null;
  default_amount: number;
  is_shareable_with_doctor: boolean;
  is_shareable_with_phlebotomist: boolean;
  is_active: boolean;
}

interface LabBillingItemSettingsProps {
  labId: string;
}

const emptyForm = {
  name: '',
  description: '',
  default_amount: 0,
  is_shareable_with_doctor: false,
  is_shareable_with_phlebotomist: false,
  is_active: true,
};

const LabBillingItemSettings: React.FC<LabBillingItemSettingsProps> = ({ labId }) => {
  const [items, setItems] = useState<LabBillingItemType[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (labId) load();
  }, [labId]);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('lab_billing_item_types')
      .select('*')
      .eq('lab_id', labId)
      .order('name');
    if (!error) setItems(data || []);
    setLoading(false);
  };

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
    setError(null);
  };

  const openEdit = (item: LabBillingItemType) => {
    setEditingId(item.id);
    setForm({
      name: item.name,
      description: item.description || '',
      default_amount: item.default_amount,
      is_shareable_with_doctor: item.is_shareable_with_doctor,
      is_shareable_with_phlebotomist: item.is_shareable_with_phlebotomist,
      is_active: item.is_active,
    });
    setShowForm(true);
    setError(null);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError(null);
    const payload = {
      lab_id: labId,
      name: form.name.trim(),
      description: form.description.trim() || null,
      default_amount: Number(form.default_amount) || 0,
      is_shareable_with_doctor: form.is_shareable_with_doctor,
      is_shareable_with_phlebotomist: form.is_shareable_with_phlebotomist,
      is_active: form.is_active,
      updated_at: new Date().toISOString(),
    };
    let err;
    if (editingId) {
      ({ error: err } = await supabase.from('lab_billing_item_types').update(payload).eq('id', editingId));
    } else {
      ({ error: err } = await supabase.from('lab_billing_item_types').insert(payload));
    }
    setSaving(false);
    if (err) { setError(err.message); return; }
    setShowForm(false);
    await load();
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this billing item type? It will no longer be available when creating orders.')) return;
    await supabase.from('lab_billing_item_types').delete().eq('id', id);
    await load();
  };

  const toggleActive = async (item: LabBillingItemType) => {
    await supabase.from('lab_billing_item_types')
      .update({ is_active: !item.is_active, updated_at: new Date().toISOString() })
      .eq('id', item.id);
    await load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <ReceiptText className="h-5 w-5 text-teal-600" />
            Lab Billing Items
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Define custom charges (home visit, urgent fee, etc.) that can be added to any order or invoice.
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Item
        </button>
      </div>

      {/* Sharing legend */}
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1"><Lock className="h-3.5 w-3.5 text-gray-400" /> Not shared (default)</span>
        <span className="flex items-center gap-1"><Stethoscope className="h-3.5 w-3.5 text-blue-500" /> Shared with doctor</span>
        <span className="flex items-center gap-1"><Bike className="h-3.5 w-3.5 text-orange-500" /> Shared with phlebotomist</span>
      </div>

      {/* Inline form */}
      {showForm && (
        <div className="border border-teal-200 bg-teal-50/40 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-teal-800">{editingId ? 'Edit Billing Item' : 'New Billing Item'}</h3>
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />{error}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Name <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Home Visit Charge"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Default Amount (₹)</label>
              <input
                type="number"
                min={0}
                value={form.default_amount}
                onChange={e => setForm(f => ({ ...f, default_amount: Number(e.target.value) }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
              <input
                type="text"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Optional note for staff"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>
          {/* Sharing flags */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-700">Sharing (visible in portal)</p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_shareable_with_doctor}
                onChange={e => setForm(f => ({ ...f, is_shareable_with_doctor: e.target.checked }))}
                className="rounded text-blue-600"
              />
              <Stethoscope className="h-4 w-4 text-blue-500" />
              <span className="text-sm text-gray-700">Shareable with doctor</span>
              <span className="text-xs text-gray-400">(shown in doctor commission report)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_shareable_with_phlebotomist}
                onChange={e => setForm(f => ({ ...f, is_shareable_with_phlebotomist: e.target.checked }))}
                className="rounded text-orange-500"
              />
              <Bike className="h-4 w-4 text-orange-500" />
              <span className="text-sm text-gray-700">Shareable with phlebotomist</span>
              <span className="text-xs text-gray-400">(shown in analysis tab)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                className="rounded text-teal-600"
              />
              <span className="text-sm text-gray-700">Active (available for selection)</span>
            </label>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-60 transition-colors"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {editingId ? 'Save Changes' : 'Create'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-sm text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Items list */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <ReceiptText className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No billing items defined yet.</p>
          <p className="text-xs mt-1">Add items like "Home Visit Charge" or "Urgent Processing Fee".</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
          {items.map(item => (
            <div key={item.id} className={`flex items-center gap-3 px-4 py-3 ${item.is_active ? 'bg-white' : 'bg-gray-50 opacity-60'} hover:bg-gray-50 transition-colors`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-gray-900">{item.name}</span>
                  {!item.is_active && <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Inactive</span>}
                  {!item.is_shareable_with_doctor && !item.is_shareable_with_phlebotomist && (
                    <span title="Not shared" className="text-gray-400"><Lock className="h-3.5 w-3.5" /></span>
                  )}
                  {item.is_shareable_with_doctor && (
                    <span title="Shared with doctor"><Stethoscope className="h-3.5 w-3.5 text-blue-500" /></span>
                  )}
                  {item.is_shareable_with_phlebotomist && (
                    <span title="Shared with phlebotomist"><Bike className="h-3.5 w-3.5 text-orange-500" /></span>
                  )}
                </div>
                {item.description && <p className="text-xs text-gray-500 mt-0.5 truncate">{item.description}</p>}
              </div>
              <div className="text-sm font-semibold text-gray-800 w-20 text-right">₹{item.default_amount.toFixed(2)}</div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => toggleActive(item)}
                  title={item.is_active ? 'Deactivate' : 'Activate'}
                  className="p-1.5 text-gray-400 hover:text-teal-600 transition-colors"
                >
                  <Share2 className="h-4 w-4" />
                </button>
                <button onClick={() => openEdit(item)} className="p-1.5 text-gray-400 hover:text-blue-600 transition-colors">
                  <Edit2 className="h-4 w-4" />
                </button>
                <button onClick={() => handleDelete(item.id)} className="p-1.5 text-gray-400 hover:text-red-600 transition-colors">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default LabBillingItemSettings;
