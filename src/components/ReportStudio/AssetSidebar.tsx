import React from 'react';
import { BrandingAsset, ReportConfig } from './types';
import { Settings, Image, Layout, Palette, CheckSquare, TestTube } from 'lucide-react';

interface TestGroupInfo {
    id: string;
    name: string;
}

interface AssetSidebarProps {
    config: ReportConfig;
    setConfig: React.Dispatch<React.SetStateAction<ReportConfig>>;
    availableAssets: BrandingAsset[];
    visibleSections: Record<string, boolean>;
    setVisibleSections: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    testGroups?: TestGroupInfo[];
}

export const AssetSidebar: React.FC<AssetSidebarProps> = ({ config, setConfig, availableAssets, visibleSections, setVisibleSections, testGroups = [] }) => {
    const headers = availableAssets.filter(a => a.asset_type === 'header');
    const footers = availableAssets.filter(a => a.asset_type === 'footer');
    const logos = availableAssets.filter(a => a.asset_type === 'logo');

    const updateConfig = (key: keyof ReportConfig, value: any) => {
        setConfig(prev => ({ ...prev, [key]: value }));

        // Sync visibility with config changes where applicable
        if (key === 'headerId') {
            toggleSection('header', value !== 'none');
        }
        if (key === 'footerId') {
            toggleSection('footer', value !== 'none');
        }
    };

    const toggleSection = (key: string, value: boolean) => {
        setVisibleSections(prev => ({ ...prev, [key]: value }));
    };

    return (
        <div className="w-80 bg-white border-r border-gray-200 h-full flex flex-col overflow-y-auto">
            <div className="p-4 border-b border-gray-200">
                <h2 className="text-lg font-bold flex items-center">
                    <Settings className="w-5 h-5 mr-2" />
                    Report Design
                </h2>
            </div>

            <div className="p-4 space-y-6">

                {/* Visibility Toggles (Moved to top as requested priority) */}
                <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-gray-700 flex items-center">
                        <CheckSquare className="w-4 h-4 mr-2" /> Visible Sections
                    </h3>

                    <div className="space-y-2">
                        <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={visibleSections.header}
                                onChange={(e) => toggleSection('header', e.target.checked)}
                                className="rounded text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-700">Header</span>
                        </label>
                        <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={visibleSections.footer}
                                onChange={(e) => toggleSection('footer', e.target.checked)}
                                className="rounded text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-700">Footer</span>
                        </label>
                        <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={visibleSections.interpretation}
                                onChange={(e) => toggleSection('interpretation', e.target.checked)}
                                className="rounded text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-700">Interpretations</span>
                        </label>
                        <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={visibleSections.clinicalSummary}
                                onChange={(e) => toggleSection('clinicalSummary', e.target.checked)}
                                className="rounded text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-700">Clinical Summary</span>
                        </label>
                        <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={visibleSections.graphs}
                                onChange={(e) => toggleSection('graphs', e.target.checked)}
                                className="rounded text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-700">Trends & Graphs</span>
                        </label>
                        <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={visibleSections.patientSummary}
                                onChange={(e) => toggleSection('patientSummary', e.target.checked)}
                                className="rounded text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-700">Patient Summary</span>
                        </label>
                        <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={visibleSections.methodology !== false}
                                onChange={(e) => toggleSection('methodology', e.target.checked)}
                                className="rounded text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-700">Methodology</span>
                        </label>
                    </div>
                </div>

                {/* Test Group Toggles (only show when multiple groups) */}
                {testGroups.length > 1 && (
                    <>
                        <hr className="border-gray-100" />
                        <div className="space-y-3">
                            <h3 className="text-sm font-semibold text-gray-700 flex items-center">
                                <TestTube className="w-4 h-4 mr-2" /> Test Groups ({testGroups.length})
                            </h3>
                            <p className="text-xs text-gray-400">Toggle individual test groups on/off</p>
                            <div className="space-y-2">
                                {testGroups.map(g => {
                                    const key = `testGroup_${g.id}`;
                                    return (
                                        <label key={g.id} className="flex items-center space-x-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={visibleSections[key] !== false}
                                                onChange={(e) => toggleSection(key, e.target.checked)}
                                                className="rounded text-blue-600 focus:ring-blue-500"
                                            />
                                            <span className="text-sm text-gray-700 truncate" title={g.name}>{g.name}</span>
                                        </label>
                                    );
                                })}
                            </div>
                            <div className="flex gap-2">
                                <button
                                    className="flex-1 text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 transition-colors"
                                    onClick={() => {
                                        setVisibleSections(prev => {
                                            const updated = { ...prev };
                                            testGroups.forEach(g => { updated[`testGroup_${g.id}`] = true; });
                                            return updated;
                                        });
                                    }}
                                >
                                    Show All
                                </button>
                                <button
                                    className="flex-1 text-xs px-2 py-1 bg-gray-50 text-gray-600 rounded hover:bg-gray-100 transition-colors"
                                    onClick={() => {
                                        setVisibleSections(prev => {
                                            const updated = { ...prev };
                                            testGroups.forEach(g => { updated[`testGroup_${g.id}`] = false; });
                                            return updated;
                                        });
                                    }}
                                >
                                    Hide All
                                </button>
                            </div>
                        </div>
                    </>
                )}

                <hr className="border-gray-100" />

                {/* Header Selection */}
                <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-gray-700 flex items-center">
                        <Layout className="w-4 h-4 mr-2" /> Header Asset
                    </h3>
                    <select
                        value={config.headerId}
                        onChange={(e) => updateConfig('headerId', e.target.value)}
                        className="w-full border rounded-md p-2 text-sm focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="none">None</option>
                        {headers.map(h => (
                            <option key={h.id} value={h.id}>{h.name}</option>
                        ))}
                    </select>

                    {config.headerId !== 'none' && (
                        <div className="flex items-center justify-between text-xs text-gray-500">
                            <span>Height (mm)</span>
                            <input
                                type="number"
                                value={config.headerHeight}
                                onChange={(e) => updateConfig('headerHeight', Number(e.target.value))}
                                className="w-16 border rounded px-1"
                            />
                        </div>
                    )}
                </div>

                <hr className="border-gray-100" />

                {/* Footer Selection */}
                <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-gray-700 flex items-center">
                        <Layout className="w-4 h-4 mr-2" /> Footer Asset
                    </h3>
                    <select
                        value={config.footerId}
                        onChange={(e) => updateConfig('footerId', e.target.value)}
                        className="w-full border rounded-md p-2 text-sm focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="none">None</option>
                        {footers.map(f => (
                            <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                    </select>
                    {config.footerId !== 'none' && (
                        <div className="flex items-center justify-between text-xs text-gray-500">
                            <span>Height (mm)</span>
                            <input
                                type="number"
                                value={config.footerHeight}
                                onChange={(e) => updateConfig('footerHeight', Number(e.target.value))}
                                className="w-16 border rounded px-1"
                            />
                        </div>
                    )}
                </div>

                <hr className="border-gray-100" />

                {/* Styling Options */}
                <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-gray-700 flex items-center">
                        <Palette className="w-4 h-4 mr-2" /> Styling
                    </h3>

                    <label className="flex items-center justify-between cursor-pointer p-2 hover:bg-gray-50 rounded">
                        <span className="text-sm">Highlight Abnormal Results</span>
                        <div
                            onClick={() => updateConfig('showAbnormalColors', !config.showAbnormalColors)}
                            className={`w-10 h-5 rounded-full relative transition-colors ${config.showAbnormalColors ? 'bg-blue-600' : 'bg-gray-300'}`}
                        >
                            <div className={`absolute top-1 left-1 bg-white w-3 h-3 rounded-full transition-transform ${config.showAbnormalColors ? 'translate-x-5' : ''}`} />
                        </div>
                    </label>
                </div>

                <hr className="border-gray-100" />

                {/* Other Components */}
                <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-gray-700 flex items-center">
                        <CheckSquare className="w-4 h-4 mr-2" /> Misc
                    </h3>

                    {[
                        { key: 'showSignature', label: 'Show Signature Block' },
                        { key: 'showQrCode', label: 'Show QR Code' },
                        { key: 'showMethodology', label: 'Show Methodology' }
                    ].map(opt => (
                        <label key={opt.key} className="flex items-center space-x-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={(config as any)[opt.key as keyof ReportConfig]}
                                onChange={(e) => updateConfig(opt.key as keyof ReportConfig, e.target.checked)}
                                className="rounded text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-700">{opt.label}</span>
                        </label>
                    ))}
                </div>

                <hr className="border-gray-100" />

                {/* Extra Assets / Stickers */}
                <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-gray-700 flex items-center">
                        <Image className="w-4 h-4 mr-2" /> Stickers / Badges
                    </h3>
                    <div className="grid grid-cols-2 gap-2">
                        {logos.map(logo => (
                            <div
                                key={logo.id}
                                className="border rounded p-1 hover:border-blue-500 cursor-pointer text-center"
                                onClick={() => {
                                    // Add to extraAssets
                                    setConfig(prev => ({
                                        ...prev,
                                        extraAssets: [
                                            ...prev.extraAssets,
                                            {
                                                id: crypto.randomUUID(),
                                                assetId: logo.id,
                                                url: logo.url,
                                                position: { x: 10, y: 50 }, // Default position
                                                size: { width: 30, height: 30 } // Default size
                                            }
                                        ]
                                    }));
                                }}
                            >
                                <img src={logo.url} className="h-10 mx-auto object-contain" />
                                <span className="text-[10px] truncate block mt-1">{logo.name}</span>
                            </div>
                        ))}
                        {logos.length === 0 && (
                            <p className="text-xs text-gray-400 col-span-2 text-center py-2">No logos uploaded</p>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
};
