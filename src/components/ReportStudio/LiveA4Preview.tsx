import React from 'react';
import { ReportConfig, ReportData } from './types';
import { Header, Footer, PatientInfo, TestResultsTable } from './ReportComponents';

interface LiveA4PreviewProps {
    config: ReportConfig;
    data: ReportData;
    headerUrl?: string; // Resolved URL
    footerUrl?: string; // Resolved URL
    scale?: number;
    readOnly?: boolean;
}

export const LiveA4Preview: React.FC<LiveA4PreviewProps> = ({
    config,
    data,
    headerUrl,
    footerUrl,
    scale = 0.6,
    readOnly = false
}) => {
    // A4 dimensions
    const widthMm = 210;
    const heightMm = 297;
    const safeExtraAssets = Array.isArray(config.extraAssets) ? config.extraAssets : [];

    return (
        <div
            className="bg-white shadow-2xl relative transition-transform duration-200 ease-in-out border border-gray-200"
            id="report-preview-canvas"
            style={{
                width: `${widthMm}mm`,
                height: `${heightMm}mm`,
                minWidth: `${widthMm}mm`, // Force fixed width
                minHeight: `${heightMm}mm`,
                transform: `scale(${scale})`,
                transformOrigin: 'top center',
                overflow: 'hidden'
            }}
        >
            {/* Header Section */}
            {headerUrl && config.headerId !== 'none' && (
                <Header url={headerUrl} height={config.headerHeight || 35} />
            )}

            {/* Main Content Area */}
            {/* Positioned absolutely to respect header/footer margins */}
            <div
                className="absolute w-full px-8 flex flex-col"
                style={{
                    top: `${(config.headerHeight || 35) + 5}mm`,
                    height: `${heightMm - ((config.headerHeight || 35) + (config.footerHeight || 20) + 10)}mm`, // Calculated remaining height
                    overflow: 'hidden' // Prevent spillover
                }}
            >
                <div className="flex-1">
                    <PatientInfo order={data.order} patient={data.patient} />

                    <div className="mt-4">
                        <TestResultsTable tests={data.tests} showColors={config.showAbnormalColors} />
                    </div>

                    {/* Signature Block (if enabled) */}
                    {config.showSignature && (
                        <div className="mt-12 flex justify-end">
                            <div className="text-center">
                                <div className="h-16 w-32 border border-dashed border-gray-300 mb-2 flex items-center justify-center text-gray-400 text-xs bg-gray-50">
                                    Signature Image
                                </div>
                                <p className="font-bold text-sm">Pathologist Name</p>
                                <p className="text-xs text-gray-500">MD, Path</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* End of Report / Disclaimer */}
                <div className="mt-auto pt-4 text-[10px] text-gray-400 text-center">
                    ~ End of Report ~
                </div>
            </div>

            {/* Footer Section */}
            {footerUrl && config.footerId !== 'none' && (
                <Footer url={footerUrl} height={config.footerHeight || 20} />
            )}

            {/* Extra Draggable/Floating Assets */}
            {safeExtraAssets.map(asset => (
                <img
                    key={asset.id}
                    src={asset.url}
                    alt="Asset"
                    className={`absolute ${readOnly ? '' : 'cursor-move hover:ring-2 ring-blue-500'}`}
                    style={{
                        left: `${asset.position.x}mm`,
                        top: `${asset.position.y}mm`,
                        width: `${asset.size.width}mm`,
                        zIndex: 50
                        // Rotation etc. could be added
                    }}
                />
            ))}
        </div>
    );
};
