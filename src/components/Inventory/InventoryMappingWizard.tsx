import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Wand2,
  Sparkles,
  Package,
  FlaskConical,
  Layers,
  ChevronRight,
  Check,
  AlertCircle,
  Loader2,
  RefreshCw,
  Link2,
  Unlink,
  Eye,
  CheckCircle2,
  XCircle,
  Beaker,
  Settings2,
} from 'lucide-react';
import { supabase, database } from '../../utils/supabase';

interface InventoryItem {
  id: string;
  name: string;
  code?: string;
  type: string;
  unit: string;
  current_stock: number;
  ai_category?: string;
  ai_suggested_tests?: string[];
  ai_consumption_hint?: string;
  ai_classification_confidence?: number;
  ai_classification_status?: string;
  primary_mapping_instruction?: string;
  qc_lot_id?: string;
  consumption_scope?: string;
  consumption_per_use?: number;
  pack_contains?: number;
}

interface TestGroup {
  id: string;
  name: string;
  code?: string;
}

interface QCLot {
  id: string;
  lot_number: string;
  material_name: string;
}

interface MappingSummary {
  item_id: string;
  item_name: string;
  total_mappings: number;
  confirmed_mappings: number;
  mapped_test_names: string[];
  qc_lot_number?: string;
}

interface InventoryMappingWizardProps {
  labId: string;
  onClose: () => void;
  onComplete?: () => void;
}

const InventoryMappingWizard: React.FC<InventoryMappingWizardProps> = ({
  labId,
  onClose,
  onComplete,
}) => {
  // Stats
  const [stats, setStats] = useState({
    pendingClassification: 0,
    pendingMapping: 0,
    mapped: 0,
    confirmed: 0,
  });

  // Items at different stages
  const [pendingItems, setPendingItems] = useState<InventoryItem[]>([]);
  const [classifiedItems, setClassifiedItems] = useState<InventoryItem[]>([]);
  const [mappingSummaries, setMappingSummaries] = useState<MappingSummary[]>([]);

  // Context data
  const [testGroups, setTestGroups] = useState<TestGroup[]>([]);
  const [qcLots, setQCLots] = useState<QCLot[]>([]);

  // UI state
  const [activeTab, setActiveTab] = useState<'overview' | 'classify' | 'map' | 'review'>('overview');
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<any>(null);

  // Selected items for batch operations
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  // Load initial data
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Load stats
      const { data: items, error: itemsError } = await supabase
        .from('inventory_items')
        .select('id, ai_classification_status, ai_category')
        .eq('lab_id', labId)
        .eq('is_active', true);

      if (itemsError) throw itemsError;

      const statusCounts = {
        pendingClassification: items?.filter(i => !i.ai_classification_status || i.ai_classification_status === 'pending').length || 0,
        pendingMapping: items?.filter(i => i.ai_classification_status === 'classified' && i.ai_category === 'test_specific').length || 0,
        mapped: items?.filter(i => i.ai_classification_status === 'mapped').length || 0,
        confirmed: items?.filter(i => i.ai_classification_status === 'confirmed').length || 0,
      };
      setStats(statusCounts);

      // Load pending classification items
      const { data: pending, error: pendingError } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('lab_id', labId)
        .eq('is_active', true)
        .or('ai_classification_status.is.null,ai_classification_status.eq.pending')
        .order('created_at', { ascending: false })
        .limit(50);

      if (pendingError) throw pendingError;
      setPendingItems(pending || []);

      // Load classified items (pending mapping)
      const { data: classified, error: classifiedError } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('lab_id', labId)
        .eq('is_active', true)
        .eq('ai_classification_status', 'classified')
        .order('ai_classification_confidence', { ascending: false })
        .limit(50);

      if (classifiedError) throw classifiedError;
      setClassifiedItems(classified || []);

      // Load mapping summaries
      const { data: summaries, error: summaryError } = await supabase
        .from('v_inventory_mapping_summary')
        .select('*')
        .eq('lab_id', labId)
        .gt('total_mappings', 0)
        .limit(50);

      if (summaryError) throw summaryError;
      setMappingSummaries(summaries || []);

      // Load test groups
      const { data: tg, error: tgError } = await supabase
        .from('test_groups')
        .select('id, name, code')
        .eq('lab_id', labId)
        .eq('is_active', true)
        .order('name');

      if (tgError) throw tgError;
      setTestGroups(tg || []);

      // Load QC lots
      const { data: lots, error: lotsError } = await supabase
        .from('qc_lots')
        .select('id, lot_number, material_name')
        .eq('lab_id', labId)
        .eq('is_active', true)
        .order('material_name');

      if (lotsError) throw lotsError;
      setQCLots(lots || []);

    } catch (err: any) {
      console.error('Error loading data:', err);
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [labId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Run Phase 1: Classification
  const runClassification = async (itemIds?: string[]) => {
    setProcessing(true);
    setError(null);
    setResults(null);

    try {
      const itemsToClassify = itemIds
        ? pendingItems.filter(i => itemIds.includes(i.id))
        : pendingItems.slice(0, 10);

      const response = await supabase.functions.invoke('inventory-ai-classify', {
        body: {
          lab_id: labId,
          items: itemsToClassify.map(i => ({
            id: i.id,
            name: i.name,
            code: i.code,
            type: i.type,
            unit: i.unit,
            current_stock: i.current_stock,
            primary_mapping_instruction: i.primary_mapping_instruction,
          })),
          batch_size: 10,
        },
      });

      if (response.error) throw response.error;

      setResults({
        phase: 'classification',
        ...response.data,
      });

      // Reload data
      await loadData();
      setSelectedItems(new Set());

    } catch (err: any) {
      console.error('Classification error:', err);
      setError(err.message || 'Classification failed');
    } finally {
      setProcessing(false);
    }
  };

  // Run Phase 2: Mapping
  const runMapping = async (itemIds?: string[]) => {
    setProcessing(true);
    setError(null);
    setResults(null);

    try {
      const response = await supabase.functions.invoke('inventory-ai-map', {
        body: {
          lab_id: labId,
          item_ids: itemIds || undefined,
          batch_size: 10,
        },
      });

      if (response.error) throw response.error;

      setResults({
        phase: 'mapping',
        ...response.data,
      });

      // Reload data
      await loadData();
      setSelectedItems(new Set());

    } catch (err: any) {
      console.error('Mapping error:', err);
      setError(err.message || 'Mapping failed');
    } finally {
      setProcessing(false);
    }
  };

  // Confirm a mapping
  const confirmMapping = async (mappingId: string) => {
    try {
      const { data: user } = await supabase.auth.getUser();
      let appUserId: string | null = null;
      if (user?.user?.id) {
        const { data: byAuth } = await supabase
          .from('users')
          .select('id')
          .eq('auth_user_id', user.user.id)
          .maybeSingle();

        if (byAuth?.id) {
          appUserId = byAuth.id;
        } else if (user.user.email) {
          const { data: byEmail } = await supabase
            .from('users')
            .select('id')
            .eq('email', user.user.email)
            .maybeSingle();
          appUserId = byEmail?.id || null;
        }
      }

      const { error } = await supabase.rpc('fn_inventory_confirm_mapping', {
        p_mapping_id: mappingId,
        p_user_id: appUserId,
      });
      if (error) throw error;
      await loadData();
    } catch (err: any) {
      console.error('Confirm error:', err);
      setError(err.message);
    }
  };

  // Toggle item selection
  const toggleItemSelection = (itemId: string) => {
    const newSelection = new Set(selectedItems);
    if (newSelection.has(itemId)) {
      newSelection.delete(itemId);
    } else {
      newSelection.add(itemId);
    }
    setSelectedItems(newSelection);
  };

  // Select all in current view
  const selectAll = (items: InventoryItem[]) => {
    setSelectedItems(new Set(items.map(i => i.id)));
  };

  // Get category badge style
  const getCategoryBadge = (category?: string) => {
    switch (category) {
      case 'qc_control':
        return { bg: 'bg-purple-100', text: 'text-purple-700', label: 'QC/Control' };
      case 'test_specific':
        return { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Test-Specific' };
      case 'general':
        return { bg: 'bg-gray-100', text: 'text-gray-700', label: 'General' };
      default:
        return { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Pending' };
    }
  };

  // Get status badge style
  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'confirmed':
        return { bg: 'bg-green-100', text: 'text-green-700', icon: CheckCircle2 };
      case 'mapped':
        return { bg: 'bg-blue-100', text: 'text-blue-700', icon: Link2 };
      case 'classified':
        return { bg: 'bg-indigo-100', text: 'text-indigo-700', icon: Sparkles };
      default:
        return { bg: 'bg-gray-100', text: 'text-gray-600', icon: AlertCircle };
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-6xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex-none border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-indigo-100 to-purple-100 rounded-lg">
              <Wand2 className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">AI Inventory Mapping Wizard</h2>
              <p className="text-sm text-gray-500">
                Automatically classify and map inventory items to tests
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex-none border-b border-gray-100 px-6 flex gap-1">
          {[
            { id: 'overview', label: 'Overview', icon: Layers },
            { id: 'classify', label: 'Phase 1: Classify', icon: Sparkles, count: stats.pendingClassification },
            { id: 'map', label: 'Phase 2: Map', icon: Link2, count: stats.pendingMapping },
            { id: 'review', label: 'Review', icon: Eye, count: stats.mapped },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`
                flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors
                ${activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
                }
              `}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className={`
                  px-1.5 py-0.5 text-xs rounded-full
                  ${activeTab === tab.id ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}
                `}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 text-indigo-600 animate-spin" />
            </div>
          ) : (
            <>
              {/* Error Banner */}
              {error && (
                <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
                  <XCircle className="h-5 w-5 flex-shrink-0" />
                  <span className="text-sm">{error}</span>
                  <button onClick={() => setError(null)} className="ml-auto">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/* Results Banner */}
              {results && (
                <div className="mb-4 px-4 py-3 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center gap-2 text-green-700 mb-2">
                    <CheckCircle2 className="h-5 w-5" />
                    <span className="font-medium">
                      {results.phase === 'classification'
                        ? `Classified ${results.classified} items`
                        : `Created ${results.total_mappings_created} mappings for ${results.items_processed} items`
                      }
                    </span>
                  </div>
                  {results.phase === 'classification' && results.categories && (
                    <div className="flex gap-4 text-sm text-green-600">
                      <span>QC/Control: {results.categories.qc_control}</span>
                      <span>Test-Specific: {results.categories.test_specific}</span>
                      <span>General: {results.categories.general}</span>
                    </div>
                  )}
                  {results.phase === 'mapping' && results.qc_links_created > 0 && (
                    <div className="text-sm text-green-600">
                      QC Lots Linked: {results.qc_links_created}
                    </div>
                  )}
                </div>
              )}

              {/* Overview Tab */}
              {activeTab === 'overview' && (
                <div className="space-y-6">
                  {/* Stats Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertCircle className="h-5 w-5 text-yellow-600" />
                        <span className="text-sm font-medium text-yellow-800">Pending Classification</span>
                      </div>
                      <p className="text-2xl font-bold text-yellow-700">{stats.pendingClassification}</p>
                    </div>
                    <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles className="h-5 w-5 text-indigo-600" />
                        <span className="text-sm font-medium text-indigo-800">Ready to Map</span>
                      </div>
                      <p className="text-2xl font-bold text-indigo-700">{stats.pendingMapping}</p>
                    </div>
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Link2 className="h-5 w-5 text-blue-600" />
                        <span className="text-sm font-medium text-blue-800">Mapped</span>
                      </div>
                      <p className="text-2xl font-bold text-blue-700">{stats.mapped}</p>
                    </div>
                    <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle2 className="h-5 w-5 text-green-600" />
                        <span className="text-sm font-medium text-green-800">Confirmed</span>
                      </div>
                      <p className="text-2xl font-bold text-green-700">{stats.confirmed}</p>
                    </div>
                  </div>

                  {/* How It Works */}
                  <div className="bg-gradient-to-br from-gray-50 to-indigo-50/30 rounded-xl p-6 border border-gray-200">
                    <h3 className="font-semibold text-gray-900 mb-4">How AI Mapping Works</h3>
                    <div className="grid md:grid-cols-3 gap-6">
                      <div className="flex gap-3">
                        <div className="flex-none w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center text-yellow-700 font-semibold">1</div>
                        <div>
                          <h4 className="font-medium text-gray-900">Phase 1: Classify</h4>
                          <p className="text-sm text-gray-600 mt-1">
                            AI analyzes item names and categorizes them as QC/Control, Test-Specific, or General
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-3">
                        <div className="flex-none w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-700 font-semibold">2</div>
                        <div>
                          <h4 className="font-medium text-gray-900">Phase 2: Map</h4>
                          <p className="text-sm text-gray-600 mt-1">
                            Test-specific items are matched to your actual tests with consumption rules
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-3">
                        <div className="flex-none w-8 h-8 bg-green-100 rounded-full flex items-center justify-center text-green-700 font-semibold">3</div>
                        <div>
                          <h4 className="font-medium text-gray-900">Review & Confirm</h4>
                          <p className="text-sm text-gray-600 mt-1">
                            Review AI suggestions, make adjustments, and confirm accurate mappings
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Quick Actions */}
                  <div className="flex gap-4">
                    {stats.pendingClassification > 0 && (
                      <button
                        onClick={() => { setActiveTab('classify'); runClassification(); }}
                        disabled={processing}
                        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-yellow-500 to-orange-500 text-white rounded-lg hover:from-yellow-600 hover:to-orange-600 transition-colors disabled:opacity-50"
                      >
                        {processing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
                        Classify {Math.min(10, stats.pendingClassification)} Items
                      </button>
                    )}
                    {stats.pendingMapping > 0 && (
                      <button
                        onClick={() => { setActiveTab('map'); runMapping(); }}
                        disabled={processing}
                        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-lg hover:from-indigo-600 hover:to-purple-600 transition-colors disabled:opacity-50"
                      >
                        {processing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Link2 className="h-5 w-5" />}
                        Map {Math.min(10, stats.pendingMapping)} Items
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Classify Tab (Phase 1) */}
              {activeTab === 'classify' && (
                <div className="space-y-4">
                  {/* Actions Bar */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-600">
                        {pendingItems.length} items pending classification
                      </span>
                      {selectedItems.size > 0 && (
                        <span className="text-sm text-indigo-600">
                          ({selectedItems.size} selected)
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => selectAll(pendingItems.slice(0, 10))}
                        className="text-sm text-indigo-600 hover:text-indigo-700"
                      >
                        Select First 10
                      </button>
                      <button
                        onClick={() => runClassification(selectedItems.size > 0 ? Array.from(selectedItems) : undefined)}
                        disabled={processing || pendingItems.length === 0}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        Classify {selectedItems.size > 0 ? selectedItems.size : 'Batch'}
                      </button>
                    </div>
                  </div>

                  {/* Items List */}
                  {pendingItems.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-green-400" />
                      <p className="font-medium">All items have been classified!</p>
                      <p className="text-sm mt-1">Head to Phase 2 to map test-specific items.</p>
                    </div>
                  ) : (
                    <div className="border border-gray-200 rounded-xl overflow-hidden">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="w-10 px-4 py-3">
                              <input
                                type="checkbox"
                                checked={selectedItems.size === pendingItems.slice(0, 10).length && selectedItems.size > 0}
                                onChange={(e) => e.target.checked ? selectAll(pendingItems.slice(0, 10)) : setSelectedItems(new Set())}
                                className="rounded border-gray-300"
                              />
                            </th>
                            <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Item</th>
                            <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Type</th>
                            <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Stock</th>
                            <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Hint</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {pendingItems.slice(0, 20).map((item) => (
                            <tr key={item.id} className="hover:bg-gray-50">
                              <td className="px-4 py-3">
                                <input
                                  type="checkbox"
                                  checked={selectedItems.has(item.id)}
                                  onChange={() => toggleItemSelection(item.id)}
                                  className="rounded border-gray-300"
                                />
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-medium text-gray-900">{item.name}</div>
                                {item.code && <div className="text-xs text-gray-500">{item.code}</div>}
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-sm text-gray-600 capitalize">{item.type}</span>
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-sm">{item.current_stock} {item.unit}</span>
                              </td>
                              <td className="px-4 py-3">
                                <input
                                  type="text"
                                  placeholder="Add hint for AI..."
                                  defaultValue={item.primary_mapping_instruction || ''}
                                  onBlur={async (e) => {
                                    if (e.target.value !== item.primary_mapping_instruction) {
                                      await supabase
                                        .from('inventory_items')
                                        .update({ primary_mapping_instruction: e.target.value })
                                        .eq('id', item.id);
                                    }
                                  }}
                                  className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-indigo-500"
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Map Tab (Phase 2) */}
              {activeTab === 'map' && (
                <div className="space-y-4">
                  {/* Context Info */}
                  <div className="flex items-center gap-4 text-sm text-gray-600">
                    <span className="flex items-center gap-1">
                      <FlaskConical className="h-4 w-4" />
                      {testGroups.length} Test Groups
                    </span>
                    <span className="flex items-center gap-1">
                      <Beaker className="h-4 w-4" />
                      {qcLots.length} QC Lots
                    </span>
                  </div>

                  {/* Actions Bar */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-600">
                        {classifiedItems.length} items ready for mapping
                      </span>
                      {selectedItems.size > 0 && (
                        <span className="text-sm text-indigo-600">
                          ({selectedItems.size} selected)
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => selectAll(classifiedItems.slice(0, 10))}
                        className="text-sm text-indigo-600 hover:text-indigo-700"
                      >
                        Select First 10
                      </button>
                      <button
                        onClick={() => runMapping(selectedItems.size > 0 ? Array.from(selectedItems) : undefined)}
                        disabled={processing || classifiedItems.length === 0}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50"
                      >
                        {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                        Map {selectedItems.size > 0 ? selectedItems.size : 'Batch'}
                      </button>
                    </div>
                  </div>

                  {/* Items List */}
                  {classifiedItems.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-green-400" />
                      <p className="font-medium">All test-specific items have been mapped!</p>
                      <p className="text-sm mt-1">Review your mappings in the Review tab.</p>
                    </div>
                  ) : (
                    <div className="border border-gray-200 rounded-xl overflow-hidden">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="w-10 px-4 py-3">
                              <input
                                type="checkbox"
                                checked={selectedItems.size === classifiedItems.slice(0, 10).length && selectedItems.size > 0}
                                onChange={(e) => e.target.checked ? selectAll(classifiedItems.slice(0, 10)) : setSelectedItems(new Set())}
                                className="rounded border-gray-300"
                              />
                            </th>
                            <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Item</th>
                            <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Category</th>
                            <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Suggested Tests</th>
                            <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Consumption Hint</th>
                            <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Confidence</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {classifiedItems.map((item) => {
                            const catBadge = getCategoryBadge(item.ai_category);
                            return (
                              <tr key={item.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3">
                                  <input
                                    type="checkbox"
                                    checked={selectedItems.has(item.id)}
                                    onChange={() => toggleItemSelection(item.id)}
                                    className="rounded border-gray-300"
                                  />
                                </td>
                                <td className="px-4 py-3">
                                  <div className="font-medium text-gray-900">{item.name}</div>
                                  {item.code && <div className="text-xs text-gray-500">{item.code}</div>}
                                </td>
                                <td className="px-4 py-3">
                                  <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${catBadge.bg} ${catBadge.text}`}>
                                    {catBadge.label}
                                  </span>
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex flex-wrap gap-1">
                                    {item.ai_suggested_tests?.slice(0, 3).map((test, idx) => (
                                      <span key={idx} className="px-1.5 py-0.5 text-xs bg-blue-50 text-blue-700 rounded">
                                        {test}
                                      </span>
                                    ))}
                                    {(item.ai_suggested_tests?.length || 0) > 3 && (
                                      <span className="text-xs text-gray-400">
                                        +{(item.ai_suggested_tests?.length || 0) - 3}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-4 py-3">
                                  <span className="text-sm text-gray-600">{item.ai_consumption_hint || '-'}</span>
                                </td>
                                <td className="px-4 py-3">
                                  <div className="w-16 bg-gray-200 rounded-full h-2">
                                    <div
                                      className="bg-indigo-600 rounded-full h-2"
                                      style={{ width: `${(item.ai_classification_confidence || 0) * 100}%` }}
                                    />
                                  </div>
                                  <span className="text-xs text-gray-500">
                                    {Math.round((item.ai_classification_confidence || 0) * 100)}%
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Review Tab */}
              {activeTab === 'review' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">
                      {mappingSummaries.length} items with mappings
                    </span>
                    <button
                      onClick={loadData}
                      className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Refresh
                    </button>
                  </div>

                  {mappingSummaries.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <Link2 className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                      <p className="font-medium">No mappings yet</p>
                      <p className="text-sm mt-1">Run Phase 1 and Phase 2 to create mappings.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {mappingSummaries.map((summary) => (
                        <div key={summary.item_id} className="border border-gray-200 rounded-xl p-4 hover:border-indigo-200 transition-colors">
                          <div className="flex items-start justify-between">
                            <div>
                              <h4 className="font-medium text-gray-900">{summary.item_name}</h4>
                              <div className="flex flex-wrap gap-1 mt-2">
                                {summary.mapped_test_names?.map((test, idx) => (
                                  <span key={idx} className="px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded-full">
                                    {test}
                                  </span>
                                ))}
                              </div>
                              {summary.qc_lot_number && (
                                <div className="flex items-center gap-1 mt-2 text-xs text-purple-600">
                                  <Beaker className="h-3 w-3" />
                                  Linked to QC Lot: {summary.qc_lot_number}
                                </div>
                              )}
                            </div>
                            <div className="text-right">
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-500">
                                  {summary.confirmed_mappings}/{summary.total_mappings} confirmed
                                </span>
                                {summary.confirmed_mappings === summary.total_mappings ? (
                                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                                ) : (
                                  <AlertCircle className="h-5 w-5 text-yellow-500" />
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex-none border-t border-gray-100 px-6 py-4 flex justify-between items-center">
          <button
            onClick={loadData}
            className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh Data
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Close
            </button>
            {onComplete && (
              <button
                onClick={() => { onComplete(); onClose(); }}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default InventoryMappingWizard;
