import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  TestTube,
  ClipboardList,
  FileText,
  Receipt,
  DollarSign,
  Brain,
  Settings,
  X,
  CheckCircle2,
  Workflow,
  UserCheck,
  Building,
  MessageCircle,
  MessageSquare,
  Palette,
  Image,
  ChevronLeft,
  ChevronRight,
  Building2,
  FileStack,
  ListOrdered,
  TrendingUp,
  Truck,
  BarChart3,
  Shield,
  Package,
  Star,
} from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  isMobile?: boolean;
  isCollapsed: boolean;
  setIsCollapsed: (value: boolean) => void;
}

const navigation = [
  // Core Laboratory Workflow - Most Used Daily
  { name: 'Dashboard', href: '/', icon: LayoutDashboard, category: 'core' },
  { name: 'Orders', href: '/orders', icon: ClipboardList, category: 'core' },
  { name: 'Results Entry', href: '/results2', icon: Brain, category: 'core' },
  { name: 'Results Verification', href: '/results-verification', icon: CheckCircle2, category: 'core' },
  { name: 'Reports', href: '/reports', icon: FileText, category: 'core' },

  // Patient & Sample Management
  { name: 'Patients', href: '/patients', icon: Users, category: 'management' },
  { name: 'Tests & Samples', href: '/tests', icon: TestTube, category: 'management' },

  // Business & Administrative
  { name: 'Billing', href: '/billing', icon: Receipt, category: 'business' },
  { name: 'Cash Reconciliation', href: '/cash-reconciliation', icon: DollarSign, category: 'business' },
  { name: 'Financial Reports', href: '/financial-reports', icon: TrendingUp, category: 'business' },
  { name: 'Analytics', href: '/analytics', icon: BarChart3, category: 'business' },

  // Communication
  { name: 'WhatsApp Integration', href: '/whatsapp', icon: MessageCircle, category: 'communication' },
  { name: 'WhatsApp Templates', href: '/whatsapp/templates', icon: MessageSquare, category: 'communication' },

  // Master Data Management
  { name: 'Doctor Master', href: '/masters/doctors', icon: UserCheck, category: 'masters' },
  { name: 'Account Master', href: '/masters/accounts', icon: Building, category: 'masters' },
  { name: 'Location Master', href: '/masters/locations', icon: Building, category: 'masters' },
  { name: 'Outsourced Labs', href: '/settings/outsourced-labs', icon: Building2, category: 'masters' },

  // Outsourced Reports
  { name: 'Outsourced Reports', href: '/outsourced-reports', icon: FileStack, category: 'outsourced' },
  { name: 'Outsourced Queue', href: '/outsourced-queue', icon: ListOrdered, category: 'outsourced' },

  // Sample Transit (Intra-Lab)
  { name: 'Sample Transit', href: '/sample-transit', icon: Truck, category: 'transit' },

  // Quality Control - AI-First QC Module
  { name: 'Quality Control', href: '/quality-control', icon: Shield, category: 'qc' },

  // Inventory Management
  { name: 'Inventory', href: '/inventory', icon: Package, category: 'inventory' },

  // AI Workflow Management
  { name: 'Workflow Management', href: '/workflows', icon: Workflow, category: 'workflows' },

  // Advanced Tools
  { name: 'Template Studio (CKE)', href: '/template-studio-cke', icon: Palette, category: 'tools' },
  { name: 'Report Sections', href: '/settings/report-sections', icon: FileText, category: 'tools' },
  { name: 'User Management', href: '/user-management', icon: Users, category: 'tools' },
  { name: 'Branding & Signatures', href: '/settings/branding', icon: Image, category: 'tools' },
  { name: 'Settings', href: '/settings', icon: Settings, category: 'tools' },
];

type CategoryKey = 'core' | 'management' | 'business' | 'communication' | 'qc' | 'inventory' | 'workflows' | 'masters' | 'outsourced' | 'transit' | 'tools';

const categoryConfig: Record<CategoryKey, {
  activeBg: string; activeText: string; activeBorder: string;
  hoverBg: string; hoverText: string; hoverBorder: string; activeIcon: string;
}> = {
  core:          { activeBg: 'bg-blue-50',    activeText: 'text-blue-700',    activeBorder: 'border-l-blue-700',    hoverBg: 'hover:bg-blue-50',    hoverText: 'hover:text-blue-700',    hoverBorder: 'hover:border-l-blue-300',    activeIcon: 'text-blue-700'    },
  management:    { activeBg: 'bg-green-50',   activeText: 'text-green-700',   activeBorder: 'border-l-green-700',   hoverBg: 'hover:bg-green-50',   hoverText: 'hover:text-green-700',   hoverBorder: 'hover:border-l-green-300',   activeIcon: 'text-green-700'   },
  business:      { activeBg: 'bg-purple-50',  activeText: 'text-purple-700',  activeBorder: 'border-l-purple-700',  hoverBg: 'hover:bg-purple-50',  hoverText: 'hover:text-purple-700',  hoverBorder: 'hover:border-l-purple-300',  activeIcon: 'text-purple-700'  },
  communication: { activeBg: 'bg-sky-50',     activeText: 'text-sky-700',     activeBorder: 'border-l-sky-700',     hoverBg: 'hover:bg-sky-50',     hoverText: 'hover:text-sky-700',     hoverBorder: 'hover:border-l-sky-300',     activeIcon: 'text-sky-700'     },
  qc:            { activeBg: 'bg-emerald-50', activeText: 'text-emerald-700', activeBorder: 'border-l-emerald-700', hoverBg: 'hover:bg-emerald-50', hoverText: 'hover:text-emerald-700', hoverBorder: 'hover:border-l-emerald-300', activeIcon: 'text-emerald-700' },
  inventory:     { activeBg: 'bg-cyan-50',    activeText: 'text-cyan-700',    activeBorder: 'border-l-cyan-700',    hoverBg: 'hover:bg-cyan-50',    hoverText: 'hover:text-cyan-700',    hoverBorder: 'hover:border-l-cyan-300',    activeIcon: 'text-cyan-700'    },
  workflows:     { activeBg: 'bg-indigo-50',  activeText: 'text-indigo-700',  activeBorder: 'border-l-indigo-700',  hoverBg: 'hover:bg-indigo-50',  hoverText: 'hover:text-indigo-700',  hoverBorder: 'hover:border-l-indigo-300',  activeIcon: 'text-indigo-700'  },
  masters:       { activeBg: 'bg-orange-50',  activeText: 'text-orange-700',  activeBorder: 'border-l-orange-700',  hoverBg: 'hover:bg-orange-50',  hoverText: 'hover:text-orange-700',  hoverBorder: 'hover:border-l-orange-300',  activeIcon: 'text-orange-700'  },
  outsourced:    { activeBg: 'bg-teal-50',    activeText: 'text-teal-700',    activeBorder: 'border-l-teal-700',    hoverBg: 'hover:bg-teal-50',    hoverText: 'hover:text-teal-700',    hoverBorder: 'hover:border-l-teal-300',    activeIcon: 'text-teal-700'    },
  transit:       { activeBg: 'bg-amber-50',   activeText: 'text-amber-700',   activeBorder: 'border-l-amber-700',   hoverBg: 'hover:bg-amber-50',   hoverText: 'hover:text-amber-700',   hoverBorder: 'hover:border-l-amber-300',   activeIcon: 'text-amber-700'   },
  tools:         { activeBg: 'bg-gray-50',    activeText: 'text-gray-700',    activeBorder: 'border-l-gray-700',    hoverBg: 'hover:bg-gray-50',    hoverText: 'hover:text-gray-700',    hoverBorder: 'hover:border-l-gray-300',    activeIcon: 'text-gray-700'    },
};

const sections: { label: string; emoji: string; category: CategoryKey }[] = [
  { label: 'Daily Operations',   emoji: '🔬', category: 'core' },
  { label: 'Patient Management', emoji: '👥', category: 'management' },
  { label: 'Business & Reports', emoji: '💼', category: 'business' },
  { label: 'Communication',      emoji: '💬', category: 'communication' },
  { label: 'Quality Control',    emoji: '🛡️', category: 'qc' },
  { label: 'Inventory',          emoji: '📦', category: 'inventory' },
  { label: 'AI Workflows',       emoji: '🤖', category: 'workflows' },
  { label: 'Master Data',        emoji: '📊', category: 'masters' },
  { label: 'Outsourced Labs',    emoji: '🏥', category: 'outsourced' },
  { label: 'Sample Transit',     emoji: '🚚', category: 'transit' },
  { label: 'Tools & Settings',   emoji: '🛠️', category: 'tools' },
];

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onToggle, isMobile = false, isCollapsed, setIsCollapsed }) => {
  const location = useLocation();

  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('sidebar_favorites') || '[]');
    } catch {
      return [];
    }
  });

  const toggleFavorite = (href: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setFavorites(prev => {
      const next = prev.includes(href) ? prev.filter(f => f !== href) : [...prev, href];
      localStorage.setItem('sidebar_favorites', JSON.stringify(next));
      return next;
    });
  };

  const handleNavClick = () => {
    if (isMobile && isOpen) onToggle();
  };

  const renderNavItem = (item: typeof navigation[0], keyPrefix: string) => {
    const config = categoryConfig[item.category as CategoryKey];
    const isActive = location.pathname === item.href;
    const isFav = favorites.includes(item.href);

    return (
      <div key={`${keyPrefix}-${item.href}`} className="relative group">
        <Link
          to={item.href}
          title={isCollapsed ? item.name : ''}
          className={`
            flex items-center rounded-lg text-sm font-medium transition-colors duration-200 mb-1
            border-l-4
            ${isCollapsed ? 'justify-center px-2 py-3' : 'px-4 py-3 pr-8'}
            ${isActive
              ? `${config.activeBg} ${config.activeText} ${config.activeBorder}`
              : `text-gray-600 ${config.hoverBg} ${config.hoverText} border-l-transparent ${config.hoverBorder}`
            }
          `}
          onClick={handleNavClick}
        >
          <item.icon className={`h-5 w-5 flex-shrink-0 ${isCollapsed ? '' : 'mr-3'} ${isActive ? config.activeIcon : 'text-gray-400'}`} />
          {!isCollapsed && <span className="truncate">{item.name}</span>}
        </Link>

        {!isCollapsed && (
          <button
            onClick={(e) => toggleFavorite(item.href, e)}
            className={`
              absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded transition-all duration-150
              ${isFav
                ? 'opacity-100 text-yellow-500'
                : 'opacity-0 group-hover:opacity-100 text-gray-300 hover:text-yellow-400'
              }
            `}
            title={isFav ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star className={`h-3.5 w-3.5 ${isFav ? 'fill-yellow-400' : ''}`} />
          </button>
        )}
      </div>
    );
  };

  const favoriteItems = navigation.filter(item => favorites.includes(item.href));

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-75 z-20 lg:hidden" onClick={onToggle} />
      )}

      {/* Sidebar */}
      <div className={`
        fixed inset-y-0 left-0 z-30 bg-white shadow-lg transform transition-all duration-300 ease-in-out flex flex-col overflow-hidden
        lg:translate-x-0
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        ${isCollapsed ? 'w-20' : 'w-64'}
      `}>
        {/* Header */}
        <div className={`flex-none flex items-center justify-between h-16 bg-blue-600 ${isCollapsed ? 'px-2 justify-center' : 'px-6'}`}>
          {!isCollapsed && (
            <div className="flex items-center">
              <img
                src="https://ik.imagekit.io/18tsendxqy/website/Screenshot%202025-12-15%20133819.png?updatedAt=1765786115578"
                alt="AnPro LIMS"
                className="h-8 w-8 object-contain rounded"
              />
              <span className="ml-2 text-xl font-bold text-white">AnPro LIMS</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="hidden lg:block text-white hover:text-gray-200 transition-colors"
              title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
            >
              {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
            </button>
            <button onClick={onToggle} className="lg:hidden text-white hover:text-gray-200">
              <X className="h-6 w-6" />
            </button>
          </div>
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto">
          <nav className="mt-4 px-4 pb-4">

            {/* Favorites section */}
            {favoriteItems.length > 0 && (
              <div className="mb-4">
                {!isCollapsed && (
                  <h3 className="px-4 text-xs font-semibold text-yellow-600 uppercase tracking-wider mb-2">
                    ⭐ Favorites
                  </h3>
                )}
                {favoriteItems.map(item => renderNavItem(item, 'fav'))}
                <div className="border-b border-gray-200 mt-3 mb-3" />
              </div>
            )}

            {/* Regular sections */}
            {sections.map(section => (
              <div key={section.category} className="mb-5">
                {!isCollapsed && (
                  <h3 className="px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    {section.emoji} {section.label}
                  </h3>
                )}
                {navigation
                  .filter(item => item.category === section.category)
                  .map(item => renderNavItem(item, section.category))}
              </div>
            ))}

          </nav>
        </div>
      </div>
    </>
  );
};

export default Sidebar;
