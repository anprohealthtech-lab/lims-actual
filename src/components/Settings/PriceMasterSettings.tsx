import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../utils/supabase';
import { priceMasters } from '../../utils/supabase';
import {
  Plus, Edit2, Trash2, Save, X, ChevronRight, ChevronDown,
  Loader2, AlertCircle, Tag, Search, CheckCircle2, ToggleLeft, ToggleRight,
} from 'lucide-react';

interface PriceMaster {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

interface PriceMasterItem {
  id: string;
  price_master_id: string;
  test_group_id: string;
  price: number;
  test_group?: { name: string; code: string; price: number };
}

interface TestGroup {
  id: string;
  name: string;
  code: string;
  price: number;
}

const emptyPlanForm = { name: '', description: '', is_active: true };

const PriceMasterSettings: React.FC = () => {
  const [plans, setPlans] = useState<PriceMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // plan form
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState(emptyPlanForm);

  // expanded plan for viewing/editing items
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [planItems, setPlanItems] = useState<PriceMasterItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  // test search + inline price editor
  const [allTests, setAllTests] = useState<TestGroup[]>([]);
  const [testSearch, setTestSearch] = useState('');
  const [editingPrices, setEditingPrices] = useState<Record<string, string>>({}); // testGroupId → draft price
  const [savingItem, setSavingItem] = useState<string | null>(null);

  // ─── Load plans ────────────────────────────────────────────────────────────
  const loadPlans = useCallback(async () => {
    setLoading(true);
    const { data, error } = await priceMasters.getAll();
    if (!error) setPlans(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadPlans(); }, [loadPlans]);

  // ─── Load all tests once (for the items editor) ───────────────────────────
  const loadAllTests = async () => {
    if (allTests.length > 0) return;
    const { data } = await supabase
      .from('test_groups')
      .select('id, name, code, price')
      .eq('is_active', true)
      .order('name');
    setAllTests(data || []);
  };

  // ─── Expand / collapse a plan ─────────────────────────────────────────────
  const handleToggleExpand = async (planId: string) => {
    if (expandedPlanId === planId) {
      setExpandedPlanId(null);
      return;
    }
    setExpandedPlanId(planId);
    setLoadingItems(true);
    setTestSearch('');
    setEditingPrices({});
    await loadAllTests();
    const { data } = await priceMasters.getItems(planId);
    setPlanItems(data || []);
    setLoadingItems(false);
  };

  // ─── Plan CRUD ─────────────────────────────────────────────────────────────
  const openAddPlan = () => {
    setEditingPlanId(null);
    setPlanForm(emptyPlanForm);
    setShowPlanForm(true);
    setError(null);
  };

  const openEditPlan = (plan: PriceMaster) => {
    setEditingPlanId(plan.id);
    setPlanForm({ name: plan.name, description: plan.description || '', is_active: plan.is_active });
    setShowPlanForm(true);
    setError(null);
  };

  const handleSavePlan = async () => {
    if (!planForm.name.trim()) { setError('Plan name is required'); return; }
    setSaving(true);
    setError(null);
    let err: any;
    if (editingPlanId) {
      ({ error: err } = await priceMasters.update(editingPlanId, {
        name: planForm.name.trim(),
        description: planForm.description.trim() || undefined,
        is_active: planForm.is_active,
      }));
    } else {
      ({ error: err } = await priceMasters.create({
        name: planForm.name.trim(),
        description: planForm.description.trim() || undefined,
        is_active: planForm.is_active,
      }));
    }
    setSaving(false);
    if (err) { setError(err.message); return; }
    setShowPlanForm(false);
    loadPlans();
  };

  const handleDeletePlan = async (plan: PriceMaster) => {
    if (!window.confirm(`Delete price plan "${plan.name}"? All its test prices and any account links will be removed.`)) return;
    await priceMasters.delete(plan.id);
    if (expandedPlanId === plan.id) setExpandedPlanId(null);
    loadPlans();
  };

  const handleToggleActive = async (plan: PriceMaster) => {
    await priceMasters.update(plan.id, { is_active: !plan.is_active });
    loadPlans();
  };

  // ─── Item (test price) editing ─────────────────────────────────────────────
  const getItemPrice = (testGroupId: string): number | null => {
    const item = planItems.find(i => i.test_group_id === testGroupId);
    return item ? item.price : null;
  };

  const handlePriceChange = (testGroupId: string, value: string) => {
    setEditingPrices(prev => ({ ...prev, [testGroupId]: value }));
  };

  const handleSaveItemPrice = async (testGroupId: string) => {
    if (!expandedPlanId) return;
    const raw = editingPrices[testGroupId];
    const price = parseFloat(raw);
    if (isNaN(price) || price < 0) return;
    setSavingItem(testGroupId);
    await priceMasters.upsertItem(expandedPlanId, testGroupId, price);
    // refresh items
    const { data } = await priceMasters.getItems(expandedPlanId);
    setPlanItems(data || []);
    setEditingPrices(prev => { const n = { ...prev }; delete n[testGroupId]; return n; });
    setSavingItem(null);
  };

  const handleRemoveItem = async (testGroupId: string) => {
    const item = planItems.find(i => i.test_group_id === testGroupId);
    if (!item) return;
    await priceMasters.deleteItem(item.id);
    setPlanItems(prev => prev.filter(i => i.test_group_id !== testGroupId));
  };

  // ─── Filtered tests for the items editor ──────────────────────────────────
  const filteredTests = allTests.filter(t =>
    !testSearch ||
    t.name.toLowerCase().includes(testSearch.toLowerCase()) ||
    t.code.toLowerCase().includes(testSearch.toLowerCase())
  );

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <Tag className="h-5 w-5 text-indigo-600" />
            Price Masters
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Create named pricing plans and attach them to B2B accounts. Accounts will use their plan's prices instead of base prices.
          </p>
        </div>
        <button
          onClick={openAddPlan}
          className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Plan
        </button>
      </div>

      {/* Plan form */}
      {showPlanForm && (
        <div className="border border-indigo-200 bg-indigo-50/40 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-indigo-800">{editingPlanId ? 'Edit Plan' : 'New Price Plan'}</h3>
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />{error}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Plan Name <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={planForm.name}
                onChange={e => setPlanForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Hospital Discount Plan A"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
              <input
                type="text"
                value={planForm.description}
                onChange={e => setPlanForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Optional note"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={planForm.is_active}
              onChange={e => setPlanForm(f => ({ ...f, is_active: e.target.checked }))}
              className="rounded text-indigo-600"
            />
            <span className="text-sm text-gray-700">Active</span>
          </label>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleSavePlan}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {editingPlanId ? 'Save Changes' : 'Create Plan'}
            </button>
            <button
              onClick={() => setShowPlanForm(false)}
              className="px-4 py-2 text-sm text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Plans list */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : plans.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Tag className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No price plans yet.</p>
          <p className="text-xs mt-1">Create a plan and attach it to a B2B account in Account Master.</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
          {plans.map(plan => (
            <div key={plan.id}>
              {/* Plan row */}
              <div className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors ${!plan.is_active ? 'opacity-60' : ''}`}>
                <button
                  onClick={() => handleToggleExpand(plan.id)}
                  className="p-1 text-gray-400 hover:text-indigo-600 transition-colors"
                  title={expandedPlanId === plan.id ? 'Collapse' : 'View & edit test prices'}
                >
                  {expandedPlanId === plan.id
                    ? <ChevronDown className="h-4 w-4" />
                    : <ChevronRight className="h-4 w-4" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-gray-900">{plan.name}</span>
                    {!plan.is_active && (
                      <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Inactive</span>
                    )}
                  </div>
                  {plan.description && (
                    <p className="text-xs text-gray-500 mt-0.5 truncate">{plan.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleToggleActive(plan)}
                    title={plan.is_active ? 'Deactivate' : 'Activate'}
                    className="p-1.5 text-gray-400 hover:text-indigo-600 transition-colors"
                  >
                    {plan.is_active
                      ? <ToggleRight className="h-4 w-4 text-indigo-600" />
                      : <ToggleLeft className="h-4 w-4" />}
                  </button>
                  <button onClick={() => openEditPlan(plan)} className="p-1.5 text-gray-400 hover:text-blue-600 transition-colors">
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button onClick={() => handleDeletePlan(plan)} className="p-1.5 text-gray-400 hover:text-red-600 transition-colors">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Expanded: test price editor */}
              {expandedPlanId === plan.id && (
                <div className="border-t border-gray-100 bg-gray-50 px-4 py-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Test Prices</p>
                    <p className="text-xs text-gray-400">
                      {planItems.length} test{planItems.length !== 1 ? 's' : ''} with custom pricing
                    </p>
                  </div>

                  {/* Search */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-3.5 w-3.5" />
                    <input
                      type="text"
                      value={testSearch}
                      onChange={e => setTestSearch(e.target.value)}
                      placeholder="Search tests by name or code..."
                      className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                    />
                  </div>

                  {loadingItems ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
                    </div>
                  ) : (
                    <div className="max-h-96 overflow-y-auto divide-y divide-gray-100 border border-gray-200 rounded-lg bg-white">
                      {filteredTests.length === 0 ? (
                        <p className="text-center text-sm text-gray-400 py-6">No tests found.</p>
                      ) : filteredTests.map(test => {
                        const planPrice = getItemPrice(test.id);
                        const draftValue = editingPrices[test.id];
                        const isEditing = draftValue !== undefined;
                        const isSaving = savingItem === test.id;

                        return (
                          <div key={test.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-800 font-medium truncate">{test.name}</span>
                                {planPrice !== null && (
                                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" title="Has custom price" />
                                )}
                              </div>
                              <div className="flex items-center gap-3 text-xs text-gray-400 mt-0.5">
                                <span>{test.code}</span>
                                <span>Base: ₹{test.price.toFixed(2)}</span>
                                {planPrice !== null && (
                                  <span className="text-indigo-600 font-medium">Plan: ₹{planPrice.toFixed(2)}</span>
                                )}
                              </div>
                            </div>

                            {/* Price input */}
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <input
                                type="number"
                                min={0}
                                step={0.01}
                                value={isEditing ? draftValue : (planPrice ?? '')}
                                placeholder={`${test.price}`}
                                onChange={e => handlePriceChange(test.id, e.target.value)}
                                className="w-24 px-2 py-1 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 text-right"
                              />
                              {isEditing && (
                                <button
                                  onClick={() => handleSaveItemPrice(test.id)}
                                  disabled={isSaving}
                                  className="p-1 text-indigo-600 hover:text-indigo-800 transition-colors"
                                  title="Save price"
                                >
                                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                </button>
                              )}
                              {planPrice !== null && !isEditing && (
                                <button
                                  onClick={() => handleRemoveItem(test.id)}
                                  className="p-1 text-gray-300 hover:text-red-500 transition-colors"
                                  title="Remove custom price (revert to base)"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <p className="text-xs text-gray-400">
                    Type a price and click <Save className="h-3 w-3 inline" /> to save. Click <X className="h-3 w-3 inline" /> to remove a custom price (test will fall back to base price).
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PriceMasterSettings;
