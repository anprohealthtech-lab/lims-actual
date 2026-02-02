import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
    Users, Settings, Calculator, DollarSign,
    ArrowRight, Stethoscope, AlertCircle
} from 'lucide-react';
import { supabase, database } from '../utils/supabase';

interface DashboardStats {
    totalDoctors: number;
    doctorsWithSharing: number;
    totalCommissionThisMonth: number;
    pendingCalculation: number;
}

/**
 * Doctor Sharing Portal Dashboard
 * Overview of doctor sharing configuration and commission summary
 */
const DoctorSharingDashboard: React.FC = () => {
    const [stats, setStats] = useState<DashboardStats>({
        totalDoctors: 0,
        doctorsWithSharing: 0,
        totalCommissionThisMonth: 0,
        pendingCalculation: 0
    });
    const [recentDoctors, setRecentDoctors] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadDashboardData();
    }, []);

    const loadDashboardData = async () => {
        try {
            const labId = await database.getCurrentUserLabId();
            if (!labId) return;

            // Get total doctors
            const { data: doctors } = await supabase
                .from('doctors')
                .select('id, name, default_discount_percent, created_at')
                .eq('lab_id', labId)
                .eq('is_active', true)
                .order('created_at', { ascending: false })
                .limit(5);

            // Get doctors with sharing settings
            const { data: sharingSettings } = await supabase
                .from('doctor_sharing')
                .select('id, doctor_id')
                .eq('lab_id', labId)
                .eq('is_active', true);

            // Get this month's invoices with doctors for commission estimate
            const startOfMonth = new Date();
            startOfMonth.setDate(1);
            startOfMonth.setHours(0, 0, 0, 0);

            const { data: invoices } = await supabase
                .from('invoices')
                .select('id, total, referring_doctor_id')
                .eq('lab_id', labId)
                .not('referring_doctor_id', 'is', null)
                .gte('created_at', startOfMonth.toISOString());

            // Calculate total doctors count
            const { count: totalDoctorsCount } = await supabase
                .from('doctors')
                .select('*', { count: 'exact', head: true })
                .eq('lab_id', labId)
                .eq('is_active', true);

            setStats({
                totalDoctors: totalDoctorsCount || 0,
                doctorsWithSharing: sharingSettings?.length || 0,
                totalCommissionThisMonth: 0, // Will be calculated in commission report
                pendingCalculation: invoices?.length || 0
            });

            setRecentDoctors(doctors || []);
        } catch (err) {
            console.error('Error loading dashboard data:', err);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Page Header */}
            <div>
                <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
                <p className="text-gray-600 mt-1">Overview of doctor sharing and commissions</p>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-500">Total Doctors</p>
                            <p className="text-2xl font-bold text-gray-900 mt-1">{stats.totalDoctors}</p>
                        </div>
                        <div className="p-3 bg-blue-50 rounded-lg">
                            <Users className="h-6 w-6 text-blue-600" />
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-500">With Sharing Setup</p>
                            <p className="text-2xl font-bold text-gray-900 mt-1">{stats.doctorsWithSharing}</p>
                        </div>
                        <div className="p-3 bg-emerald-50 rounded-lg">
                            <Settings className="h-6 w-6 text-emerald-600" />
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-500">Pending Calculation</p>
                            <p className="text-2xl font-bold text-gray-900 mt-1">{stats.pendingCalculation}</p>
                        </div>
                        <div className="p-3 bg-amber-50 rounded-lg">
                            <Calculator className="h-6 w-6 text-amber-600" />
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-500">This Month's Share</p>
                            <p className="text-2xl font-bold text-gray-900 mt-1">—</p>
                            <p className="text-xs text-gray-400">Run report to calculate</p>
                        </div>
                        <div className="p-3 bg-purple-50 rounded-lg">
                            <DollarSign className="h-6 w-6 text-purple-600" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Alert for unconfigured doctors */}
            {stats.totalDoctors > stats.doctorsWithSharing && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
                    <div>
                        <p className="font-medium text-amber-800">
                            {stats.totalDoctors - stats.doctorsWithSharing} doctors without sharing settings
                        </p>
                        <p className="text-sm text-amber-700 mt-1">
                            Configure sharing percentages for these doctors to calculate their commissions.
                        </p>
                        <Link 
                            to="/doctor-sharing/settings"
                            className="inline-flex items-center gap-1 text-sm font-medium text-amber-800 hover:text-amber-900 mt-2"
                        >
                            Configure Settings <ArrowRight className="h-4 w-4" />
                        </Link>
                    </div>
                </div>
            )}

            {/* Quick Actions */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Link
                    to="/doctor-sharing/settings"
                    className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md hover:border-emerald-200 transition-all group"
                >
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-emerald-100 rounded-lg group-hover:bg-emerald-200 transition-colors">
                            <Settings className="h-6 w-6 text-emerald-700" />
                        </div>
                        <div className="flex-1">
                            <h3 className="font-semibold text-gray-900">Sharing Settings</h3>
                            <p className="text-sm text-gray-500 mt-1">Configure per-doctor sharing percentages and calculation options</p>
                        </div>
                        <ArrowRight className="h-5 w-5 text-gray-400 group-hover:text-emerald-600 transition-colors" />
                    </div>
                </Link>

                <Link
                    to="/doctor-sharing/commission"
                    className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md hover:border-emerald-200 transition-all group"
                >
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-purple-100 rounded-lg group-hover:bg-purple-200 transition-colors">
                            <Calculator className="h-6 w-6 text-purple-700" />
                        </div>
                        <div className="flex-1">
                            <h3 className="font-semibold text-gray-900">Commission Report</h3>
                            <p className="text-sm text-gray-500 mt-1">Calculate and view doctor commissions with detailed breakdown</p>
                        </div>
                        <ArrowRight className="h-5 w-5 text-gray-400 group-hover:text-purple-600 transition-colors" />
                    </div>
                </Link>
            </div>

            {/* Recent Doctors */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                <div className="px-6 py-4 border-b border-gray-100">
                    <h2 className="font-semibold text-gray-900">Recent Doctors</h2>
                </div>
                <div className="divide-y divide-gray-100">
                    {recentDoctors.length > 0 ? (
                        recentDoctors.map((doctor) => (
                            <div key={doctor.id} className="px-6 py-4 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center">
                                        <Stethoscope className="h-5 w-5 text-emerald-600" />
                                    </div>
                                    <div>
                                        <p className="font-medium text-gray-900">{doctor.name}</p>
                                        <p className="text-sm text-gray-500">
                                            Default Discount: {doctor.default_discount_percent || 0}%
                                        </p>
                                    </div>
                                </div>
                                <Link
                                    to={`/doctor-sharing/settings?doctor=${doctor.id}`}
                                    className="text-sm text-emerald-600 hover:text-emerald-700 font-medium"
                                >
                                    Configure →
                                </Link>
                            </div>
                        ))
                    ) : (
                        <div className="px-6 py-8 text-center text-gray-500">
                            No doctors found. Add doctors in the main app first.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DoctorSharingDashboard;
