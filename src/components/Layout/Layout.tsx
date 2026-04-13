import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import BottomNavigation from './BottomNavigation';
import MobileBottomNav from './MobileBottomNav';
import { isNative } from '../../utils/platformHelper';
import TATFloater from '../Orders/TATFloater';
import { useAuth } from '../../contexts/AuthContext';
import { Clock, X } from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const isMobile = isNative();
  const navigate = useNavigate();
  const { labStatus, trialDaysRemaining } = useAuth();

  // Show trial banner when ≤ 3 days remain (or on last day)
  const showTrialBanner =
    !bannerDismissed &&
    labStatus === 'trial' &&
    trialDaysRemaining != null &&
    trialDaysRemaining <= 3;

  const bannerColor =
    (trialDaysRemaining ?? 3) <= 1
      ? 'bg-red-600'
      : 'bg-amber-500';

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar - Show on all platforms, control with isOpen */}
      <Sidebar
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        isMobile={isMobile}
        isCollapsed={isCollapsed}
        setIsCollapsed={setIsCollapsed}
      />

      <div className={`flex-1 flex flex-col transition-all duration-300 ease-in-out ${isCollapsed ? 'lg:pl-20' : 'lg:pl-64'}`}>
        {/* Header - Show on both web and mobile */}
        <Header 
          onMenuClick={() => setSidebarOpen(!sidebarOpen)} 
          isCollapsed={headerCollapsed}
          onToggleCollapse={() => setHeaderCollapsed(!headerCollapsed)}
        />

        {/* Trial Expiry Banner */}
        {showTrialBanner && (
          <div className={`${bannerColor} text-white px-4 py-2 flex items-center justify-between gap-3 text-sm`}>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Clock className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">
                {(trialDaysRemaining ?? 0) <= 0
                  ? 'Your free trial expires today!'
                  : `Free trial ends in ${trialDaysRemaining} day${trialDaysRemaining === 1 ? '' : 's'}!`}
                {' '}
                <button
                  onClick={() => navigate('/subscription')}
                  className="underline font-semibold hover:no-underline"
                >
                  Subscribe now
                </button>
              </span>
            </div>
            <button
              onClick={() => setBannerDismissed(true)}
              className="flex-shrink-0 hover:opacity-75 transition-opacity"
              aria-label="Dismiss banner"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Main content - Add bottom padding for Android nav */}
        <main className={`flex-1 min-w-0 p-4 md:p-6 safe-area-x ${isMobile ? 'pb-24' : 'safe-area-bottom mb-16 lg:mb-0'}`}>
          {children}
        </main>

        {/* Bottom Navigation - Choose based on platform */}
        {isMobile ? (
          <MobileBottomNav />
        ) : (
          <BottomNavigation />
        )}
      </div>

      {/* TAT Floater - Shows TAT breach alerts */}
      <TATFloater className={isMobile ? 'bottom-20' : ''} />
    </div>
  );
};

export default Layout;
