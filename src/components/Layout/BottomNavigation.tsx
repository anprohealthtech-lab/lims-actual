import React from 'react';
import { LayoutDashboard, FileText, GitBranch, FileBarChart, MessageSquare } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';

const BottomNavigation: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();

    const navItems = [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/' },
        { id: 'orders', label: 'Orders', icon: FileText, path: '/orders' },
        { id: 'workflow', label: 'Workflow', icon: GitBranch, path: '/workflow-management' },
        { id: 'reports', label: 'Reports', icon: FileBarChart, path: '/reports' },
        { id: 'whatsapp', label: 'WhatsApp', icon: MessageSquare, path: '/whatsapp' },
    ];

    return (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 pb-[env(safe-area-inset-bottom)] z-50">
            <div className="flex justify-around items-center h-16">
                {navItems.map((item) => {
                    const isActive = location.pathname === item.path;
                    return (
                        <button
                            key={item.id}
                            onClick={() => navigate(item.path)}
                            className={`flex flex-col items-center justify-center w-full h-full space-y-1 ${isActive ? 'text-blue-600' : 'text-gray-500'
                                }`}
                        >
                            <item.icon className={`h-6 w-6 ${isActive ? 'fill-current' : ''}`} />
                            <span className="text-[10px] font-medium">{item.label}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default BottomNavigation;
