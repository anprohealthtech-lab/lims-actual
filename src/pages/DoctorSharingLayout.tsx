import React, { useState, useEffect, ReactNode } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { 
    Stethoscope, LogOut, Settings, Calculator,
    ChevronRight, Shield, Menu, X, Home
} from 'lucide-react';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';

interface DoctorSharingLayoutProps {
    children: ReactNode;
}

/**
 * Doctor Sharing Portal Layout
 * Wrapper component for the doctor sharing portal with navigation
 */
const DoctorSharingLayout: React.FC<DoctorSharingLayoutProps> = ({ children }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const { labName } = useAuth();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);
    const [loading, setLoading] = useState(true);

    // Verify admin access
    useEffect(() => {
        const verifyAdmin = async () => {
            try {
                const { data: { user: authUser } } = await supabase.auth.getUser();
                if (!authUser) {
                    navigate('/doctor-sharing/login');
                    return;
                }

                const { data: userData } = await supabase
                    .from('users')
                    .select('role')
                    .eq('id', authUser.id)
                    .single();

                // Case-insensitive role check (handles 'admin', 'Admin', 'ADMIN')
                if (userData?.role?.toLowerCase() !== 'admin') {
                    navigate('/doctor-sharing/login');
                    return;
                }

                setIsAdmin(true);
            } catch (err) {
                console.error('Admin verification error:', err);
                navigate('/doctor-sharing/login');
            } finally {
                setLoading(false);
            }
        };
        verifyAdmin();
    }, [navigate]);

    const handleLogout = async () => {
        await supabase.auth.signOut();
        navigate('/doctor-sharing/login');
    };

    const navItems = [
        { path: '/doctor-sharing/dashboard', label: 'Dashboard', icon: Home },
        { path: '/doctor-sharing/settings', label: 'Sharing Settings', icon: Settings },
        { path: '/doctor-sharing/commission', label: 'Commission Report', icon: Calculator },
    ];

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
            </div>
        );
    }

    if (!isAdmin) {
        return null;
    }

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Top Header */}
            <header className="bg-emerald-700 text-white shadow-lg">
                <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setSidebarOpen(!sidebarOpen)}
                            className="lg:hidden p-2 rounded-lg hover:bg-emerald-600"
                        >
                            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                        </button>
                        <div className="flex items-center gap-2">
                            <Stethoscope className="h-6 w-6" />
                            <span className="font-bold text-lg">Doctor Sharing Portal</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="hidden sm:flex items-center gap-2 text-emerald-100">
                            <Shield className="h-4 w-4" />
                            <span className="text-sm">{labName || 'Lab Admin'}</span>
                        </div>
                        <button
                            onClick={handleLogout}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-emerald-600 transition-colors"
                        >
                            <LogOut className="h-4 w-4" />
                            <span className="hidden sm:inline">Logout</span>
                        </button>
                    </div>
                </div>
            </header>

            <div className="flex">
                {/* Sidebar */}
                <aside className={`
                    fixed lg:static inset-y-0 left-0 z-40 w-64 bg-white shadow-lg transform transition-transform duration-200
                    ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
                    mt-[60px] lg:mt-0
                `}>
                    <nav className="p-4 space-y-1">
                        {navItems.map((item) => {
                            const Icon = item.icon;
                            const isActive = location.pathname === item.path;
                            return (
                                <Link
                                    key={item.path}
                                    to={item.path}
                                    onClick={() => setSidebarOpen(false)}
                                    className={`
                                        flex items-center gap-3 px-4 py-3 rounded-lg transition-colors
                                        ${isActive 
                                            ? 'bg-emerald-50 text-emerald-700 font-medium' 
                                            : 'text-gray-600 hover:bg-gray-50'
                                        }
                                    `}
                                >
                                    <Icon className={`h-5 w-5 ${isActive ? 'text-emerald-600' : 'text-gray-400'}`} />
                                    <span>{item.label}</span>
                                    {isActive && <ChevronRight className="h-4 w-4 ml-auto text-emerald-400" />}
                                </Link>
                            );
                        })}
                    </nav>

                    {/* Back to Main App */}
                    <div className="absolute bottom-4 left-4 right-4">
                        <Link
                            to="/"
                            className="flex items-center gap-2 px-4 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg"
                        >
                            <ChevronRight className="h-4 w-4 rotate-180" />
                            Back to Main App
                        </Link>
                    </div>
                </aside>

                {/* Overlay for mobile */}
                {sidebarOpen && (
                    <div 
                        className="fixed inset-0 bg-black/20 z-30 lg:hidden"
                        onClick={() => setSidebarOpen(false)}
                    />
                )}

                {/* Main Content */}
                <main className="flex-1 p-4 lg:p-6 min-h-[calc(100vh-60px)]">
                    {children}
                </main>
            </div>
        </div>
    );
};

export default DoctorSharingLayout;
