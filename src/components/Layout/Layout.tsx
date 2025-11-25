import React, { useState } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import BottomNavigation from './BottomNavigation';
import MobileBottomNav from './MobileBottomNav';
import { isNative } from '../../utils/platformHelper';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const isMobile = isNative();

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
        <Header onMenuClick={() => setSidebarOpen(!sidebarOpen)} />

        {/* Main content - Add bottom padding for Android nav */}
        <main className={`flex-1 p-4 md:p-6 safe-area-x ${isMobile ? 'pb-20' : 'safe-area-bottom mb-16 lg:mb-0'}`}>
          {children}
        </main>

        {/* Bottom Navigation - Choose based on platform */}
        {isMobile ? (
          <MobileBottomNav />
        ) : (
          <BottomNavigation />
        )}
      </div>
    </div>
  );
};

export default Layout;