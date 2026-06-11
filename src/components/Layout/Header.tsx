import React from 'react';
import { Menu, LogOut, ChevronUp, ChevronDown, Palette, Building2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { THEME_PRESETS, useTheme } from '../../contexts/ThemeContext';
import { NotificationBadge } from '../WhatsApp/NotificationBadge';
import { format } from 'date-fns';

interface HeaderProps {
  onMenuClick: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

const Header: React.FC<HeaderProps> = ({ onMenuClick, isCollapsed = false, onToggleCollapse }) => {
  const { user, signOut, labName, labLogo, labActiveUpto } = useAuth();
  const { theme, setTheme } = useTheme();

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <>
      {/* Toggle Button - Always visible */}
      {onToggleCollapse && (
        <button
          onClick={onToggleCollapse}
          className="fixed top-2 right-2 z-[100] bg-white shadow-md hover:shadow-lg border border-gray-300 rounded-md p-1.5 transition-all duration-200 hover:bg-gray-50"
          title={isCollapsed ? 'Show Header' : 'Hide Header'}
        >
          {isCollapsed ? (
            <ChevronDown className="h-4 w-4 text-gray-600" />
          ) : (
            <ChevronUp className="h-4 w-4 text-gray-600" />
          )}
        </button>
      )}

      {/* Header - Conditionally rendered */}
      {!isCollapsed && (
        <header className="bg-white shadow-sm border-b border-gray-200 safe-area-top safe-area-x relative z-50">
      <div className="flex items-center justify-between h-14 md:h-16 px-4 md:px-6">
        <div className="flex items-center">
          <button
            onClick={onMenuClick}
            className="p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 min-w-[44px] min-h-[44px] lg:hidden"
          >
            <Menu className="h-6 w-6" />
          </button>

          {/* Lab Info Section */}
          <div className="hidden md:flex items-center ml-4 gap-3">
            {labLogo ? (
              <img
                src={labLogo}
                alt={labName || 'Lab Logo'}
                className="h-10 w-auto max-w-[120px] object-contain rounded border border-gray-200 bg-white"
              />
            ) : (
              <div className="h-10 w-10 rounded-lg bg-primary-100 flex items-center justify-center">
                <Building2 className="h-5 w-5 text-primary-600" />
              </div>
            )}
            <div className="min-w-0">
              <div className="text-base font-semibold text-gray-900">
                {labName || 'Laboratory'}
              </div>
              {labActiveUpto && (
                <div className="text-xs text-gray-500">
                  Active upto {format(labActiveUpto, 'dd MMM yyyy')}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2 md:space-x-4">
          {/* WhatsApp Failed Notification Badge */}
          <NotificationBadge />

          <div className="flex items-center space-x-2 md:space-x-3 relative group">
            <div className="text-right hidden sm:block">
              <div className="text-sm font-medium text-gray-900">
                {user?.user_metadata?.full_name || user?.email}
              </div>
              <div className="text-xs text-gray-500">
                {user?.user_metadata?.role || 'User'}
              </div>
            </div>
            <div className="h-10 w-10 bg-primary-500 rounded-full flex items-center justify-center">
              <span className="text-white text-sm font-medium">
                {user?.user_metadata?.full_name?.charAt(0) || user?.email?.charAt(0) || 'U'}
              </span>
            </div>

            {/* Dropdown Menu */}
            <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-md shadow-lg border border-gray-200 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
              <div className="py-1">
                <div className="px-4 py-2 border-b border-gray-100">
                  <div className="text-sm font-medium text-gray-900">
                    {user?.user_metadata?.full_name || 'User'}
                  </div>
                  <div className="text-xs text-gray-500">{user?.email}</div>
                </div>
                <div className="px-4 py-3 border-b border-gray-100">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <Palette className="h-3.5 w-3.5" />
                    Color theme
                  </div>
                  <div className="flex items-center gap-2">
                    {THEME_PRESETS.map((preset) => (
                      <button
                        key={preset.name}
                        type="button"
                        onClick={() => setTheme(preset.name)}
                        className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${
                          theme === preset.name
                            ? 'border-gray-900 ring-2 ring-gray-300'
                            : 'border-white'
                        }`}
                        style={{ backgroundColor: preset.swatch }}
                        title={`${preset.label} theme`}
                        aria-label={`Use ${preset.label} theme`}
                        aria-pressed={theme === preset.name}
                      />
                    ))}
                  </div>
                </div>
                <button
                  onClick={handleSignOut}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center"
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign Out
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
      )}
    </>
  );
};

export default Header;
