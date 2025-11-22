import React from 'react';
import { isNative } from '../../utils/platformHelper';

interface MobileContainerProps {
  children: React.ReactNode;
  className?: string;
  useSafeArea?: boolean;
  fullBleed?: boolean;
}

/**
 * Mobile-optimized container with proper edge margins and safe area support
 */
export const MobileContainer: React.FC<MobileContainerProps> = ({
  children,
  className = '',
  useSafeArea = true,
  fullBleed = false,
}) => {
  const safeAreaClass = useSafeArea && isNative() ? 'safe-area-x' : '';
  const mobileEdgeClass = !fullBleed ? 'mobile-edge-padding' : '';
  
  return (
    <div className={`${safeAreaClass} ${mobileEdgeClass} ${className}`}>
      {children}
    </div>
  );
};

interface MobileCardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

/**
 * Mobile-optimized card with proper margins
 */
export const MobileCard: React.FC<MobileCardProps> = ({
  children,
  className = '',
  onClick,
}) => {
  return (
    <div
      className={`bg-white rounded-lg shadow-sm card-mobile ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  );
};

interface MobilePageProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  showHeader?: boolean;
}

/**
 * Full mobile page wrapper with safe areas
 */
export const MobilePage: React.FC<MobilePageProps> = ({
  children,
  className = '',
  title,
  showHeader = true,
}) => {
  return (
    <div className={`min-h-screen flex flex-col ${className}`}>
      {showHeader && title && (
        <header className="safe-area-top safe-area-x bg-blue-600 text-white p-4 sticky top-0 z-50">
          <h1 className="text-lg font-semibold">{title}</h1>
        </header>
      )}
      <main className="flex-1 safe-area-bottom overflow-y-auto">
        {children}
      </main>
    </div>
  );
};

interface MobileButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  fullWidth?: boolean;
  className?: string;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
}

/**
 * Touch-optimized button with proper sizing
 */
export const MobileButton: React.FC<MobileButtonProps> = ({
  children,
  onClick,
  variant = 'primary',
  fullWidth = false,
  className = '',
  disabled = false,
  type = 'button',
}) => {
  const variantClasses = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white',
    secondary: 'bg-gray-200 hover:bg-gray-300 text-gray-800',
    danger: 'bg-red-600 hover:bg-red-700 text-white',
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`
        btn-mobile
        ${variantClasses[variant]}
        ${fullWidth ? 'w-full' : ''}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'active:scale-95'}
        rounded-lg font-medium transition-all
        ${className}
      `}
    >
      {children}
    </button>
  );
};

interface MobileListItemProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  showChevron?: boolean;
}

/**
 * Touch-optimized list item
 */
export const MobileListItem: React.FC<MobileListItemProps> = ({
  children,
  onClick,
  className = '',
  showChevron = false,
}) => {
  return (
    <div
      onClick={onClick}
      className={`
        flex items-center justify-between
        py-3 px-4 min-h-[44px]
        border-b border-gray-200 last:border-b-0
        ${onClick ? 'active:bg-gray-50 cursor-pointer' : ''}
        ${className}
      `}
    >
      <div className="flex-1">{children}</div>
      {showChevron && (
        <svg
          className="w-5 h-5 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
      )}
    </div>
  );
};

interface MobileInputProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  error?: string;
  className?: string;
}

/**
 * Mobile-optimized input with proper sizing
 */
export const MobileInput: React.FC<MobileInputProps> = ({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  required = false,
  error,
  className = '',
}) => {
  return (
    <div className={`mb-4 ${className}`}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className={`
          w-full px-4 py-3 text-base
          border rounded-lg
          focus:ring-2 focus:ring-blue-500 focus:border-transparent
          ${error ? 'border-red-500' : 'border-gray-300'}
        `}
      />
      {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
    </div>
  );
};
