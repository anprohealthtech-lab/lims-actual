import React, { useState, useEffect } from 'react';
import { Plus, Search, Edit, Trash2, X, DollarSign, Lock, Package } from 'lucide-react';
import { database, supabase } from '../../utils/supabase';
import { createB2BAccountUser } from '../../utils/b2bAuth';
import HeaderFooterUpload from '../Settings/HeaderFooterUpload';

// Reuse Doctor types or create Account specific types?
// Let's define specific types here for simplicity and later move to types.ts

interface Account {
    id: string;
    name: string;
    code: string | null;
    type: string | null; // 'hospital', 'corporate', 'insurer'
    contact_person?: string | null;  // Optional as it's added via migration
    billing_phone: string | null;
    billing_email: string | null;
    address_line1: string | null;
    default_discount_percent: number | null;
    credit_limit: number | null;
    payment_terms: number | null;
    is_active: boolean;
    billing_mode?: 'standard' | 'monthly' | null;
    price_master_id?: string | null;
}

interface PriceMaster {
    id: string;
    name: string;
    is_active: boolean;
}

interface AccountPrice {
    id: string;
    account_id: string;
    test_group_id: string;
    price: number;
    test_group?: {
        name: string;
        code: string;
        base_price: number;
    }
}

interface TestGroup {
    id: string;
    name: string;
    code: string;
    price: number; // Base price
}

const initialFormData: Partial<Account> = {
    name: '',
    code: '',
    type: 'hospital',
    contact_person: '',
    billing_phone: '',
    billing_email: '',
    address_line1: '',
    default_discount_percent: 0,
    credit_limit: 0,
    payment_terms: 30,
    is_active: true,
    billing_mode: 'standard',
    price_master_id: null,
};

const initialPortalData = {
    enablePortal: false,
    portalEmail: '',
    portalPassword: '',
};

const AccountMaster: React.FC = () => {
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [editingAccount, setEditingAccount] = useState<Account | null>(null);
    const [formData, setFormData] = useState<Partial<Account>>(initialFormData);
    const [portalData, setPortalData] = useState(initialPortalData);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [labId, setLabId] = useState<string | null>(null);

    // Price Management State
    const [showPriceModal, setShowPriceModal] = useState(false);
    const [selectedAccountForPrices, setSelectedAccountForPrices] = useState<Account | null>(null);
    const [accountPrices, setAccountPrices] = useState<AccountPrice[]>([]);
    const [testGroups, setTestGroups] = useState<TestGroup[]>([]);
    const [loadingPrices, setLoadingPrices] = useState(false);
    const [priceSearchTerm, setPriceSearchTerm] = useState('');
    
    // Price Masters (for dropdown in form)
    const [availablePriceMasters, setAvailablePriceMasters] = useState<PriceMaster[]>([]);

    // Package Pricing State
    const [priceTab, setPriceTab] = useState<'tests' | 'packages'>('tests');
    const [packages, setPackages] = useState<{ id: string; name: string; code: string; price: number }[]>([]);
    const [accountPackagePrices, setAccountPackagePrices] = useState<{ id: string; package_id: string; price: number; package?: { name: string; code: string; price: number } }[]>([]);

    useEffect(() => {
        const init = async () => {
            const id = await database.getCurrentUserLabId();
            if (id) {
                setLabId(id);
                loadAccounts(id);
                // Load price masters for the form dropdown
                supabase
                    .from('price_masters')
                    .select('id, name, is_active')
                    .eq('lab_id', id)
                    .eq('is_active', true)
                    .order('name')
                    .then(({ data }) => setAvailablePriceMasters(data || []));
            } else {
                setError('Lab ID not found. Please try logging in again.');
                setLoading(false);
            }
        };
        init();
    }, []);

    const loadAccounts = async (currentLabId?: string) => {
        const activeLabId = currentLabId || labId;
        if (!activeLabId) return;

        setLoading(true);
        setError(null);
        try {
            const { data, error } = await supabase
                .from('accounts')
                .select('*')
                .eq('lab_id', activeLabId)
                .order('name');
            if (error) throw error;
            setAccounts(data || []);
        } catch (err: any) {
            console.error('Error loading accounts:', err);
            setError('Failed to load accounts.');
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = async () => {
        // Implementation similar to DoctorMaster default text filter or DB search
        loadAccounts(labId || undefined); // Refresh for now
    };

    const handleCreateNew = () => {
        setEditingAccount(null);
        setFormData(initialFormData);
        setPortalData(initialPortalData);
        setShowForm(true);
        setError(null);
    };

    const handleEdit = (account: Account) => {
        setEditingAccount(account);
        setFormData(account);
        setShowForm(true);
        setError(null);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);

        try {
            if (editingAccount) {
                const { data, error } = await supabase.from('accounts').update(formData).eq('id', editingAccount.id).select();
                if (error) throw error;
                setAccounts(prev => prev.map(a => a.id === editingAccount.id ? { ...a, ...data[0] } : a));
            } else {
                if (!labId) {
                    setError('Lab ID missing. Cannot create account.');
                    return;
                }

                // Validate portal access fields if enabled
                if (portalData.enablePortal) {
                    if (!portalData.portalEmail) {
                        setError('Portal email is required when enabling portal access.');
                        setSubmitting(false);
                        return;
                    }
                    if (!portalData.portalPassword || portalData.portalPassword.length < 8) {
                        setError('Portal password must be at least 8 characters.');
                        setSubmitting(false);
                        return;
                    }
                }

                const newAccount = { ...formData, lab_id: labId };
                const { data, error } = await supabase.from('accounts').insert([newAccount]).select();
                if (error) throw error;

                const createdAccount = data[0];
                setAccounts(prev => [createdAccount, ...prev]);

                // Create B2B portal user if enabled
                if (portalData.enablePortal && createdAccount) {
                    const result = await createB2BAccountUser({
                        email: portalData.portalEmail,
                        password: portalData.portalPassword,
                        accountId: createdAccount.id,
                        accountName: createdAccount.name,
                        labId: labId,
                    });

                    if (result.success) {
                        alert(`Account created successfully!\n\nB2B Portal Access Enabled\nLogin URL: ${window.location.origin}/b2b\nEmail: ${portalData.portalEmail}`);
                    } else {
                        alert(`Account created, but portal access failed: ${result.error}\n\nPlease contact support to enable portal access.`);
                    }
                }
            }
            setShowForm(false);
            setFormData(initialFormData);
            setPortalData(initialPortalData);
            setEditingAccount(null);
        } catch (err: any) {
            console.error('Error saving account:', err);
            setError('Failed to save account.');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (account: Account) => {
        if (!confirm(`Are you sure you want to delete ${account.name}?`)) return;
        try {
            // Use database.accounts.delete if available, or direct supabase
            const { error } = await supabase.from('accounts').delete().eq('id', account.id);
            if (error) throw error;
            setAccounts(prev => prev.filter(a => a.id !== account.id));
        } catch (err) {
            console.error('Error deleting:', err);
            setError('Failed to delete account.');
        }
    };

    // --- Price Management Logic ---

    const handleManagePrices = async (account: Account) => {
        setSelectedAccountForPrices(account);
        setShowPriceModal(true);
        setLoadingPrices(true);
        setPriceTab('tests');

        try {
            // Fetch Test Groups
            const { data: tgData } = await database.testGroups.getAll();
            setTestGroups(tgData || []);

            // Fetch Existing Test Prices
            const { data: apData } = await supabase
                .from('account_prices')
                .select('*, test_group:test_groups(name, code, price)')
                .eq('account_id', account.id);

            // Map to include base price for easier display
            const formattedPrices = (apData || []).map((ap: any) => ({
                ...ap,
                test_group: {
                    name: ap.test_group.name,
                    code: ap.test_group.code,
                    base_price: ap.test_group.price
                }
            }));

            setAccountPrices(formattedPrices);

            // Fetch Packages
            const { data: pkgData } = await database.packages.getAll();
            setPackages((pkgData || []).map((p: any) => ({ id: p.id, name: p.name, code: p.code, price: p.price })));

            // Fetch Existing Package Prices
            const { data: appData } = await supabase
                .from('account_package_prices')
                .select('*, package:packages(name, code, price)')
                .eq('account_id', account.id);

            setAccountPackagePrices((appData || []).map((ap: any) => ({
                id: ap.id,
                package_id: ap.package_id,
                price: ap.price,
                package: ap.package ? {
                    name: ap.package.name,
                    code: ap.package.code,
                    price: ap.package.price
                } : undefined
            })));

        } catch (err) {
            console.error("Error loading price data", err);
        } finally {
            setLoadingPrices(false);
        }
    };

    const handleSavePrice = async (testGroupId: string, price: number) => {
        if (!selectedAccountForPrices) return;

        try {
            const { error } = await supabase
                .from('account_prices')
                .upsert({
                    account_id: selectedAccountForPrices.id,
                    test_group_id: testGroupId,
                    price: price,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'account_id, test_group_id' }); // Requires unique constraint

            if (error) throw error;

            // Refresh local state
            // Re-fetch or locally update. Let's re-fetch for safety or update locally.
            // Simplified: Re-fetch entire price list for this account
            const { data: apData } = await supabase
                .from('account_prices')
                .select('*, test_group:test_groups(name, code, price)')
                .eq('account_id', selectedAccountForPrices.id);

            const formattedPrices = (apData || []).map((ap: any) => ({
                ...ap,
                test_group: {
                    name: ap.test_group.name,
                    code: ap.test_group.code,
                    base_price: ap.test_group.price
                }
            }));
            setAccountPrices(formattedPrices);

        } catch (err) {
            console.error('Error saving price:', err);
            alert('Failed to save price');
        }
    };

    const handleRemovePrice = async (priceId: string) => {
        if (!confirm('Revert to base price?')) return;
        try {
            const { error } = await supabase.from('account_prices').delete().eq('id', priceId);
            if (error) throw error;
            setAccountPrices(prev => prev.filter(p => p.id !== priceId));
        } catch (err) {
            console.error(err);
        }
    }

    // Package Price Handlers
    const handleSavePackagePrice = async (packageId: string, price: number) => {
        if (!selectedAccountForPrices) return;

        try {
            const { error } = await supabase
                .from('account_package_prices')
                .upsert({
                    account_id: selectedAccountForPrices.id,
                    package_id: packageId,
                    price: price,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'account_id, package_id' });

            if (error) throw error;

            // Refresh package prices
            const { data: appData } = await supabase
                .from('account_package_prices')
                .select('*, package:packages(name, code, price)')
                .eq('account_id', selectedAccountForPrices.id);

            setAccountPackagePrices((appData || []).map((ap: any) => ({
                id: ap.id,
                package_id: ap.package_id,
                price: ap.price,
                package: ap.package ? {
                    name: ap.package.name,
                    code: ap.package.code,
                    price: ap.package.price
                } : undefined
            })));

        } catch (err) {
            console.error('Error saving package price:', err);
            alert('Failed to save package price');
        }
    };

    const handleRemovePackagePrice = async (priceId: string) => {
        if (!confirm('Revert to base price?')) return;
        try {
            const { error } = await supabase.from('account_package_prices').delete().eq('id', priceId);
            if (error) throw error;
            setAccountPackagePrices(prev => prev.filter(p => p.id !== priceId));
        } catch (err) {
            console.error(err);
        }
    };


    const filteredAccounts = accounts.filter(a =>
        !searchTerm || a.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const filteredTestGroups = testGroups.filter(tg =>
        !priceSearchTerm || tg.name.toLowerCase().includes(priceSearchTerm.toLowerCase())
    );

    const filteredPackages = packages.filter(pkg =>
        !priceSearchTerm || pkg.name.toLowerCase().includes(priceSearchTerm.toLowerCase())
    );

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <div className="mb-6 flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 mb-2">Account Master</h1>
                    <p className="text-gray-600">Manage B2B accounts, corporate clients, and their custom pricing.</p>
                </div>
                <button
                    onClick={handleCreateNew}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                >
                    <Plus className="w-4 h-4" />
                    Add Account
                </button>
            </div>

            {/* Search Bar */}
            <div className="mb-6 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                    type="text"
                    placeholder="Search accounts..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
            </div>

            {/* Accounts List */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Account</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contact</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {filteredAccounts.map(account => (
                            <tr key={account.id} className="hover:bg-gray-50">
                                <td className="px-6 py-4">
                                    <div className="text-sm font-medium text-gray-900">{account.name}</div>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <span className="text-sm text-gray-500">{account.code || '-'}</span>
                                        {account.price_master_id && (() => {
                                            const pm = availablePriceMasters.find(p => p.id === account.price_master_id);
                                            return pm ? (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                                                    {pm.name}
                                                </span>
                                            ) : null;
                                        })()}
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="text-sm text-gray-900">{account.billing_phone}</div>
                                    <div className="text-sm text-gray-500">{account.billing_email}</div>
                                </td>
                                <td className="px-6 py-4">
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 capitalize">
                                        {account.type || 'Standard'}
                                    </span>
                                </td>
                                <td className="px-6 py-4">
                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${account.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                        {account.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-right space-x-2">
                                    <button onClick={() => handleManagePrices(account)} className="text-purple-600 hover:text-purple-900 p-1" title="Manage Prices">
                                        <DollarSign className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => handleEdit(account)} className="text-blue-600 hover:text-blue-900 p-1" title="Edit">
                                        <Edit className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => handleDelete(account)} className="text-red-600 hover:text-red-900 p-1" title="Delete">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Add/Edit Modal */}
            {showForm && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
                        <div className="flex justify-between p-6 border-b">
                            <h2 className="text-xl font-bold">{editingAccount ? 'Edit Account' : 'New Account'}</h2>
                            <button onClick={() => setShowForm(false)}><X className="w-6 h-6" /></button>
                        </div>
                        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
                            <div className="flex-1 overflow-y-auto p-6">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="col-span-2">
                                        <label className="block text-sm font-medium mb-1">Account Name</label>
                                        <input type="text" required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full border rounded p-2" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Account Code</label>
                                        <input type="text" value={formData.code || ''} onChange={e => setFormData({ ...formData, code: e.target.value })} className="w-full border rounded p-2" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Account Type</label>
                                        <select value={formData.type || 'hospital'} onChange={e => setFormData({ ...formData, type: e.target.value })} className="w-full border rounded p-2">
                                            <option value="hospital">Hospital</option>
                                            <option value="corporate">Corporate</option>
                                            <option value="insurer">Insurance Company</option>
                                            <option value="collection_center">Collection Center</option>
                                            <option value="lab_to_lab">Lab to Lab</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Email</label>
                                        <input type="email" value={formData.billing_email || ''} onChange={e => setFormData({ ...formData, billing_email: e.target.value })} className="w-full border rounded p-2" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Phone</label>
                                        <input type="text" value={formData.billing_phone || ''} onChange={e => setFormData({ ...formData, billing_phone: e.target.value })} className="w-full border rounded p-2" />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-sm font-medium mb-1">Address</label>
                                        <textarea value={formData.address_line1 || ''} onChange={e => setFormData({ ...formData, address_line1: e.target.value })} className="w-full border rounded p-2" rows={2}></textarea>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Credit Limit (₹)</label>
                                        <input type="number" value={formData.credit_limit || 0} onChange={e => setFormData({ ...formData, credit_limit: Number(e.target.value) })} className="w-full border rounded p-2" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Default Discount (%)</label>
                                        <input type="number" max="100" value={formData.default_discount_percent || 0} onChange={e => setFormData({ ...formData, default_discount_percent: Number(e.target.value) })} className="w-full border rounded p-2" />
                                    </div>
                                    {/* Price Master */}
                                    <div className="col-span-2 border-t pt-4 mt-2">
                                        <label className="block text-sm font-medium mb-1 text-gray-700">Price Plan (Price Master)</label>
                                        <select
                                            value={formData.price_master_id || ''}
                                            onChange={e => setFormData({ ...formData, price_master_id: e.target.value || null })}
                                            className="w-full border rounded p-2 text-sm"
                                        >
                                            <option value="">— No price plan (use base / per-account prices) —</option>
                                            {availablePriceMasters.map(pm => (
                                                <option key={pm.id} value={pm.id}>{pm.name}</option>
                                            ))}
                                        </select>
                                        <p className="text-xs text-gray-500 mt-1">
                                            When a plan is selected, its test prices take priority over individual account prices. Manage plans in Settings → Price Masters.
                                        </p>
                                    </div>

                                    <div className="col-span-2 border-t pt-4 mt-2">
                                        <label className="block text-sm font-medium mb-2 text-gray-700">Billing Mode</label>
                                        <div className="flex gap-6">
                                            <label className="flex items-center cursor-pointer">
                                                <input
                                                    type="radio"
                                                    name="billing_mode"
                                                    value="standard"
                                                    checked={formData.billing_mode === 'standard' || !formData.billing_mode}
                                                    onChange={e => setFormData({ ...formData, billing_mode: e.target.value as 'standard' | 'monthly' })}
                                                    className="mr-2"
                                                />
                                                <div>
                                                    <span className="font-medium text-gray-900">Standard (Per-Order Invoice)</span>
                                                    <p className="text-xs text-gray-500">Invoice generated for each individual order</p>
                                                </div>
                                            </label>
                                            <label className="flex items-center cursor-pointer">
                                                <input
                                                    type="radio"
                                                    name="billing_mode"
                                                    value="monthly"
                                                    checked={formData.billing_mode === 'monthly'}
                                                    onChange={e => setFormData({ ...formData, billing_mode: e.target.value as 'standard' | 'monthly' })}
                                                    className="mr-2"
                                                />
                                                <div>
                                                    <span className="font-medium text-gray-900">Monthly Consolidated Billing</span>
                                                    <p className="text-xs text-gray-500">Orders accumulate for month-end consolidated invoice</p>
                                                </div>
                                            </label>
                                        </div>
                                        <div className="mt-2 text-xs text-purple-600 bg-purple-50 p-2 rounded">
                                            💡 Monthly billing: No individual invoices or payment reminders. All orders in billing period are included in one consolidated invoice.
                                        </div>
                                    </div>

                                    {/* B2B Portal Access Section - Only for new accounts */}
                                    {!editingAccount && (
                                        <div className="col-span-2 border-t pt-4 mt-2">
                                            <div className="flex items-center mb-4">
                                                <input
                                                    type="checkbox"
                                                    id="enablePortal"
                                                    checked={portalData.enablePortal}
                                                    onChange={(e) => setPortalData({ ...portalData, enablePortal: e.target.checked })}
                                                    className="mr-2 h-4 w-4 text-blue-600 rounded"
                                                />
                                                <label htmlFor="enablePortal" className="flex items-center text-sm font-medium text-gray-700 cursor-pointer">
                                                    <Lock className="w-4 h-4 mr-2 text-blue-600" />
                                                    Enable B2B Portal Access
                                                </label>
                                            </div>
                                            <p className="text-xs text-gray-500 mb-4">
                                                Allow this account to access the B2B portal to view their orders and download reports.
                                            </p>

                                            {portalData.enablePortal && (
                                                <div className="grid grid-cols-2 gap-4 bg-blue-50 p-4 rounded-lg">
                                                    <div className="col-span-2">
                                                        <label className="block text-sm font-medium mb-1 text-gray-700">Portal Login Email *</label>
                                                        <input
                                                            type="email"
                                                            required={portalData.enablePortal}
                                                            value={portalData.portalEmail}
                                                            onChange={(e) => setPortalData({ ...portalData, portalEmail: e.target.value })}
                                                            className="w-full border rounded p-2"
                                                            placeholder="portal@hospital.com"
                                                        />
                                                        <p className="text-xs text-gray-500 mt-1">This email will be used to login to the B2B portal</p>
                                                    </div>
                                                    <div className="col-span-2">
                                                        <label className="block text-sm font-medium mb-1 text-gray-700">Portal Password *</label>
                                                        <input
                                                            type="password"
                                                            required={portalData.enablePortal}
                                                            value={portalData.portalPassword}
                                                            onChange={(e) => setPortalData({ ...portalData, portalPassword: e.target.value })}
                                                            className="w-full border rounded p-2"
                                                            placeholder="Minimum 8 characters"
                                                            minLength={8}
                                                        />
                                                        <p className="text-xs text-gray-500 mt-1">Minimum 8 characters. Share this securely with the account.</p>
                                                    </div>
                                                    <div className="col-span-2 bg-blue-100 p-3 rounded">
                                                        <p className="text-xs text-blue-800">
                                                            <strong>Portal URL:</strong> {window.location.origin}/b2b<br />
                                                            The account will be able to view their orders, track status, and download reports.
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Report Customization - Only for existing accounts */}
                                {editingAccount && (
                                    <div className="col-span-2 border-t pt-4 mt-4">
                                        <HeaderFooterUpload
                                            entityType="account"
                                            entityId={editingAccount.id}
                                            entityName={editingAccount.name}
                                        />
                                    </div>
                                )}
                            </div>
                            <div className="border-t p-6 bg-gray-50">
                                <div className="flex justify-end gap-3">
                                    <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 border rounded hover:bg-gray-50">Cancel</button>
                                    <button type="submit" disabled={submitting} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">Save</button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Price Management Modal */}
            {
                showPriceModal && selectedAccountForPrices && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                        <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full h-[80vh] flex flex-col">
                            <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                                <div>
                                    <h2 className="text-xl font-bold text-gray-900">Manage Prices: {selectedAccountForPrices.name}</h2>
                                    <p className="text-sm text-gray-500">Set fixed prices for specific tests and packages. These override base prices and percentage discounts.</p>
                                </div>
                                <button onClick={() => setShowPriceModal(false)}><X className="w-6 h-6 text-gray-500" /></button>
                            </div>

                            {/* Tabs */}
                            <div className="flex border-b bg-gray-50 px-4">
                                <button
                                    onClick={() => setPriceTab('tests')}
                                    className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                                        priceTab === 'tests'
                                            ? 'border-purple-600 text-purple-600'
                                            : 'border-transparent text-gray-500 hover:text-gray-700'
                                    }`}
                                >
                                    <DollarSign className="w-4 h-4 inline mr-2" />
                                    Test Prices ({accountPrices.length} custom)
                                </button>
                                <button
                                    onClick={() => setPriceTab('packages')}
                                    className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                                        priceTab === 'packages'
                                            ? 'border-purple-600 text-purple-600'
                                            : 'border-transparent text-gray-500 hover:text-gray-700'
                                    }`}
                                >
                                    <Package className="w-4 h-4 inline mr-2" />
                                    Package Prices ({accountPackagePrices.length} custom)
                                </button>
                            </div>

                            <div className="p-4 border-b">
                                <input
                                    type="text"
                                    placeholder={`Search ${priceTab === 'tests' ? 'tests' : 'packages'}...`}
                                    value={priceSearchTerm}
                                    onChange={e => setPriceSearchTerm(e.target.value)}
                                    className="w-full border p-2 rounded"
                                />
                            </div>

                            <div className="flex-1 overflow-y-auto p-4">
                                {priceTab === 'tests' ? (
                                    <table className="min-w-full divide-y divide-gray-200">
                                        <thead>
                                            <tr>
                                                <th className="text-left py-2 font-medium text-gray-500">Test Name</th>
                                                <th className="text-left py-2 font-medium text-gray-500">Base Price</th>
                                                <th className="text-left py-2 font-medium text-gray-500">Account Price</th>
                                                <th className="text-right py-2 font-medium text-gray-500">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {filteredTestGroups.map(tg => {
                                                const override = accountPrices.find(ap => ap.test_group_id === tg.id);
                                                return (
                                                    <tr key={tg.id} className={override ? "bg-purple-50" : ""}>
                                                        <td className="py-2 text-sm">{tg.name} <span className="text-xs text-gray-400">({tg.code})</span></td>
                                                        <td className="py-2 text-sm">₹{tg.price}</td>
                                                        <td className="py-2">
                                                            <input
                                                                type="number"
                                                                defaultValue={override ? override.price : ''}
                                                                placeholder={override ? String(override.price) : "Default"}
                                                                onBlur={(e) => {
                                                                    const val = parseFloat(e.target.value);
                                                                    if (!isNaN(val)) {
                                                                        handleSavePrice(tg.id, val);
                                                                    }
                                                                }}
                                                                className="border rounded px-2 py-1 w-24 text-sm"
                                                            />
                                                        </td>
                                                        <td className="py-2 text-right">
                                                            {override && (
                                                                <button
                                                                    onClick={() => handleRemovePrice(override.id)}
                                                                    className="text-red-500 hover:text-red-700 text-xs underline"
                                                                >
                                                                    Reset
                                                                </button>
                                                            )}
                                                        </td>
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                ) : (
                                    <table className="min-w-full divide-y divide-gray-200">
                                        <thead>
                                            <tr>
                                                <th className="text-left py-2 font-medium text-gray-500">Package Name</th>
                                                <th className="text-left py-2 font-medium text-gray-500">Base Price</th>
                                                <th className="text-left py-2 font-medium text-gray-500">Account Price</th>
                                                <th className="text-right py-2 font-medium text-gray-500">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {filteredPackages.length === 0 ? (
                                                <tr>
                                                    <td colSpan={4} className="py-8 text-center text-gray-500">
                                                        No packages found. Create packages in Test Configuration first.
                                                    </td>
                                                </tr>
                                            ) : filteredPackages.map(pkg => {
                                                const override = accountPackagePrices.find(ap => ap.package_id === pkg.id);
                                                return (
                                                    <tr key={pkg.id} className={override ? "bg-purple-50" : ""}>
                                                        <td className="py-2 text-sm">{pkg.name} <span className="text-xs text-gray-400">({pkg.code})</span></td>
                                                        <td className="py-2 text-sm">₹{pkg.price}</td>
                                                        <td className="py-2">
                                                            <input
                                                                type="number"
                                                                defaultValue={override ? override.price : ''}
                                                                placeholder={override ? String(override.price) : "Default"}
                                                                onBlur={(e) => {
                                                                    const val = parseFloat(e.target.value);
                                                                    if (!isNaN(val)) {
                                                                        handleSavePackagePrice(pkg.id, val);
                                                                    }
                                                                }}
                                                                className="border rounded px-2 py-1 w-24 text-sm"
                                                            />
                                                        </td>
                                                        <td className="py-2 text-right">
                                                            {override && (
                                                                <button
                                                                    onClick={() => handleRemovePackagePrice(override.id)}
                                                                    className="text-red-500 hover:text-red-700 text-xs underline"
                                                                >
                                                                    Reset
                                                                </button>
                                                            )}
                                                        </td>
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default AccountMaster;
