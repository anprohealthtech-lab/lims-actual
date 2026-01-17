import React, { useState, useEffect } from 'react';
import { X, Settings, RotateCcw, Save, Loader2, Download } from 'lucide-react';
import { supabase } from '../../utils/supabase';

// PDF rendering settings that can be adjusted by users
export interface PDFRenderSettings {
  scale: number;
  margins: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  headerHeight: number;
  footerHeight: number;
  displayHeaderFooter: boolean;
  mediaType: 'print' | 'screen';
  printBackground: boolean;
  paperSize: 'A4' | 'Letter';
  orientation: 'portrait' | 'landscape';
}

// Preset profiles for common use cases
export const PDF_PRESETS: Record<string, PDFRenderSettings> = {
  standard: {
    scale: 1.0,
    margins: { top: 120, right: 20, bottom: 80, left: 20 },
    headerHeight: 90,
    footerHeight: 80,
    displayHeaderFooter: true,
    mediaType: 'screen',
    printBackground: true,
    paperSize: 'A4',
    orientation: 'portrait',
  },
  compact: {
    scale: 0.9,
    margins: { top: 100, right: 15, bottom: 60, left: 15 },
    headerHeight: 80,
    footerHeight: 60,
    displayHeaderFooter: true,
    mediaType: 'screen',
    printBackground: true,
    paperSize: 'A4',
    orientation: 'portrait',
  },
  largeMargins: {
    scale: 0.85,
    margins: { top: 140, right: 30, bottom: 100, left: 30 },
    headerHeight: 100,
    footerHeight: 90,
    displayHeaderFooter: true,
    mediaType: 'screen',
    printBackground: true,
    paperSize: 'A4',
    orientation: 'portrait',
  },
  noHeaderFooter: {
    scale: 1.0,
    margins: { top: 40, right: 20, bottom: 40, left: 20 },
    headerHeight: 0,
    footerHeight: 0,
    displayHeaderFooter: false,
    mediaType: 'screen',
    printBackground: true,
    paperSize: 'A4',
    orientation: 'portrait',
  },
  printOptimized: {
    scale: 0.94,
    margins: { top: 40, right: 20, bottom: 40, left: 20 },
    headerHeight: 0,
    footerHeight: 0,
    displayHeaderFooter: false,
    mediaType: 'print',
    printBackground: false,
    paperSize: 'A4',
    orientation: 'portrait',
  },
  letterhead: {
    scale: 1.0,
    margins: { top: 120, right: 20, bottom: 80, left: 20 }, // Top margin for header image
    headerHeight: 0,
    footerHeight: 0,
    displayHeaderFooter: false, // Header/footer are background images
    mediaType: 'screen',
    printBackground: true, // Essential for background images
    paperSize: 'A4',
    orientation: 'portrait',
  },
};

// Storage key for localStorage fallback
const STORAGE_KEY = 'lims_pdf_settings';

// Load saved settings from database (lab-level) or fallback to localStorage
export const loadSavedPDFSettings = async (labId?: string): Promise<PDFRenderSettings | null> => {
  // Try database first (lab-level settings)
  if (labId) {
    try {
      const { data, error } = await supabase
        .from('labs')
        .select('pdf_layout_settings')
        .eq('id', labId)
        .single();

      if (!error && data?.pdf_layout_settings) {
        console.log('📄 Loaded PDF settings from database (lab-level)');
        return data.pdf_layout_settings as PDFRenderSettings;
      }
    } catch (error) {
      console.warn('Failed to load PDF settings from database:', error);
    }
  }

  // Fallback to localStorage
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      console.log('📄 Loaded PDF settings from localStorage (fallback)');
      return JSON.parse(saved);
    }
  } catch (error) {
    console.warn('Failed to load saved PDF settings from localStorage:', error);
  }

  return null;
};

// Save settings to database (lab-level)
export const savePDFSettingsToDatabase = async (labId: string, settings: PDFRenderSettings): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('labs')
      .update({ pdf_layout_settings: settings })
      .eq('id', labId);

    if (error) {
      console.error('Failed to save PDF settings to database:', error);
      return false;
    }

    console.log('✅ PDF settings saved to database (lab-level)');
    // Also save to localStorage as backup
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch (error) {
    console.error('Failed to save PDF settings:', error);
    return false;
  }
};

// Save settings to localStorage only (legacy)
export const savePDFSettings = (settings: PDFRenderSettings): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn('Failed to save PDF settings:', error);
  }
};

// Convert settings to PDF.co format
export const settingsToPdfCoOptions = (settings: PDFRenderSettings) => ({
  margins: `${settings.margins.top}px ${settings.margins.right}px ${settings.margins.bottom}px ${settings.margins.left}px`,
  scale: settings.scale,
  headerHeight: settings.displayHeaderFooter ? `${settings.headerHeight}px` : undefined,
  footerHeight: settings.displayHeaderFooter ? `${settings.footerHeight}px` : undefined,
  displayHeaderFooter: settings.displayHeaderFooter,
  mediaType: settings.mediaType,
  printBackground: settings.printBackground,
  paperSize: settings.paperSize,
  orientation: settings.orientation,
});

interface PDFSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRegenerate: (settings: PDFRenderSettings) => Promise<void>;
  currentSettings?: Partial<PDFRenderSettings>;
  isRegenerating?: boolean;
  labId?: string; // Lab ID for database storage
}

const PDFSettingsModal: React.FC<PDFSettingsModalProps> = ({
  isOpen,
  onClose,
  onRegenerate,
  currentSettings,
  isRegenerating = false,
  labId,
}) => {
  const [settings, setSettings] = useState<PDFRenderSettings>(PDF_PRESETS.standard);
  const [selectedPreset, setSelectedPreset] = useState<string>('custom');
  const [isSaving, setIsSaving] = useState(false);

  // Load settings from database when modal opens
  useEffect(() => {
    if (isOpen && labId) {
      loadSavedPDFSettings(labId).then((savedSettings) => {
        if (savedSettings) {
          // Merge with defaults to ensure all properties exist
          setSettings({ ...PDF_PRESETS.standard, ...savedSettings });
        } else if (currentSettings) {
          setSettings({ ...PDF_PRESETS.standard, ...currentSettings });
        }
      });
    } else if (isOpen && currentSettings) {
      setSettings({ ...PDF_PRESETS.standard, ...currentSettings });
    }
  }, [isOpen, labId, currentSettings]);

  // Check if current settings match any preset
  useEffect(() => {
    const matchedPreset = Object.entries(PDF_PRESETS).find(([, preset]) =>
      JSON.stringify(preset) === JSON.stringify(settings)
    );
    setSelectedPreset(matchedPreset ? matchedPreset[0] : 'custom');
  }, [settings]);

  const handlePresetChange = (presetName: string) => {
    if (presetName !== 'custom' && PDF_PRESETS[presetName]) {
      setSettings(PDF_PRESETS[presetName]);
      setSelectedPreset(presetName);
    }
  };

  const handleReset = () => {
    setSettings(PDF_PRESETS.standard);
    setSelectedPreset('standard');
  };

  const handleSaveDefaults = async () => {
    if (!labId) {
      // Fallback to localStorage if no labId
      savePDFSettings(settings);
      alert('Settings saved locally!');
      return;
    }

    setIsSaving(true);
    const success = await savePDFSettingsToDatabase(labId, settings);
    setIsSaving(false);

    if (success) {
      alert('Lab PDF settings saved successfully! These settings will be used for all PDFs in this lab.');
    } else {
      alert('Failed to save settings. Please try again.');
    }
  };

  const handleRegenerate = async () => {
    await onRegenerate(settings);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-blue-50 to-indigo-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Settings className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">PDF Settings</h2>
              <p className="text-sm text-gray-500">Adjust layout and regenerate</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            disabled={isRegenerating}
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Presets */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">Quick Presets</label>
            <div className="flex flex-wrap gap-2">
              {Object.keys(PDF_PRESETS).map((preset) => (
                <button
                  key={preset}
                  onClick={() => handlePresetChange(preset)}
                  className={`px-3 py-1.5 text-sm rounded-lg border transition-all ${selectedPreset === preset
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                    }`}
                >
                  {preset.charAt(0).toUpperCase() + preset.slice(1).replace(/([A-Z])/g, ' $1')}
                </button>
              ))}
              {selectedPreset === 'custom' && (
                <span className="px-3 py-1.5 text-sm rounded-lg bg-amber-100 text-amber-700 border border-amber-300">
                  Custom
                </span>
              )}
            </div>
          </div>

          {/* Scale */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Scale: {(settings.scale * 100).toFixed(0)}%
            </label>
            <input
              type="range"
              min="50"
              max="150"
              step="1"
              value={settings.scale * 100}
              onChange={(e) => setSettings((s) => ({ ...s, scale: Number(e.target.value) / 100 }))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
            <div className="flex justify-between text-xs text-gray-500">
              <span>50%</span>
              <span>100%</span>
              <span>150%</span>
            </div>
          </div>

          {/* Margins */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">Margins (px)</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                <div key={side} className="space-y-1">
                  <label className="block text-xs text-gray-500 capitalize">{side}</label>
                  <input
                    type="number"
                    min="0"
                    max="200"
                    value={settings.margins[side]}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        margins: { ...s.margins, [side]: Number(e.target.value) },
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Header/Footer */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700">Header & Footer</label>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.displayHeaderFooter}
                  onChange={(e) => setSettings((s) => ({ ...s, displayHeaderFooter: e.target.checked }))}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            {settings.displayHeaderFooter && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs text-gray-500">Header Height (px)</label>
                  <input
                    type="number"
                    min="0"
                    max="200"
                    value={settings.headerHeight}
                    onChange={(e) => setSettings((s) => ({ ...s, headerHeight: Number(e.target.value) }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs text-gray-500">Footer Height (px)</label>
                  <input
                    type="number"
                    min="0"
                    max="200"
                    value={settings.footerHeight}
                    onChange={(e) => setSettings((s) => ({ ...s, footerHeight: Number(e.target.value) }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Media Type & Background */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Media Type</label>
              <select
                value={settings.mediaType}
                onChange={(e) => setSettings((s) => ({ ...s, mediaType: e.target.value as 'print' | 'screen' }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="screen">Screen (colors)</option>
                <option value="print">Print (optimized)</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Paper Size</label>
              <select
                value={settings.paperSize}
                onChange={(e) => setSettings((s) => ({ ...s, paperSize: e.target.value as 'A4' | 'Letter' }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="A4">A4</option>
                <option value="Letter">Letter</option>
              </select>
            </div>
          </div>

          {/* Toggles Row */}
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.printBackground}
                onChange={(e) => setSettings((s) => ({ ...s, printBackground: e.target.checked }))}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Print backgrounds</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.orientation === 'landscape'}
                onChange={(e) => setSettings((s) => ({ ...s, orientation: e.target.checked ? 'landscape' : 'portrait' }))}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Landscape</span>
            </label>
          </div>

          {/* Current Settings Preview */}
          <div className="bg-gray-50 rounded-lg p-4 text-xs font-mono text-gray-600 space-y-1">
            <div className="font-semibold text-gray-700 mb-2">Request Preview:</div>
            <div>margins: "{settings.margins.top}px {settings.margins.right}px {settings.margins.bottom}px {settings.margins.left}px"</div>
            <div>scale: {settings.scale}</div>
            <div>headerHeight: "{settings.headerHeight}px"</div>
            <div>footerHeight: "{settings.footerHeight}px"</div>
            <div>mediaType: "{settings.mediaType}"</div>
            <div>displayHeaderFooter: {settings.displayHeaderFooter.toString()}</div>
            <div>printBackground: {settings.printBackground.toString()}</div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t bg-gray-50">
          <div className="flex gap-2">
            <button
              onClick={handleReset}
              disabled={isRegenerating}
              className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>
            <button
              onClick={handleSaveDefaults}
              disabled={isRegenerating || isSaving}
              className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save as Default
                </>
              )}
            </button>
          </div>
          <button
            onClick={handleRegenerate}
            disabled={isRegenerating}
            className="flex items-center gap-2 px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRegenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Regenerate PDF
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PDFSettingsModal;
