import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Home, FileText, Users, BarChart3, Menu } from 'lucide-react';
import { isNative } from '../../utils/platformHelper';

interface NavItem {
  path: string;
  icon: React.ElementType;
  label: string;
  badge?: number;
}

const navigationItems: NavItem[] = [
  { path: '/', icon: Home, label: 'Home' },
  { path: '/orders', icon: FileText, label: 'Orders' },
  { path: '/patients', icon: Users, label: 'Patients' },
  { path: '/reports', icon: BarChart3, label: 'Reports' },
  { path: '/settings', icon: Menu, label: 'More' },
];

/**
 * Mobile Bottom Navigation - Android Only
 * Replaces sidebar navigation on native Android app
 */
export const MobileBottomNav: React.FC = () => {
  const location = useLocation();
  
  // Only render on native Android
  if (!isNative()) return null;

  return (
    <nav className="fixed bottom-0 left-0 right-0 border-t border-gray-200 bg-white/95 backdrop-blur safe-area-bottom z-50">
      <div className="grid grid-cols-5 items-stretch min-h-[64px] px-1 pb-[max(env(safe-area-inset-bottom),4px)] pt-1">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path || 
                          (item.path !== '/' && location.pathname.startsWith(item.path));
          
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={`relative flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-xl px-1 py-1 text-center transition-colors ${
                isActive 
                  ? 'text-blue-600' 
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <div className="relative">
                <Icon className="h-5 w-5 shrink-0" />
                {item.badge && item.badge > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center">
                    {item.badge > 9 ? '9+' : item.badge}
                  </span>
                )}
              </div>
              <span className={`max-w-full truncate px-0.5 text-[11px] leading-tight ${isActive ? 'font-semibold' : 'font-normal'}`}>
                {item.label}
              </span>
              {isActive && (
                <div className="absolute left-3 right-3 top-0 h-0.5 rounded-full bg-blue-600" />
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
};

export default MobileBottomNav;
