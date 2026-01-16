import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Download, Filter, Search, Calendar, RefreshCw, PlusCircle } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { getCurrentB2BAccount } from '../utils/b2bAuth';
import AccountInfoCard from '../components/B2B/AccountInfoCard';
import B2BBookingModal from '../components/B2B/B2BBookingModal';

interface Order {
    id: string;
    patient_name: string;
    patient_id: string;
    status: string;
    priority: string;
    order_date: string;
    expected_date: string;
    total_amount: number;
    sample_id?: string;
    color_code?: string;
    color_name?: string;
    reports?: Array<{
        id: string;
        pdf_url?: string;
        status: string;
        generated_date?: string;
    }>;
}

const B2BPortal: React.FC = () => {
    const navigate = useNavigate();
    const [account, setAccount] = useState<any>(null);
    const [orders, setOrders] = useState<Order[]>([]);
    const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('All');
    const [dateRange, setDateRange] = useState({ from: '', to: '' });
    const [showBookingModal, setShowBookingModal] = useState(false);

    // Load account and orders
    useEffect(() => {
        loadData();
    }, []);

    // Apply filters
    useEffect(() => {
        applyFilters();
    }, [orders, searchTerm, statusFilter, dateRange]);

    const loadData = async () => {
        try {
            setLoading(true);

            // Get account info
            const accountData = await getCurrentB2BAccount();
            if (!accountData) {
                alert('Unable to load account information');
                handleLogout();
                return;
            }
            setAccount(accountData);

            // Fetch orders for this account
            // Note: Don't join with patients table - B2B users don't have access
            // patient_name is already in the orders table
            const { data: ordersData, error } = await supabase
                .from('orders')
                .select(`
                    *,
                    reports(id, pdf_url, status, generated_date)
                `)
                .eq('account_id', accountData.id)
                .order('order_date', { ascending: false });

            if (error) {
                console.error('Error fetching orders:', error);
                alert('Failed to load orders');
                return;
            }

            setOrders(ordersData || []);
        } catch (error) {
            console.error('Error loading data:', error);
            alert('An error occurred while loading data');
        } finally {
            setLoading(false);
        }
    };

    const applyFilters = () => {
        let filtered = [...orders];

        // Search filter
        if (searchTerm) {
            const search = searchTerm.toLowerCase();
            filtered = filtered.filter(
                (order) =>
                    order.sample_id?.toLowerCase().includes(search) ||
                    order.patient_name?.toLowerCase().includes(search) ||
                    order.id.toLowerCase().includes(search)
            );
        }

        // Status filter
        if (statusFilter !== 'All') {
            filtered = filtered.filter((order) => order.status === statusFilter);
        }

        // Date range filter
        if (dateRange.from) {
            filtered = filtered.filter((order) => order.order_date >= dateRange.from);
        }
        if (dateRange.to) {
            filtered = filtered.filter((order) => order.order_date <= dateRange.to);
        }

        setFilteredOrders(filtered);
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
        navigate('/b2b');
    };

    const handleDownloadReport = (reportUrl: string) => {
        window.open(reportUrl, '_blank');
    };

    const getStatusColor = (status: string) => {
        const colors: Record<string, string> = {
            'Pending Collection': 'bg-yellow-100 text-yellow-800',
            'In Progress': 'bg-blue-100 text-blue-800',
            'Pending Approval': 'bg-orange-100 text-orange-800',
            'Report Ready': 'bg-green-100 text-green-800',
            'Completed': 'bg-green-100 text-green-800',
            'Delivered': 'bg-gray-100 text-gray-800',
        };
        return colors[status] || 'bg-gray-100 text-gray-800';
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            maximumFractionDigits: 0,
        }).format(amount);
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        });
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="mt-4 text-gray-600">Loading portal...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <header className="bg-white shadow-sm border-b border-gray-200">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">B2B Portal</h1>
                            <p className="text-sm text-gray-600 mt-1">Welcome back, {account?.name}</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => setShowBookingModal(true)}
                                className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                            >
                                <PlusCircle className="h-4 w-4 mr-2" />
                                Book New Test
                            </button>
                            <button
                                onClick={handleLogout}
                                className="flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                            >
                                <LogOut className="h-4 w-4 mr-2" />
                                Logout
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Account Info */}
                {account && (
                    <div className="mb-8">
                        <AccountInfoCard account={account} />
                    </div>
                )}

                {/* Orders Section */}
                <div className="bg-white rounded-lg shadow-md border border-gray-200">
                    {/* Filters */}
                    <div className="p-6 border-b border-gray-200">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-bold text-gray-900">Your Orders</h2>
                            <button
                                onClick={loadData}
                                className="flex items-center px-3 py-2 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                            >
                                <RefreshCw className="h-4 w-4 mr-2" />
                                Refresh
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            {/* Search */}
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <input
                                    type="text"
                                    placeholder="Search by Sample ID or Patient..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>

                            {/* Status Filter */}
                            <div className="relative">
                                <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <select
                                    value={statusFilter}
                                    onChange={(e) => setStatusFilter(e.target.value)}
                                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                >
                                    <option value="All">All Status</option>
                                    <option value="Pending Collection">Pending Collection</option>
                                    <option value="In Progress">In Progress</option>
                                    <option value="Pending Approval">Pending Approval</option>
                                    <option value="Report Ready">Report Ready</option>
                                    <option value="Completed">Completed</option>
                                    <option value="Delivered">Delivered</option>
                                </select>
                            </div>

                            {/* Date From */}
                            <div className="relative">
                                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <input
                                    type="date"
                                    value={dateRange.from}
                                    onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })}
                                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    placeholder="From Date"
                                />
                            </div>

                            {/* Date To */}
                            <div className="relative">
                                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <input
                                    type="date"
                                    value={dateRange.to}
                                    onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })}
                                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    placeholder="To Date"
                                />
                            </div>
                        </div>

                        <div className="mt-4 text-sm text-gray-600">
                            Showing {filteredOrders.length} of {orders.length} orders
                        </div>
                    </div>

                    {/* Orders Table */}
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Sample ID
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Patient
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Order Date
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Status
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Amount
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Actions
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {filteredOrders.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                                            No orders found
                                        </td>
                                    </tr>
                                ) : (
                                    filteredOrders.map((order) => (
                                        <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="flex items-center">
                                                    {order.color_code && (
                                                        <div
                                                            className="w-3 h-3 rounded-full mr-2"
                                                            style={{ backgroundColor: order.color_code }}
                                                            title={order.color_name}
                                                        />
                                                    )}
                                                    <span className="text-sm font-medium text-gray-900">
                                                        {order.sample_id || 'N/A'}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-sm text-gray-900">{order.patient_name}</div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-sm text-gray-900">{formatDate(order.order_date)}</div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(order.status)}`}>
                                                    {order.status}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-sm font-medium text-gray-900">
                                                    {formatCurrency(order.total_amount)}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                                                <div className="flex items-center space-x-2">
                                                    {order.reports && order.reports.length > 0 && order.reports[0].pdf_url ? (
                                                        <button
                                                            onClick={() => handleDownloadReport(order.reports![0].pdf_url!)}
                                                            className="flex items-center px-3 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors"
                                                        >
                                                            <Download className="h-4 w-4 mr-1" />
                                                            Report
                                                        </button>
                                                    ) : (
                                                        <span className="text-gray-400 text-xs">Report pending</span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </main>

            {showBookingModal && account && (
                <B2BBookingModal
                    accountId={account.id}
                    onClose={() => setShowBookingModal(false)}
                    onSuccess={() => {
                        loadData();
                        alert('Booking created successfully! It will appear in your orders once processed by the lab.');
                    }}
                />
            )}
        </div>
    );
};

export default B2BPortal;
