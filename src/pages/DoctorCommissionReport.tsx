import React, { useState, useEffect, useMemo } from 'react';
import {
    Calculator, Download, Search, Calendar,
    ChevronDown, ChevronRight, Users, IndianRupee, FileText,
    TrendingUp, AlertCircle, RefreshCw, Bike, Stethoscope
} from 'lucide-react';
import { supabase, database } from '../utils/supabase';

interface PhlebotomistVisit {
    order_id: string;
    order_display: string | null;
    patient_name: string;
    order_date: string;
    phlebotomist_name: string | null;
    phlebotomist_id: string | null;
    charges: Array<{ name: string; amount: number; is_shareable_with_doctor: boolean }>;
    total_charges: number;
}

interface Doctor {
    id: string;
    name: string;
}

interface DoctorCommission {
    doctor_id: string;
    doctor_name: string;
    total_revenue: number;
    total_commission: number;
    orders_count: number;
    details: CommissionDetail[];
}

interface CommissionDetail {
    order_id: string;
    patient_name: string;
    date: string;
    gross_amount: number;
    adjustments: {
        dr_discount?: number;
        outsource_cost?: number;
        package_diff?: number;
    };
    sharing_base: number;
    sharing_percent: number;
    commission: number;
}

/**
 * Doctor Commission Report Page
 * Calculate and display commission breakdown with all adjustment options
 */
const DoctorCommissionReport: React.FC = () => {
    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [selectedDoctorIds, setSelectedDoctorIds] = useState<string[]>([]);
    const [dateFrom, setDateFrom] = useState<string>(() => {
        const d = new Date();
        d.setDate(1); // First day of current month
        return d.toISOString().split('T')[0];
    });
    const [dateTo, setDateTo] = useState<string>(() => {
        return new Date().toISOString().split('T')[0];
    });
    const [commissions, setCommissions] = useState<DoctorCommission[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expandedDoctors, setExpandedDoctors] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');

    // Phlebotomist Visits tab
    const [activeTab, setActiveTab] = useState<'doctor' | 'phlebotomist'>('doctor');
    const [phlebotomistVisits, setPhlebotomistVisits] = useState<PhlebotomistVisit[]>([]);
    const [phlebotomistLoading, setPhlebotomistLoading] = useState(false);

    useEffect(() => {
        loadDoctors();
    }, []);

    const loadDoctors = async () => {
        try {
            const labId = await database.getCurrentUserLabId();
            const { data, error } = await supabase
                .from('doctors')
                .select('id, name')
                .eq('lab_id', labId)
                .eq('is_active', true)
                .order('name');
            if (error) throw error;
            setDoctors(data || []);
        } catch (err) {
            console.error('Error loading doctors:', err);
        }
    };

    const loadPhlebotomistVisits = async () => {
        setPhlebotomistLoading(true);
        try {
            const labId = await database.getCurrentUserLabId();
            const { data: items } = await supabase
                .from('order_billing_items')
                .select(`
                    id,
                    order_id,
                    name,
                    amount,
                    is_shareable_with_doctor,
                    orders!inner(
                        id,
                        order_display,
                        created_at,
                        phlebotomist_id,
                        patients(name),
                        users!orders_phlebotomist_id_fkey(name)
                    )
                `)
                .eq('is_shareable_with_phlebotomist', true)
                .eq('lab_id', labId)
                .gte('created_at', dateFrom)
                .lte('created_at', dateTo + 'T23:59:59');

            // Group by order
            const orderMap = new Map<string, PhlebotomistVisit>();
            for (const item of (items || [])) {
                const order = (item as any).orders;
                if (!order) continue;
                const orderId = item.order_id;
                if (!orderMap.has(orderId)) {
                    orderMap.set(orderId, {
                        order_id: orderId,
                        order_display: order.order_display,
                        patient_name: order.patients?.name || '—',
                        order_date: order.created_at,
                        phlebotomist_id: order.phlebotomist_id,
                        phlebotomist_name: order.users?.name || null,
                        charges: [],
                        total_charges: 0,
                    });
                }
                const visit = orderMap.get(orderId)!;
                visit.charges.push({ name: item.name, amount: item.amount, is_shareable_with_doctor: item.is_shareable_with_doctor });
                visit.total_charges += item.amount;
            }
            setPhlebotomistVisits(Array.from(orderMap.values()).sort((a, b) => b.order_date.localeCompare(a.order_date)));
        } catch (err) {
            console.error('Error loading phlebotomist visits:', err);
        } finally {
            setPhlebotomistLoading(false);
        }
    };

    const calculateCommissions = async () => {
        if (selectedDoctorIds.length === 0) {
            setError('Please select at least one doctor');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const labId = await database.getCurrentUserLabId();
            const results: DoctorCommission[] = [];

            for (const doctorId of selectedDoctorIds) {
                const doctor = doctors.find(d => d.id === doctorId);
                if (!doctor) continue;

                // Get sharing settings for this doctor
                const { data: settings, error: settingsError } = await supabase
                    .from('doctor_sharing')
                    .select('*')
                    .eq('doctor_id', doctorId)
                    .single();

                console.debug('[Commission] doctor_sharing lookup:', { doctorId, settings, settingsError });

                if (!settings) {
                    // No settings configured, skip
                    console.warn('[Commission] No sharing settings for doctor, skipping:', doctorId);
                    continue;
                }

                // Get test-wise overrides
                const { data: testOverrides } = await supabase
                    .from('doctor_test_sharing')
                    .select('*')
                    .eq('doctor_id', doctorId)
                    .eq('is_active', true);

                const testSharingMap = new Map(
                    (testOverrides || []).map(o => [o.test_group_id, o.sharing_percent])
                );

                // Get all packages with their included tests for package diff calculation
                const { data: packagesData } = await supabase
                    .from('packages')
                    .select(`
                        id,
                        price,
                        package_test_groups(
                            test_group_id,
                            test_groups(price)
                        )
                    `)
                    .eq('lab_id', labId)
                    .eq('is_active', true);

                // Create map of package_id -> sum of individual test prices
                const packageTestSumMap = new Map<string, number>();
                for (const pkg of (packagesData || [])) {
                    const testSum = (pkg.package_test_groups || []).reduce((sum: number, ptg: any) => {
                        return sum + (ptg.test_groups?.price || 0);
                    }, 0);
                    packageTestSumMap.set(pkg.id, testSum);
                }

                // Get orders for this doctor in date range
                const { data: orders, error: ordersError } = await supabase
                    .from('orders')
                    .select(`
                        id,
                        order_display,
                        sample_id,
                        created_at,
                        total_amount,
                        final_amount,
                        patients(name),
                        order_tests(
                            test_group_id,
                            package_id,
                            price,
                            test_groups(name, is_outsourced),
                            packages!order_tests_package_id_fkey(id, price)
                        ),
                        invoices(discount_source)
                    `)
                    .eq('lab_id', labId)
                    .eq('referring_doctor_id', doctorId)
                    .gte('created_at', dateFrom)
                    .lte('created_at', dateTo + 'T23:59:59')
                    .eq('billing_status', 'billed');

                if (ordersError) throw ordersError;

                console.debug('[Commission] orders fetched:', { doctorId, count: orders?.length, orders });

                let totalRevenue = 0;
                let totalCommission = 0;
                const details: CommissionDetail[] = [];

                for (const order of (orders || [])) {
                    const patient = order.patients as any;
                    const patientName = patient?.name || 'Unknown';
                    const totalDiscount = Math.max(0, (order.total_amount || 0) - (order.final_amount ?? order.total_amount ?? 0));
                    // Only doctor-attributed discounts affect commission; lab discounts are absorbed by lab
                    const invoiceList = (order as any).invoices as Array<{ discount_source?: string }> | null;
                    const discountSource = invoiceList?.[0]?.discount_source ?? null;
                    const discount = discountSource === 'doctor' ? totalDiscount : 0;

                    let orderCommission = 0;
                    let grossAmount = 0;
                    let totalDeductFromCommission = 0;
                    const adjustments: CommissionDetail['adjustments'] = {};

                    for (const item of (order.order_tests || [])) {
                        const testGroup = item.test_groups as any;
                        const packageInfo = item.packages as any;
                        const itemPrice = item.price || 0;
                        grossAmount += itemPrice;

                        // Get sharing percent (test-specific or default)
                        const sharingPercent = testSharingMap.get(item.test_group_id) 
                            || settings.default_sharing_percent;

                        // Calculate sharing base (starts with item price)
                        let sharingBase = itemPrice;

                        // Handle Outsource Cost based on mode
                        if (testGroup?.is_outsourced) {
                            const outsourceCost = testGroup.outsource_cost || 0;
                            
                            if (settings.outsource_cost_mode === 'exclude_from_base') {
                                // Reduce sharing base before calculating commission
                                sharingBase -= outsourceCost;
                                adjustments.outsource_cost = (adjustments.outsource_cost || 0) + outsourceCost;
                            } else if (settings.outsource_cost_mode === 'deduct_from_commission') {
                                // Will deduct from final commission
                                totalDeductFromCommission += outsourceCost;
                                adjustments.outsource_cost = (adjustments.outsource_cost || 0) + outsourceCost;
                            }
                        }

                        // Handle Package Diff based on mode (for packages/profiles)
                        if (item.package_id && packageInfo) {
                            const packagePrice = packageInfo.price || itemPrice;
                            const testsSum = packageTestSumMap.get(item.package_id) || packagePrice;
                            const packageDiff = testsSum - packagePrice;
                            
                            if (packageDiff > 0) {
                                if (settings.package_diff_mode === 'exclude_from_base') {
                                    // Reduce sharing base before calculating commission
                                    sharingBase -= packageDiff;
                                    adjustments.package_diff = (adjustments.package_diff || 0) + packageDiff;
                                } else if (settings.package_diff_mode === 'deduct_from_commission') {
                                    // Will deduct from final commission
                                    totalDeductFromCommission += packageDiff;
                                    adjustments.package_diff = (adjustments.package_diff || 0) + packageDiff;
                                }
                            }
                        }

                        // Calculate commission for this item
                        const itemCommission = sharingBase * (sharingPercent / 100);
                        orderCommission += itemCommission;
                    }

                    // Handle Doctor Discount based on mode
                    if (discount > 0) {
                        if (settings.dr_discount_mode === 'exclude_from_base') {
                            const discountRatio = discount / grossAmount;
                            const commissionReduction = orderCommission * discountRatio;
                            totalDeductFromCommission += commissionReduction;
                            adjustments.dr_discount = discount;
                        } else if (settings.dr_discount_mode === 'deduct_from_commission') {
                            totalDeductFromCommission += discount;
                            adjustments.dr_discount = discount;
                        } else if (settings.dr_discount_mode === 'split_50_50') {
                            totalDeductFromCommission += discount / 2;
                            adjustments.dr_discount = discount / 2;
                        }
                    }

                    // Final commission = calculated commission - all deductions (minimum 0)
                    const finalOrderCommission = Math.max(0, orderCommission - totalDeductFromCommission);

                    totalRevenue += grossAmount;
                    totalCommission += finalOrderCommission;

                    details.push({
                        order_id: order.order_display || order.sample_id || order.id,
                        patient_name: patientName,
                        date: order.created_at,
                        gross_amount: grossAmount,
                        adjustments,
                        sharing_base: grossAmount,
                        sharing_percent: settings.default_sharing_percent,
                        commission: finalOrderCommission
                    });
                }

                if (details.length > 0) {
                    results.push({
                        doctor_id: doctorId,
                        doctor_name: doctor.name,
                        total_revenue: totalRevenue,
                        total_commission: totalCommission,
                        orders_count: details.length,
                        details
                    });
                }
            }

            setCommissions(results);
        } catch (err) {
            console.error('Error calculating commissions:', err);
            setError('Failed to calculate commissions');
        } finally {
            setLoading(false);
        }
    };

    const toggleDoctorExpanded = (doctorId: string) => {
        setExpandedDoctors(prev => {
            const next = new Set(prev);
            if (next.has(doctorId)) {
                next.delete(doctorId);
            } else {
                next.add(doctorId);
            }
            return next;
        });
    };

    const handleSelectAllDoctors = () => {
        if (selectedDoctorIds.length === doctors.length) {
            setSelectedDoctorIds([]);
        } else {
            setSelectedDoctorIds(doctors.map(d => d.id));
        }
    };

    const filteredDoctors = doctors.filter(d =>
        d.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const totals = useMemo(() => {
        return commissions.reduce((acc, c) => ({
            revenue: acc.revenue + c.total_revenue,
            commission: acc.commission + c.total_commission,
            orders: acc.orders + c.orders_count
        }), { revenue: 0, commission: 0, orders: 0 });
    }, [commissions]);

    const handleExportCSV = () => {
        const rows: string[] = [
            'Doctor,Order ID,Patient,Date,Gross Amount,Adjustments,Sharing Base,Commission'
        ];

        for (const commission of commissions) {
            for (const detail of commission.details) {
                const adjustmentsStr = [
                    detail.adjustments.dr_discount ? `Dr Discount: ₹${detail.adjustments.dr_discount.toFixed(2)}` : '',
                    detail.adjustments.outsource_cost ? `Outsource: ₹${detail.adjustments.outsource_cost.toFixed(2)}` : '',
                    detail.adjustments.package_diff ? `Package: ₹${detail.adjustments.package_diff.toFixed(2)}` : ''
                ].filter(Boolean).join('; ');

                rows.push([
                    commission.doctor_name,
                    detail.order_id,
                    detail.patient_name,
                    new Date(detail.date).toLocaleDateString(),
                    detail.gross_amount.toFixed(2),
                    `"${adjustmentsStr}"`,
                    detail.sharing_base.toFixed(2),
                    detail.commission.toFixed(2)
                ].join(','));
            }
        }

        const csv = rows.join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `commission-report-${dateFrom}-to-${dateTo}.csv`;
        a.click();
    };

    return (
        <div className="space-y-6">
            {/* Page Header */}
            <div>
                <h1 className="text-2xl font-bold text-gray-900">Commission Report</h1>
                <p className="text-gray-600 mt-1">Calculate doctor commissions based on sharing settings</p>
            </div>

            {/* Tab Switcher */}
            <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
                <button
                    onClick={() => setActiveTab('doctor')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'doctor' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'}`}
                >
                    <Stethoscope className="h-4 w-4" />
                    Doctor Commission
                </button>
                <button
                    onClick={() => { setActiveTab('phlebotomist'); loadPhlebotomistVisits(); }}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'phlebotomist' ? 'bg-white text-orange-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'}`}
                >
                    <Bike className="h-4 w-4" />
                    Phlebotomist Visits
                </button>
            </div>

            {/* Filters (shared for date range, hidden for phlebo tab's doctor filter) */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {/* Date Range */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            <Calendar className="h-4 w-4 inline mr-1" />
                            From Date
                        </label>
                        <input
                            type="date"
                            value={dateFrom}
                            onChange={(e) => setDateFrom(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                        />
                    </div>
                    
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            <Calendar className="h-4 w-4 inline mr-1" />
                            To Date
                        </label>
                        <input
                            type="date"
                            value={dateTo}
                            onChange={(e) => setDateTo(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                        />
                    </div>

                    {/* Doctor Selection — only for doctor tab */}
                    {activeTab === 'phlebotomist' && (
                        <div className="md:col-span-2 flex items-center gap-2 text-sm text-orange-700 bg-orange-50 rounded-lg px-3 py-2">
                            <Bike className="h-4 w-4" />
                            Date range applies to phlebotomist visits. Click Load Visits below.
                        </div>
                    )}
                    <div className={`md:col-span-2 ${activeTab === 'phlebotomist' ? 'hidden' : ''}`}>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            <Users className="h-4 w-4 inline mr-1" />
                            Doctors ({selectedDoctorIds.length} selected)
                        </label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search and select doctors..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                            />
                        </div>
                    </div>
                </div>

                {/* Doctor Selection Grid */}
                <div className="mt-4 border border-gray-200 rounded-lg max-h-48 overflow-y-auto">
                    <div className="p-2 bg-gray-50 border-b border-gray-200 sticky top-0">
                        <button
                            onClick={handleSelectAllDoctors}
                            className="text-sm text-emerald-600 hover:text-emerald-700"
                        >
                            {selectedDoctorIds.length === doctors.length ? 'Deselect All' : 'Select All'}
                        </button>
                    </div>
                    <div className="p-2 grid grid-cols-2 md:grid-cols-4 gap-2">
                        {filteredDoctors.map((doctor) => (
                            <label
                                key={doctor.id}
                                className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                                    selectedDoctorIds.includes(doctor.id) 
                                        ? 'bg-emerald-50 border border-emerald-200' 
                                        : 'hover:bg-gray-50 border border-transparent'
                                }`}
                            >
                                <input
                                    type="checkbox"
                                    checked={selectedDoctorIds.includes(doctor.id)}
                                    onChange={(e) => {
                                        if (e.target.checked) {
                                            setSelectedDoctorIds([...selectedDoctorIds, doctor.id]);
                                        } else {
                                            setSelectedDoctorIds(selectedDoctorIds.filter(id => id !== doctor.id));
                                        }
                                    }}
                                    className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                                />
                                <span className="text-sm text-gray-700 truncate">{doctor.name}</span>
                            </label>
                        ))}
                    </div>
                </div>

                {/* Actions */}
                <div className="mt-4 flex items-center gap-4">
                    {activeTab === 'doctor' ? (
                        <>
                            <button
                                onClick={calculateCommissions}
                                disabled={loading || selectedDoctorIds.length === 0}
                                className="flex items-center gap-2 px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                            >
                                {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
                                Calculate
                            </button>
                            {commissions.length > 0 && (
                                <button
                                    onClick={handleExportCSV}
                                    className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                                >
                                    <Download className="h-4 w-4" />
                                    Export CSV
                                </button>
                            )}
                        </>
                    ) : (
                        <button
                            onClick={loadPhlebotomistVisits}
                            disabled={phlebotomistLoading}
                            className="flex items-center gap-2 px-6 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
                        >
                            {phlebotomistLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Bike className="h-4 w-4" />}
                            Load Visits
                        </button>
                    )}
                </div>

                {error && (
                    <div className="mt-4 p-3 bg-red-50 text-red-700 rounded-lg flex items-center gap-2">
                        <AlertCircle className="h-4 w-4" />
                        {error}
                    </div>
                )}
            </div>

            {/* Summary Cards */}
            {commissions.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                                <IndianRupee className="h-6 w-6 text-blue-600" />
                            </div>
                            <div>
                                <p className="text-sm text-gray-500">Total Revenue</p>
                                <p className="text-2xl font-bold text-gray-900">₹{totals.revenue.toLocaleString()}</p>
                            </div>
                        </div>
                    </div>
                    
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center">
                                <TrendingUp className="h-6 w-6 text-emerald-600" />
                            </div>
                            <div>
                                <p className="text-sm text-gray-500">Total Commission</p>
                                <p className="text-2xl font-bold text-emerald-600">₹{totals.commission.toLocaleString()}</p>
                            </div>
                        </div>
                    </div>
                    
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center">
                                <FileText className="h-6 w-6 text-amber-600" />
                            </div>
                            <div>
                                <p className="text-sm text-gray-500">Total Orders</p>
                                <p className="text-2xl font-bold text-gray-900">{totals.orders}</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Results */}
            {commissions.length > 0 && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                    <div className="p-4 border-b border-gray-100">
                        <h3 className="font-semibold text-gray-900">Commission Breakdown</h3>
                    </div>
                    
                    <div className="divide-y divide-gray-100">
                        {commissions.map((commission) => (
                            <div key={commission.doctor_id}>
                                {/* Doctor Row */}
                                <button
                                    onClick={() => toggleDoctorExpanded(commission.doctor_id)}
                                    className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50"
                                >
                                    <div className="flex items-center gap-4">
                                        {expandedDoctors.has(commission.doctor_id) ? (
                                            <ChevronDown className="h-5 w-5 text-gray-400" />
                                        ) : (
                                            <ChevronRight className="h-5 w-5 text-gray-400" />
                                        )}
                                        <div className="text-left">
                                            <p className="font-medium text-gray-900">{commission.doctor_name}</p>
                                            <p className="text-sm text-gray-500">{commission.orders_count} orders</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm text-gray-500">Revenue: ₹{commission.total_revenue.toLocaleString()}</p>
                                        <p className="font-semibold text-emerald-600">Commission: ₹{commission.total_commission.toLocaleString()}</p>
                                    </div>
                                </button>
                                
                                {/* Details Table */}
                                {expandedDoctors.has(commission.doctor_id) && (
                                    <div className="px-6 pb-4 bg-gray-50">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="border-b border-gray-200">
                                                    <th className="py-2 text-left text-gray-600">Order</th>
                                                    <th className="py-2 text-left text-gray-600">Patient</th>
                                                    <th className="py-2 text-left text-gray-600">Date</th>
                                                    <th className="py-2 text-right text-gray-600">Gross</th>
                                                    <th className="py-2 text-right text-gray-600">Adjustments</th>
                                                    <th className="py-2 text-right text-gray-600">Base</th>
                                                    <th className="py-2 text-right text-gray-600">Commission</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {commission.details.map((detail, idx) => (
                                                    <tr key={idx}>
                                                        <td className="py-2 text-gray-900">{detail.order_id}</td>
                                                        <td className="py-2 text-gray-700">{detail.patient_name}</td>
                                                        <td className="py-2 text-gray-600">
                                                            {new Date(detail.date).toLocaleDateString()}
                                                        </td>
                                                        <td className="py-2 text-right text-gray-900">
                                                            ₹{detail.gross_amount.toLocaleString()}
                                                        </td>
                                                        <td className="py-2 text-right text-amber-600 text-xs">
                                                            {Object.entries(detail.adjustments)
                                                                .filter(([_, v]) => v > 0)
                                                                .map(([k, v]) => (
                                                                    <span key={k} className="block">
                                                                        -{k.replace('_', ' ')}: ₹{v?.toFixed(0)}
                                                                    </span>
                                                                ))
                                                            }
                                                        </td>
                                                        <td className="py-2 text-right text-gray-700">
                                                            ₹{detail.sharing_base.toLocaleString()}
                                                        </td>
                                                        <td className="py-2 text-right font-medium text-emerald-600">
                                                            ₹{detail.commission.toLocaleString()}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Empty State */}
            {activeTab === 'doctor' && !loading && commissions.length === 0 && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
                    <Calculator className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900">No Commission Data</h3>
                    <p className="text-gray-500 mt-1">
                        Select doctors and date range, then click Calculate to generate the report
                    </p>
                </div>
            )}

            {/* Phlebotomist Visits Tab */}
            {activeTab === 'phlebotomist' && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                                <Bike className="h-5 w-5 text-orange-500" />
                                Phlebotomist Visits with Shareable Charges
                            </h2>
                            <p className="text-sm text-gray-500 mt-0.5">
                                Orders with billing items marked as shareable with phlebotomist.
                            </p>
                        </div>
                        <button
                            onClick={loadPhlebotomistVisits}
                            disabled={phlebotomistLoading}
                            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                        >
                            <RefreshCw className={`h-3.5 w-3.5 ${phlebotomistLoading ? 'animate-spin' : ''}`} />
                            Refresh
                        </button>
                    </div>

                    {phlebotomistLoading ? (
                        <div className="bg-white rounded-xl border p-8 flex items-center justify-center">
                            <RefreshCw className="h-6 w-6 animate-spin text-orange-400" />
                        </div>
                    ) : phlebotomistVisits.length === 0 ? (
                        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
                            <Bike className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                            <h3 className="text-lg font-medium text-gray-900">No Visits Found</h3>
                            <p className="text-gray-500 mt-1 text-sm">
                                No orders in this date range have phlebotomist-shareable billing charges.
                            </p>
                        </div>
                    ) : (
                        <>
                            {/* Summary */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div className="bg-white rounded-xl border p-5">
                                    <p className="text-sm text-gray-500">Total Visits</p>
                                    <p className="text-2xl font-bold text-gray-900 mt-1">{phlebotomistVisits.length}</p>
                                </div>
                                <div className="bg-white rounded-xl border p-5">
                                    <p className="text-sm text-gray-500">Total Charges</p>
                                    <p className="text-2xl font-bold text-orange-600 mt-1">
                                        ₹{phlebotomistVisits.reduce((s, v) => s + v.total_charges, 0).toLocaleString()}
                                    </p>
                                </div>
                                <div className="bg-white rounded-xl border p-5">
                                    <p className="text-sm text-gray-500">Phlebotomists</p>
                                    <p className="text-2xl font-bold text-gray-900 mt-1">
                                        {new Set(phlebotomistVisits.map(v => v.phlebotomist_id || 'unassigned')).size}
                                    </p>
                                </div>
                            </div>

                            {/* Grouped by Phlebotomist */}
                            {(() => {
                                const groups = new Map<string, { name: string; visits: PhlebotomistVisit[]; total: number }>();
                                phlebotomistVisits.forEach(v => {
                                    const key = v.phlebotomist_id || 'unassigned';
                                    const label = v.phlebotomist_name || 'Unassigned';
                                    if (!groups.has(key)) groups.set(key, { name: label, visits: [], total: 0 });
                                    const g = groups.get(key)!;
                                    g.visits.push(v);
                                    g.total += v.total_charges;
                                });
                                return Array.from(groups.entries()).map(([key, group]) => (
                                    <div key={key} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                                        <div className="bg-orange-50 border-b border-orange-100 px-5 py-3 flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center">
                                                    <Bike className="h-4 w-4 text-orange-600" />
                                                </div>
                                                <div>
                                                    <span className="font-semibold text-orange-900">{group.name}</span>
                                                    <span className="ml-2 text-xs text-orange-600">{group.visits.length} visits</span>
                                                </div>
                                            </div>
                                            <span className="font-bold text-orange-700">₹{group.total.toLocaleString()}</span>
                                        </div>
                                        <table className="w-full text-sm">
                                            <thead className="bg-gray-50 border-b">
                                                <tr>
                                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Order</th>
                                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Patient</th>
                                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Charges</th>
                                                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {group.visits.map(visit => (
                                                    <tr key={visit.order_id} className="hover:bg-gray-50">
                                                        <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{visit.order_display || visit.order_id.slice(0, 8)}</td>
                                                        <td className="px-4 py-2.5 text-gray-900">{visit.patient_name}</td>
                                                        <td className="px-4 py-2.5 text-gray-500 text-xs">{new Date(visit.order_date).toLocaleDateString()}</td>
                                                        <td className="px-4 py-2.5">
                                                            <div className="space-y-0.5">
                                                                {visit.charges.map((c, i) => (
                                                                    <div key={i} className="flex items-center gap-1.5 text-xs">
                                                                        <span className="text-gray-700">{c.name}</span>
                                                                        {c.is_shareable_with_doctor && (
                                                                            <span title="Also shared with doctor">
                                                                                <Stethoscope className="h-3 w-3 text-blue-400" />
                                                                            </span>
                                                                        )}
                                                                        <span className="text-orange-600 font-medium ml-auto">₹{c.amount.toLocaleString()}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-2.5 text-right font-bold text-orange-700">₹{visit.total_charges.toLocaleString()}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ));
                            })()}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default DoctorCommissionReport;
