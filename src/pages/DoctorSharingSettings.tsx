import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Settings, Save, Users, Percent, Search, Check, X,
    ChevronDown, ChevronRight, AlertCircle,
    TestTube, Mic
} from 'lucide-react';
import { supabase, database } from '../utils/supabase';
import DoctorVoiceInput from '../components/Sharing/DoctorVoiceInput';

interface Doctor {
    id: string;
    name: string;
    specialization?: string;
    default_discount_percent?: number;
}

type AdjustmentMode = 'none' | 'exclude_from_base' | 'deduct_from_commission' | 'split_50_50';

interface DoctorSharingSettings {
    id?: string;
    doctor_id: string;
    sharing_type: 'percentage' | 'test_wise';
    default_sharing_percent: number;
    dr_discount_mode: AdjustmentMode;
    outsource_cost_mode: 'none' | 'exclude_from_base' | 'deduct_from_commission';
    package_diff_mode: 'none' | 'exclude_from_base' | 'deduct_from_commission';
    is_active: boolean;
}

interface TestGroup {
    id: string;
    name: string;
    price: number;
}

interface TestSharing {
    id?: string;
    doctor_id: string;
    test_group_id: string;
    sharing_percent: number;
    test_name?: string;
    test_price?: number;
}

/**
 * Doctor Sharing Settings Page
 * Configure per-doctor sharing percentages and calculation options
 */
const DoctorSharingSettings: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [selectedDoctorId, setSelectedDoctorId] = useState<string | null>(null);
    const [settings, setSettings] = useState<DoctorSharingSettings | null>(null);
    const [testSharings, setTestSharings] = useState<TestSharing[]>([]);
    const [allTests, setAllTests] = useState<TestGroup[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showTestGrid, setShowTestGrid] = useState(false);
    const [showVoiceInput, setShowVoiceInput] = useState(false);
    const [labId, setLabId] = useState<string | null>(null);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // Load doctors on mount
    useEffect(() => {
        loadDoctors();
        loadAllTests();
    }, []);

    // Load doctor from URL param
    useEffect(() => {
        const doctorId = searchParams.get('doctor');
        if (doctorId) {
            setSelectedDoctorId(doctorId);
        }
    }, [searchParams]);

    // Load settings when doctor is selected
    useEffect(() => {
        if (selectedDoctorId) {
            loadDoctorSettings(selectedDoctorId);
        }
    }, [selectedDoctorId]);

    const loadDoctors = async () => {
        try {
            const currentLabId = await database.getCurrentUserLabId();
            if (currentLabId) setLabId(currentLabId);
            const { data, error } = await supabase
                .from('doctors')
                .select('id, name, specialization, default_discount_percent')
                .eq('lab_id', currentLabId)
                .eq('is_active', true)
                .order('name');
            if (error) throw error;
            setDoctors(data || []);
        } catch (err) {
            console.error('Error loading doctors:', err);
        } finally {
            setLoading(false);
        }
    };

    const loadAllTests = async () => {
        try {
            const labId = await database.getCurrentUserLabId();
            const { data, error } = await supabase
                .from('test_groups')
                .select('id, name, price')
                .eq('lab_id', labId)
                .eq('is_active', true)
                .order('name');
            if (error) throw error;
            setAllTests(data || []);
        } catch (err) {
            console.error('Error loading tests:', err);
        }
    };

    const loadDoctorSettings = async (doctorId: string) => {
        try {
            // Load sharing settings
            const { data: sharingData, error: sharingError } = await supabase
                .from('doctor_sharing')
                .select('*')
                .eq('doctor_id', doctorId)
                .single();

            if (sharingError && sharingError.code !== 'PGRST116') {
                throw sharingError;
            }

            if (sharingData) {
                setSettings(sharingData);
            } else {
                // Default settings for new doctor
                setSettings({
                    doctor_id: doctorId,
                    sharing_type: 'percentage',
                    default_sharing_percent: 0,
                    dr_discount_mode: 'deduct_from_commission',
                    outsource_cost_mode: 'exclude_from_base',
                    package_diff_mode: 'none',
                    is_active: true
                });
            }

            // Load test-wise sharings
            const { data: testData, error: testError } = await supabase
                .from('doctor_test_sharing')
                .select('*, test_groups(name, price)')
                .eq('doctor_id', doctorId)
                .eq('is_active', true);

            if (testError) throw testError;

            const mappedTestSharings = (testData || []).map((ts: any) => ({
                id: ts.id,
                doctor_id: ts.doctor_id,
                test_group_id: ts.test_group_id,
                sharing_percent: ts.sharing_percent,
                test_name: ts.test_groups?.name,
                test_price: ts.test_groups?.price
            }));

            setTestSharings(mappedTestSharings);
        } catch (err) {
            console.error('Error loading doctor settings:', err);
            setMessage({ type: 'error', text: 'Failed to load settings' });
        }
    };

    const handleSaveSettings = async () => {
        if (!settings || !selectedDoctorId) return;

        setSaving(true);
        setMessage(null);

        try {
            const labId = await database.getCurrentUserLabId();

            // Upsert sharing settings
            const { error: sharingError } = await supabase
                .from('doctor_sharing')
                .upsert({
                    ...settings,
                    lab_id: labId,
                    doctor_id: selectedDoctorId,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'doctor_id' });

            if (sharingError) throw sharingError;

            // Save test-wise sharings
            for (const ts of testSharings) {
                if (ts.sharing_percent > 0) {
                    const { error } = await supabase
                        .from('doctor_test_sharing')
                        .upsert({
                            lab_id: labId,
                            doctor_id: selectedDoctorId,
                            test_group_id: ts.test_group_id,
                            sharing_percent: ts.sharing_percent,
                            is_active: true
                        }, { onConflict: 'doctor_id,test_group_id' });
                    
                    if (error) throw error;
                }
            }

            setMessage({ type: 'success', text: 'Settings saved successfully!' });
            
            // Reload to get fresh data
            await loadDoctorSettings(selectedDoctorId);
        } catch (err) {
            console.error('Error saving settings:', err);
            setMessage({ type: 'error', text: 'Failed to save settings' });
        } finally {
            setSaving(false);
        }
    };

    const handleTestSharingChange = (testGroupId: string, percent: number) => {
        setTestSharings(prev => {
            const existing = prev.find(ts => ts.test_group_id === testGroupId);
            if (existing) {
                return prev.map(ts => 
                    ts.test_group_id === testGroupId 
                        ? { ...ts, sharing_percent: percent }
                        : ts
                );
            } else {
                const test = allTests.find(t => t.id === testGroupId);
                return [...prev, {
                    doctor_id: selectedDoctorId!,
                    test_group_id: testGroupId,
                    sharing_percent: percent,
                    test_name: test?.name,
                    test_price: test?.price
                }];
            }
        });
    };

    // Handle voice input results
    const handleVoiceSuccess = async (actions: any[]) => {
        setShowVoiceInput(false);

        for (const action of actions) {
            if (!action.matched_doctor_id) continue;

            // If this is the currently selected doctor, update local state
            if (action.matched_doctor_id === selectedDoctorId && settings) {
                if (action.sharing_percent !== undefined) {
                    setSettings(prev => prev ? {
                        ...prev,
                        default_sharing_percent: action.sharing_percent
                    } : null);
                }

                if (action.discount_handling) {
                    setSettings(prev => prev ? {
                        ...prev,
                        dr_discount_mode: action.discount_handling as AdjustmentMode
                    } : null);
                }

                if (action.outsource_handling) {
                    setSettings(prev => prev ? {
                        ...prev,
                        outsource_cost_mode: action.outsource_handling as 'none' | 'exclude_from_base' | 'deduct_from_commission'
                    } : null);
                }

                // Handle test-specific sharing
                if (action.test_sharing_percent !== undefined && action.matched_test_id) {
                    handleTestSharingChange(action.matched_test_id, action.test_sharing_percent);
                }
            } else {
                // Different doctor - save directly to database
                try {
                    const currentLabId = await database.getCurrentUserLabId();

                    if (action.sharing_percent !== undefined) {
                        await supabase
                            .from('doctor_sharing')
                            .upsert({
                                lab_id: currentLabId,
                                doctor_id: action.matched_doctor_id,
                                default_sharing_percent: action.sharing_percent,
                                sharing_type: 'percentage',
                                dr_discount_mode: action.discount_handling || 'deduct_from_commission',
                                outsource_cost_mode: action.outsource_handling || 'exclude_from_base',
                                package_diff_mode: 'none',
                                is_active: true,
                                updated_at: new Date().toISOString()
                            }, { onConflict: 'doctor_id' });
                    }
                } catch (err) {
                    console.error('Error saving voice action:', err);
                }
            }
        }

        setMessage({ type: 'success', text: `Applied ${actions.length} sharing update(s) from voice input` });
    };

    const filteredDoctors = doctors.filter(d =>
        d.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const selectedDoctor = doctors.find(d => d.id === selectedDoctorId);

    return (
        <div className="space-y-6">
            {/* Page Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Sharing Settings</h1>
                    <p className="text-gray-600 mt-1">Configure sharing percentages and calculation options per doctor</p>
                </div>
                <button
                    onClick={() => setShowVoiceInput(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-pink-500 to-rose-500 text-white rounded-lg hover:from-pink-600 hover:to-rose-600 transition-colors"
                >
                    <Mic className="h-4 w-4" />
                    Voice Setup
                </button>
            </div>

            {/* Message */}
            {message && (
                <div className={`rounded-lg p-4 flex items-center gap-3 ${
                    message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
                }`}>
                    {message.type === 'success' ? <Check className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
                    <p>{message.text}</p>
                    <button onClick={() => setMessage(null)} className="ml-auto">
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Doctor List */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                    <div className="p-4 border-b border-gray-100">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search doctors..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                            />
                        </div>
                    </div>
                    <div className="max-h-[500px] overflow-y-auto">
                        {loading ? (
                            <div className="p-8 text-center">
                                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-600 mx-auto"></div>
                            </div>
                        ) : filteredDoctors.length > 0 ? (
                            <div className="divide-y divide-gray-100">
                                {filteredDoctors.map((doctor) => (
                                    <button
                                        key={doctor.id}
                                        onClick={() => {
                                            setSelectedDoctorId(doctor.id);
                                            setSearchParams({ doctor: doctor.id });
                                        }}
                                        className={`w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors ${
                                            selectedDoctorId === doctor.id ? 'bg-emerald-50 border-l-4 border-emerald-500' : ''
                                        }`}
                                    >
                                        <p className="font-medium text-gray-900">{doctor.name}</p>
                                        {doctor.specialization && (
                                            <p className="text-sm text-gray-500">{doctor.specialization}</p>
                                        )}
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="p-8 text-center text-gray-500">
                                No doctors found
                            </div>
                        )}
                    </div>
                </div>

                {/* Settings Panel */}
                <div className="lg:col-span-2 space-y-6">
                    {selectedDoctor && settings ? (
                        <>
                            {/* Selected Doctor Header */}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center">
                                            <Users className="h-6 w-6 text-emerald-600" />
                                        </div>
                                        <div>
                                            <h2 className="text-xl font-semibold text-gray-900">{selectedDoctor.name}</h2>
                                            <p className="text-gray-500">{selectedDoctor.specialization || 'No specialization'}</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleSaveSettings}
                                        disabled={saving}
                                        className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                                    >
                                        {saving ? (
                                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                        ) : (
                                            <Save className="h-4 w-4" />
                                        )}
                                        Save Settings
                                    </button>
                                </div>
                            </div>

                            {/* Default Sharing */}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                                <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                                    <Percent className="h-5 w-5 text-emerald-600" />
                                    Default Sharing
                                </h3>
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Sharing Type
                                        </label>
                                        <select
                                            value={settings.sharing_type}
                                            onChange={(e) => setSettings({
                                                ...settings,
                                                sharing_type: e.target.value as 'percentage' | 'test_wise'
                                            })}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                                        >
                                            <option value="percentage">Blanket Percentage</option>
                                            <option value="test_wise">Test-wise Percentage</option>
                                        </select>
                                    </div>
                                    
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Default Sharing %
                                        </label>
                                        <div className="relative">
                                            <input
                                                type="number"
                                                min="0"
                                                max="100"
                                                step="0.5"
                                                value={settings.default_sharing_percent}
                                                onChange={(e) => setSettings({
                                                    ...settings,
                                                    default_sharing_percent: parseFloat(e.target.value) || 0
                                                })}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                                            />
                                            <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500">%</span>
                                        </div>
                                        <p className="text-xs text-gray-500 mt-1">
                                            Applied to all tests unless overridden below
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Calculation Options */}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                                <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                                    <Settings className="h-5 w-5 text-emerald-600" />
                                    Calculation Options
                                </h3>
                                
                                <div className="space-y-6">
                                    {/* Option 1: Doctor Discount Handling */}
                                    <div className="p-4 bg-gray-50 rounded-lg">
                                        <p className="font-medium text-gray-900 mb-3">Doctor Discount Handling</p>
                                        <p className="text-sm text-gray-600 mb-4">
                                            How to handle discounts given by the doctor to their patients
                                        </p>
                                        <div className="space-y-2">
                                            <label className="flex items-center gap-3 p-2 rounded hover:bg-white cursor-pointer">
                                                <input
                                                    type="radio"
                                                    name="dr_discount_mode"
                                                    value="none"
                                                    checked={settings.dr_discount_mode === 'none'}
                                                    onChange={() => setSettings({ ...settings, dr_discount_mode: 'none' })}
                                                    className="text-emerald-600 focus:ring-emerald-500"
                                                />
                                                <div>
                                                    <p className="text-sm font-medium text-gray-900">No Adjustment</p>
                                                    <p className="text-xs text-gray-500">Doctor gets full commission regardless of discount</p>
                                                </div>
                                            </label>
                                            <label className="flex items-center gap-3 p-2 rounded hover:bg-white cursor-pointer">
                                                <input
                                                    type="radio"
                                                    name="dr_discount_mode"
                                                    value="exclude_from_base"
                                                    checked={settings.dr_discount_mode === 'exclude_from_base'}
                                                    onChange={() => setSettings({ ...settings, dr_discount_mode: 'exclude_from_base' })}
                                                    className="text-emerald-600 focus:ring-emerald-500"
                                                />
                                                <div>
                                                    <p className="text-sm font-medium text-gray-900">Exclude from Shareable Amount</p>
                                                    <p className="text-xs text-gray-500">₹1000 - ₹100 discount = ₹900 base → 20% = ₹180 commission</p>
                                                </div>
                                            </label>
                                            <label className="flex items-center gap-3 p-2 rounded hover:bg-white cursor-pointer">
                                                <input
                                                    type="radio"
                                                    name="dr_discount_mode"
                                                    value="deduct_from_commission"
                                                    checked={settings.dr_discount_mode === 'deduct_from_commission'}
                                                    onChange={() => setSettings({ ...settings, dr_discount_mode: 'deduct_from_commission' })}
                                                    className="text-emerald-600 focus:ring-emerald-500"
                                                />
                                                <div>
                                                    <p className="text-sm font-medium text-gray-900">Deduct from Commission</p>
                                                    <p className="text-xs text-gray-500">₹1000 × 20% = ₹200 - ₹100 discount = ₹100 commission</p>
                                                </div>
                                            </label>
                                            <label className="flex items-center gap-3 p-2 rounded hover:bg-white cursor-pointer">
                                                <input
                                                    type="radio"
                                                    name="dr_discount_mode"
                                                    value="split_50_50"
                                                    checked={settings.dr_discount_mode === 'split_50_50'}
                                                    onChange={() => setSettings({ ...settings, dr_discount_mode: 'split_50_50' })}
                                                    className="text-emerald-600 focus:ring-emerald-500"
                                                />
                                                <div>
                                                    <p className="text-sm font-medium text-gray-900">Split 50-50</p>
                                                    <p className="text-xs text-gray-500">₹1000 × 20% = ₹200 - ₹50 (half of ₹100) = ₹150 commission</p>
                                                </div>
                                            </label>
                                        </div>
                                    </div>

                                    {/* Option 2: Outsource Cost Handling */}
                                    <div className="p-4 bg-gray-50 rounded-lg">
                                        <p className="font-medium text-gray-900 mb-3">Outsource Cost Handling</p>
                                        <p className="text-sm text-gray-600 mb-4">
                                            How to handle costs paid to external labs for outsourced tests
                                        </p>
                                        <div className="space-y-2">
                                            <label className="flex items-center gap-3 p-2 rounded hover:bg-white cursor-pointer">
                                                <input
                                                    type="radio"
                                                    name="outsource_cost_mode"
                                                    value="none"
                                                    checked={settings.outsource_cost_mode === 'none'}
                                                    onChange={() => setSettings({ ...settings, outsource_cost_mode: 'none' })}
                                                    className="text-emerald-600 focus:ring-emerald-500"
                                                />
                                                <div>
                                                    <p className="text-sm font-medium text-gray-900">No Adjustment</p>
                                                    <p className="text-xs text-gray-500">Commission on full test price</p>
                                                </div>
                                            </label>
                                            <label className="flex items-center gap-3 p-2 rounded hover:bg-white cursor-pointer">
                                                <input
                                                    type="radio"
                                                    name="outsource_cost_mode"
                                                    value="exclude_from_base"
                                                    checked={settings.outsource_cost_mode === 'exclude_from_base'}
                                                    onChange={() => setSettings({ ...settings, outsource_cost_mode: 'exclude_from_base' })}
                                                    className="text-emerald-600 focus:ring-emerald-500"
                                                />
                                                <div>
                                                    <p className="text-sm font-medium text-gray-900">Exclude from Shareable Amount</p>
                                                    <p className="text-xs text-gray-500">₹1200 - ₹400 outsource = ₹800 base → 20% = ₹160 commission</p>
                                                </div>
                                            </label>
                                            <label className="flex items-center gap-3 p-2 rounded hover:bg-white cursor-pointer">
                                                <input
                                                    type="radio"
                                                    name="outsource_cost_mode"
                                                    value="deduct_from_commission"
                                                    checked={settings.outsource_cost_mode === 'deduct_from_commission'}
                                                    onChange={() => setSettings({ ...settings, outsource_cost_mode: 'deduct_from_commission' })}
                                                    className="text-emerald-600 focus:ring-emerald-500"
                                                />
                                                <div>
                                                    <p className="text-sm font-medium text-gray-900">Deduct from Commission</p>
                                                    <p className="text-xs text-gray-500">₹1200 × 20% = ₹240 - ₹400 outsource = ₹0 commission (can't go negative)</p>
                                                </div>
                                            </label>
                                        </div>
                                    </div>

                                    {/* Option 3: Package Diff Handling */}
                                    <div className="p-4 bg-gray-50 rounded-lg">
                                        <p className="font-medium text-gray-900 mb-3">Package/Profile Savings Handling</p>
                                        <p className="text-sm text-gray-600 mb-4">
                                            How to handle the discount when package price is less than sum of individual tests
                                        </p>
                                        <div className="space-y-2">
                                            <label className="flex items-center gap-3 p-2 rounded hover:bg-white cursor-pointer">
                                                <input
                                                    type="radio"
                                                    name="package_diff_mode"
                                                    value="none"
                                                    checked={settings.package_diff_mode === 'none'}
                                                    onChange={() => setSettings({ ...settings, package_diff_mode: 'none' })}
                                                    className="text-emerald-600 focus:ring-emerald-500"
                                                />
                                                <div>
                                                    <p className="text-sm font-medium text-gray-900">No Adjustment</p>
                                                    <p className="text-xs text-gray-500">Commission on package price as-is</p>
                                                </div>
                                            </label>
                                            <label className="flex items-center gap-3 p-2 rounded hover:bg-white cursor-pointer">
                                                <input
                                                    type="radio"
                                                    name="package_diff_mode"
                                                    value="exclude_from_base"
                                                    checked={settings.package_diff_mode === 'exclude_from_base'}
                                                    onChange={() => setSettings({ ...settings, package_diff_mode: 'exclude_from_base' })}
                                                    className="text-emerald-600 focus:ring-emerald-500"
                                                />
                                                <div>
                                                    <p className="text-sm font-medium text-gray-900">Exclude Savings from Shareable Amount</p>
                                                    <p className="text-xs text-gray-500">Tests = ₹2000, Package = ₹1500, Base = ₹1500 - ₹500 = ₹1000 → 20% = ₹200</p>
                                                </div>
                                            </label>
                                            <label className="flex items-center gap-3 p-2 rounded hover:bg-white cursor-pointer">
                                                <input
                                                    type="radio"
                                                    name="package_diff_mode"
                                                    value="deduct_from_commission"
                                                    checked={settings.package_diff_mode === 'deduct_from_commission'}
                                                    onChange={() => setSettings({ ...settings, package_diff_mode: 'deduct_from_commission' })}
                                                    className="text-emerald-600 focus:ring-emerald-500"
                                                />
                                                <div>
                                                    <p className="text-sm font-medium text-gray-900">Deduct Savings from Commission</p>
                                                    <p className="text-xs text-gray-500">₹1500 × 20% = ₹300 - ₹500 savings = ₹0 commission (can't go negative)</p>
                                                </div>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Test-wise Sharing */}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                                <button
                                    onClick={() => setShowTestGrid(!showTestGrid)}
                                    className="w-full p-6 flex items-center justify-between hover:bg-gray-50"
                                >
                                    <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                                        <TestTube className="h-5 w-5 text-emerald-600" />
                                        Test-wise Sharing Overrides
                                        <span className="text-sm font-normal text-gray-500">
                                            ({testSharings.filter(ts => ts.sharing_percent > 0).length} configured)
                                        </span>
                                    </h3>
                                    {showTestGrid ? (
                                        <ChevronDown className="h-5 w-5 text-gray-400" />
                                    ) : (
                                        <ChevronRight className="h-5 w-5 text-gray-400" />
                                    )}
                                </button>
                                
                                {showTestGrid && (
                                    <div className="px-6 pb-6 border-t border-gray-100">
                                        <p className="text-sm text-gray-600 py-4">
                                            Override the default sharing percentage for specific tests. Leave blank or 0 to use default.
                                        </p>
                                        <div className="max-h-[400px] overflow-y-auto border border-gray-200 rounded-lg">
                                            <table className="w-full">
                                                <thead className="bg-gray-50 sticky top-0">
                                                    <tr>
                                                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Test Name</th>
                                                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">Price</th>
                                                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-700 w-32">Sharing %</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100">
                                                    {allTests.map((test) => {
                                                        const existingSharing = testSharings.find(ts => ts.test_group_id === test.id);
                                                        return (
                                                            <tr key={test.id} className="hover:bg-gray-50">
                                                                <td className="px-4 py-3 text-sm text-gray-900">{test.name}</td>
                                                                <td className="px-4 py-3 text-sm text-gray-600 text-right">₹{test.price}</td>
                                                                <td className="px-4 py-3">
                                                                    <input
                                                                        type="number"
                                                                        min="0"
                                                                        max="100"
                                                                        step="0.5"
                                                                        value={existingSharing?.sharing_percent || ''}
                                                                        onChange={(e) => handleTestSharingChange(
                                                                            test.id,
                                                                            parseFloat(e.target.value) || 0
                                                                        )}
                                                                        placeholder={`${settings.default_sharing_percent}%`}
                                                                        className="w-full px-2 py-1 text-sm border border-gray-200 rounded focus:ring-2 focus:ring-emerald-500 text-right"
                                                                    />
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
                            <Users className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                            <h3 className="text-lg font-medium text-gray-900">Select a Doctor</h3>
                            <p className="text-gray-500 mt-1">Choose a doctor from the list to configure their sharing settings</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Voice Input Modal */}
            {showVoiceInput && labId && (
                <DoctorVoiceInput
                    labId={labId}
                    doctors={doctors}
                    tests={allTests}
                    onClose={() => setShowVoiceInput(false)}
                    onSuccess={handleVoiceSuccess}
                />
            )}
        </div>
    );
};

export default DoctorSharingSettings;
