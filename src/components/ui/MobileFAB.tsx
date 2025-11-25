import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { isNative } from '../../utils/platformHelper';

interface FABAction {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  color?: string;
}

interface MobileFABProps {
  icon?: React.ElementType;
  onClick?: () => void;
  actions?: FABAction[];
  label?: string;
  color?: string;
}

/**
 * Floating Action Button - Android Only
 * Shows a primary action button fixed at bottom-right
 * Can expand to show multiple actions (Speed Dial pattern)
 */
export const MobileFAB: React.FC<MobileFABProps> = ({
  icon: Icon = Plus,
  onClick,
  actions,
  label,
  color = 'bg-blue-600 hover:bg-blue-700'
}) => {
  const [expanded, setExpanded] = useState(false);
  
  // Only render on native Android
  if (!isNative()) return null;

  const handleMainClick = () => {
    if (actions && actions.length > 0) {
      setExpanded(!expanded);
    } else if (onClick) {
      onClick();
    }
  };

  const handleActionClick = (action: FABAction) => {
    action.onClick();
    setExpanded(false);
  };

  return (
    <>
      {/* Backdrop */}
      {expanded && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-30 z-40 transition-opacity"
          onClick={() => setExpanded(false)}
        />
      )}

      {/* Speed Dial Actions */}
      {expanded && actions && (
        <div className="fixed bottom-24 right-4 z-50 space-y-3">
          {actions.map((action, index) => {
            const ActionIcon = action.icon;
            return (
              <div 
                key={index}
                className="flex items-center justify-end space-x-2 animate-in slide-in-from-bottom"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <span className="bg-gray-900 text-white text-sm px-3 py-1.5 rounded-lg shadow-lg whitespace-nowrap">
                  {action.label}
                </span>
                <button
                  onClick={() => handleActionClick(action)}
                  className={`w-12 h-12 rounded-full ${action.color || 'bg-gray-700 hover:bg-gray-800'} text-white shadow-lg flex items-center justify-center transition-transform hover:scale-110`}
                >
                  <ActionIcon className="h-5 w-5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Main FAB */}
      <button
        onClick={handleMainClick}
        className={`fixed bottom-20 right-4 w-12 h-12 rounded-full ${color} text-white shadow-lg z-50 flex items-center justify-center transition-all duration-300 ${
          expanded ? 'rotate-45' : 'rotate-0'
        } hover:scale-110 active:scale-95`}
        aria-label={label || 'Main action'}
      >
        {expanded && actions ? (
          <X className="h-5 w-5" />
        ) : (
          <Icon className="h-5 w-5" />
        )}
      </button>

      {/* Optional Label */}
      {label && !expanded && (
        <div className="fixed bottom-20 right-20 bg-gray-900 text-white text-xs px-2 py-1 rounded shadow-lg pointer-events-none z-50">
          {label}
        </div>
      )}
    </>
  );
};

export default MobileFAB;
