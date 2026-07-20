import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Search, X, Check } from 'lucide-react';

// --- Fuzzy matching ---------------------------------------------------------
// Every whitespace-separated query token must match the option's text, either
// as a substring or as an in-order character subsequence. Tokens can be out of
// order, so "abdomen usg", "usg abd" and "uwab" all match "USG Whole Abdomen".
// Results are ranked: prefix > word-start > substring > subsequence.

const subsequenceScore = (text: string, token: string): number => {
  let ti = 0;
  let firstIdx = -1;
  let lastIdx = -1;
  for (let i = 0; i < text.length && ti < token.length; i++) {
    if (text[i] === token[ti]) {
      if (firstIdx === -1) firstIdx = i;
      lastIdx = i;
      ti++;
    }
  }
  if (ti < token.length) return 0;
  // Tighter character clusters rank higher than scattered matches
  return 10 + (token.length / (lastIdx - firstIdx + 1)) * 10;
};

const tokenScore = (text: string, token: string): number => {
  const idx = text.indexOf(token);
  if (idx === 0) return 100;
  if (idx > 0 && !/[a-z0-9]/.test(text[idx - 1])) return 80; // starts a word
  if (idx > 0) return 60;
  return subsequenceScore(text, token);
};

const optionScore = (option: Option, tokens: string[]): number => {
  const haystack = `${option.label} ${option.description ?? ''} ${option.badge ?? ''}`.toLowerCase();
  let total = 0;
  for (const token of tokens) {
    const score = tokenScore(haystack, token);
    if (score === 0) return 0;
    total += score;
  }
  return total;
};

interface Option {
  id: string;
  label: string;
  description?: string;
  badge?: string;
  metadata?: any;
}

interface SearchableSelectProps {
  options: Option[];
  value?: string;
  onChange: (value: string, option?: Option) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  disabled?: boolean;
  loading?: boolean;
  allowClear?: boolean;
  renderOption?: (option: Option) => React.ReactNode;
  renderSelected?: (option: Option) => React.ReactNode;
}

const SearchableSelect: React.FC<SearchableSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = "Select an option",
  searchPlaceholder = "Search...",
  className = "",
  disabled = false,
  loading = false,
  allowClear = false,
  renderOption,
  renderSelected
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const selectRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(opt => opt.id === value);

  // Fuzzy-filter options and rank best matches first
  const filteredOptions = useMemo(() => {
    const tokens = searchTerm.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return options;
    return options
      .map((option, index) => ({ option, index, score: optionScore(option, tokens) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map(item => item.option);
  }, [options, searchTerm]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Reset search when dropdown closes
  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('');
    }
  }, [isOpen]);

  const handleSelect = (option: Option) => {
    onChange(option.id, option);
    setIsOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setIsOpen(false);
  };

  const defaultRenderOption = (option: Option) => (
    <div className="flex items-center justify-between w-full">
      <div className="flex-1">
        <div className="font-medium text-gray-900">{option.label}</div>
        {option.description && (
          <div className="text-sm text-gray-500 truncate">{option.description}</div>
        )}
      </div>
      {option.badge && (
        <div className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-800 text-xs rounded">
          {option.badge}
        </div>
      )}
    </div>
  );

  const defaultRenderSelected = (option: Option) => (
    <div className="flex items-center justify-between w-full">
      <div className="flex-1">
        <div className="font-medium text-gray-900 truncate">{option.label}</div>
        {option.description && (
          <div className="text-xs text-gray-500 truncate">{option.description}</div>
        )}
      </div>
      {option.badge && (
        <div className="ml-2 px-1.5 py-0.5 bg-blue-100 text-blue-800 text-xs rounded">
          {option.badge}
        </div>
      )}
    </div>
  );

  return (
    <div ref={selectRef} className={`relative ${className}`}>
      {/* Select Button */}
      <button
        type="button"
        onClick={() => !disabled && !loading && setIsOpen(!isOpen)}
        disabled={disabled || loading}
        className={`
          w-full px-3 py-2 text-left bg-white border border-gray-300 rounded-md shadow-sm
          focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
          ${disabled || loading ? 'bg-gray-50 cursor-not-allowed' : 'hover:border-gray-400 cursor-pointer'}
          ${isOpen ? 'ring-2 ring-blue-500 border-blue-500' : ''}
        `}
      >
        <div className="flex items-center justify-between min-h-[20px]">
          {loading ? (
            <span className="text-gray-500">Loading...</span>
          ) : selectedOption ? (
            renderSelected ? renderSelected(selectedOption) : defaultRenderSelected(selectedOption)
          ) : (
            <span className="text-gray-500">{placeholder}</span>
          )}
          
          <div className="flex items-center ml-2">
            {allowClear && selectedOption && !disabled && (
              <X
                className="h-4 w-4 text-gray-400 hover:text-gray-600 mr-1"
                onClick={handleClear}
              />
            )}
            <ChevronDown
              className={`h-4 w-4 text-gray-400 transform transition-transform ${
                isOpen ? 'rotate-180' : ''
              }`}
            />
          </div>
        </div>
      </button>

      {/* Dropdown */}
      {isOpen && !loading && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg">
          {/* Search Input */}
          <div className="p-2 border-b border-gray-200">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => {
                  // Enter picks the top match instead of submitting an enclosing form
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (filteredOptions.length > 0) handleSelect(filteredOptions[0]);
                  } else if (e.key === 'Escape') {
                    e.stopPropagation();
                    setIsOpen(false);
                  }
                }}
                placeholder={searchPlaceholder}
                className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                autoFocus
              />
            </div>
          </div>

          {/* Options List */}
          <div className="max-h-60 overflow-y-auto">
            {filteredOptions.length === 0 ? (
              <div className="p-3 text-sm text-gray-500 text-center">
                No options found
              </div>
            ) : (
              filteredOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => handleSelect(option)}
                  className={`
                    w-full px-3 py-3 text-left hover:bg-gray-50 focus:outline-none focus:bg-gray-50
                    ${selectedOption?.id === option.id ? 'bg-blue-50' : ''}
                  `}
                >
                  <div className="flex items-center">
                    {selectedOption?.id === option.id && (
                      <Check className="h-4 w-4 text-blue-600 mr-2 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      {renderOption ? renderOption(option) : defaultRenderOption(option)}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchableSelect;
