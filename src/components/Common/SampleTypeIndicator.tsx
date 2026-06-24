import React from 'react';
import { useSampleTypeColors } from '../../contexts/SampleTypeColorsContext';

interface SampleTypeIndicatorProps {
    sampleType: string;
    sampleColor?: string;
    size?: 'sm' | 'md' | 'lg';
    showLabel?: boolean;
    className?: string;
    labColors?: Record<string, string>;
}

// Default vacutainer cap colors (industry standard)
const DEFAULT_VACUTAINER_CAPS: Record<string, { cap: string; label: string; gradient: string }> = {
    red: { cap: '#DC2626', label: 'Red Top', gradient: 'from-red-600 to-red-700' },
    purple: { cap: '#9333EA', label: 'Purple Top (EDTA)', gradient: 'from-purple-600 to-purple-700' },
    lavender: { cap: '#9333EA', label: 'Lavender Top (EDTA)', gradient: 'from-purple-600 to-purple-700' },
    green: { cap: '#16A34A', label: 'Green Top (Heparin)', gradient: 'from-green-600 to-green-700' },
    blue: { cap: '#2563EB', label: 'Blue Top (Citrate)', gradient: 'from-blue-600 to-blue-700' },
    yellow: { cap: '#EAB308', label: 'Yellow Top (SST)', gradient: 'from-yellow-500 to-yellow-600' },
    gold: { cap: '#F59E0B', label: 'Gold Top (SST)', gradient: 'from-amber-500 to-amber-600' },
    gray: { cap: '#6B7280', label: 'Gray Top (Fluoride)', gradient: 'from-gray-500 to-gray-600' },
};

// Map sample types to visual representations (Specimen Types)
const getSampleConfig = (sampleType: string, labColors: Record<string, string> = {}) => {
    const type = sampleType?.toLowerCase() || '';

    // Check for lab-configured color override first
    const labColorOverride = findLabColorOverride(type, labColors);

    // Radiology types - not affected by tube colors
    if (type.includes('x ray') || type.includes('x-ray') || type.includes('xray')) {
        return {
            type: 'radiology-xray',
            cap: '#1D4ED8',
            label: 'X-Ray',
            gradient: 'from-blue-600 to-blue-700'
        };
    } else if (type.includes('ct')) {
        return {
            type: 'radiology-ct',
            cap: '#0F766E',
            label: 'CT Scan',
            gradient: 'from-teal-600 to-teal-700'
        };
    } else if (type.includes('usg') || type.includes('ultrasound') || type.includes('sonography')) {
        return {
            type: 'radiology-usg',
            cap: '#7C3AED',
            label: 'USG',
            gradient: 'from-violet-600 to-violet-700'
        };
    }

    // Container type detection
    let containerType = 'vacutainer';
    let defaultCapConfig = DEFAULT_VACUTAINER_CAPS.red;

    if (type.includes('urine')) {
        containerType = 'urine';
        defaultCapConfig = { cap: '#EAB308', label: 'Urine Cup', gradient: 'from-yellow-500 to-yellow-600' };
    } else if (type.includes('stool')) {
        containerType = 'stool';
        defaultCapConfig = { cap: '#92400E', label: 'Stool Container', gradient: 'from-amber-800 to-amber-900' };
    } else if (type.includes('swab')) {
        containerType = 'swab';
        defaultCapConfig = { cap: '#9CA3AF', label: 'Swab', gradient: 'from-gray-400 to-gray-500' };
    } else if (type.includes('edta') || type.includes('purple') || type.includes('lavender') || type.includes('hb1ac') || type.includes('cbc') || type.includes('hematology')) {
        defaultCapConfig = DEFAULT_VACUTAINER_CAPS.purple;
    } else if (type.includes('serum') || type.includes('sst') || type.includes('gold') || type.includes('yellow') || type.includes('thyroid') || type.includes('t3') || type.includes('t4') || type.includes('tsh') || type.includes('hormone') || type.includes('biochemistry')) {
        defaultCapConfig = DEFAULT_VACUTAINER_CAPS.gold;
    } else if (type.includes('blood') || type.includes('red')) {
        defaultCapConfig = DEFAULT_VACUTAINER_CAPS.red;
    } else if (type.includes('plasma') || type.includes('green') || type.includes('heparin')) {
        defaultCapConfig = DEFAULT_VACUTAINER_CAPS.green;
    } else if (type.includes('citrate') || type.includes('blue') || type.includes('coagulation')) {
        defaultCapConfig = DEFAULT_VACUTAINER_CAPS.blue;
    } else if (type.includes('fluoride') || type.includes('gray') || type.includes('glucose') || type.includes('sugar')) {
        defaultCapConfig = DEFAULT_VACUTAINER_CAPS.gray;
    }

    // Apply lab color override if present
    if (labColorOverride) {
        return {
            type: containerType,
            cap: labColorOverride,
            label: defaultCapConfig.label,
            gradient: defaultCapConfig.gradient,
        };
    }

    return {
        type: containerType,
        ...defaultCapConfig
    };
};

// Find matching lab color override for a sample type
function findLabColorOverride(sampleType: string, labColors: Record<string, string>): string | null {
    if (!labColors || Object.keys(labColors).length === 0) return null;

    const type = sampleType.toLowerCase();

    // Direct match
    if (labColors[type]) return labColors[type];

    // Check if any configured key is contained in the sample type
    for (const [key, color] of Object.entries(labColors)) {
        if (type.includes(key.toLowerCase())) {
            return color;
        }
    }

    return null;
}

const VacutainerTube: React.FC<{ config: any; size: string }> = ({ config, size }) => {
    const sizes = {
        sm: { width: 20, height: 40, capHeight: 8 },
        md: { width: 28, height: 56, capHeight: 12 },
        lg: { width: 36, height: 72, capHeight: 16 },
    };

    const { width, height, capHeight } = sizes[size as keyof typeof sizes];

    return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="inline-block" style={{ overflow: 'visible' }}>
            <defs>
                <linearGradient id={`tube-grad-${config.cap}`} x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" style={{ stopColor: '#F3F4F6', stopOpacity: 0.9 }} />
                    <stop offset="50%" style={{ stopColor: '#FFFFFF', stopOpacity: 1 }} />
                    <stop offset="100%" style={{ stopColor: '#F3F4F6', stopOpacity: 0.9 }} />
                </linearGradient>
            </defs>

            {/* Glass tube body */}
            <rect
                x={width * 0.15}
                y={capHeight}
                width={width * 0.7}
                height={height - capHeight}
                rx={width * 0.1}
                fill={`url(#tube-grad-${config.cap})`}
                stroke="#D1D5DB"
                strokeWidth="0.5"
            />

            {/* Cap */}
            <rect
                x={0}
                y={0}
                width={width}
                height={capHeight}
                rx={2}
                fill={config.cap}
            />
            {/* Cap highlight */}
            <rect
                x={width * 0.1}
                y={2}
                width={width * 0.2}
                height={capHeight - 4}
                fill="white"
                opacity="0.3"
                rx={1}
            />
        </svg>
    );
};

const UrineContainer: React.FC<{ config: any; size: string }> = ({ config, size }) => {
    const sizes = {
        sm: { width: 28, height: 28, capHeight: 6 },
        md: { width: 36, height: 36, capHeight: 8 },
        lg: { width: 44, height: 44, capHeight: 10 },
    };

    const { width, height, capHeight } = sizes[size as keyof typeof sizes];

    return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="inline-block" style={{ overflow: 'visible' }}>
            <defs>
                <linearGradient id="urine-liquid-grad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" style={{ stopColor: '#FDE68A', stopOpacity: 0.6 }} />
                    <stop offset="100%" style={{ stopColor: '#F59E0B', stopOpacity: 0.9 }} />
                </linearGradient>
            </defs>

            {/* Cup Body (Transparent plastic look) */}
            <path
                d={`M ${width * 0.15} ${capHeight} 
                   L ${width * 0.25} ${height} 
                   L ${width * 0.75} ${height} 
                   L ${width * 0.85} ${capHeight} Z`}
                fill="#F3F4F6"
                fillOpacity="0.4"
                stroke="#D1D5DB"
                strokeWidth="1"
            />

            {/* Liquid inside */}
            <path
                d={`M ${width * 0.22} ${capHeight + (height - capHeight) * 0.4} 
                   L ${width * 0.3} ${height - 2} 
                   L ${width * 0.7} ${height - 2} 
                   L ${width * 0.78} ${capHeight + (height - capHeight) * 0.4} Z`}
                fill="url(#urine-liquid-grad)"
            />

            {/* Screw Cap */}
            <rect
                x={0}
                y={0}
                width={width}
                height={capHeight}
                rx={1.5}
                fill={config.cap || '#DC2626'}
            />
            {/* Cap Ridges */}
            {[0.2, 0.4, 0.6, 0.8].map((pos) => (
                <line
                    key={pos}
                    x1={width * pos} y1={1}
                    x2={width * pos} y2={capHeight - 1}
                    stroke="rgba(0,0,0,0.1)"
                    strokeWidth="1"
                />
            ))}
        </svg>
    );
};

const StoolContainer: React.FC<{ config: any; size: string }> = ({ config, size }) => {
    const sizes = {
        sm: { width: 28, height: 32, capHeight: 6 },
        md: { width: 36, height: 40, capHeight: 8 },
        lg: { width: 44, height: 48, capHeight: 10 },
    };

    const { width, height, capHeight } = sizes[size as keyof typeof sizes];

    return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="inline-block" style={{ overflow: 'visible' }}>
            {/* Wide container body */}
            <path
                d={`M ${width * 0.1} ${capHeight} 
                   L ${width * 0.2} ${height} 
                   L ${width * 0.8} ${height} 
                   L ${width * 0.9} ${capHeight} Z`}
                fill="#FEF3C7"
                fillOpacity="0.5"
                stroke="#D4D4D8"
                strokeWidth="1"
            />

            {/* Liquid/Content area for stool */}
            <path
                d={`M ${width * 0.22} ${capHeight + (height - capHeight) * 0.5} 
                   L ${width * 0.3} ${height - 2} 
                   L ${width * 0.7} ${height - 2} 
                   L ${width * 0.78} ${capHeight + (height - capHeight) * 0.5} Z`}
                fill="#92400E"
                fillOpacity="0.6"
            />

            {/* Screw cap */}
            <rect
                x={0}
                y={0}
                width={width}
                height={capHeight}
                rx={1.5}
                fill={config.cap || '#92400E'}
            />
            {/* Cap Ridges */}
            {[0.2, 0.4, 0.6, 0.8].map((pos) => (
                <line
                    key={pos}
                    x1={width * pos} y1={1}
                    x2={width * pos} y2={capHeight - 1}
                    stroke="rgba(0,0,0,0.1)"
                    strokeWidth="1"
                />
            ))}
        </svg>
    );
};

const SwabIcon: React.FC<{ config: any; size: string }> = ({ config, size }) => {
    const sizes = {
        sm: { width: 20, height: 40 },
        md: { width: 26, height: 56 },
        lg: { width: 32, height: 72 },
    };

    const { width, height } = sizes[size as keyof typeof sizes];

    return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="inline-block">
            {/* Swab stick */}
            <rect
                x={width * 0.4}
                y={height * 0.3}
                width={width * 0.2}
                height={height * 0.65}
                fill="#D1D5DB"
                rx={width * 0.05}
            />

            {/* Cotton tip */}
            <ellipse
                cx={width * 0.5}
                cy={height * 0.15}
                rx={width * 0.35}
                ry={height * 0.15}
                fill="white"
                stroke="#E5E7EB"
                strokeWidth="1"
            />

            {/* Tube */}
            <rect
                x={width * 0.15}
                y={height * 0.35}
                width={width * 0.7}
                height={height * 0.6}
                rx={width * 0.1}
                fill="none"
                stroke={config.cap}
                strokeWidth="2"
                opacity="0.3"
            />
        </svg>
    );
};

const RadiologyIcon: React.FC<{ config: any; size: string; mode: 'xray' | 'ct' | 'usg' }> = ({ config, size, mode }) => {
    const sizes = {
        sm: { width: 26, height: 26 },
        md: { width: 34, height: 34 },
        lg: { width: 42, height: 42 },
    };

    const { width, height } = sizes[size as keyof typeof sizes];
    const cx = width / 2;
    const cy = height / 2;
    const stroke = config.cap || '#1D4ED8';

    if (mode === 'ct') {
        return (
            <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="inline-block">
                <circle cx={cx} cy={cy} r={width * 0.38} fill="white" stroke={stroke} strokeWidth="2" />
                <circle cx={cx} cy={cy} r={width * 0.18} fill="none" stroke={stroke} strokeWidth="2" strokeDasharray="2 2" />
                <rect x={width * 0.14} y={height * 0.43} width={width * 0.12} height={height * 0.14} rx="2" fill={stroke} opacity="0.8" />
            </svg>
        );
    }

    if (mode === 'usg') {
        return (
            <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="inline-block">
                <rect x={width * 0.12} y={height * 0.12} width={width * 0.58} height={height * 0.5} rx="4" fill="white" stroke={stroke} strokeWidth="2" />
                <path d={`M ${width * 0.74} ${height * 0.46} Q ${width * 0.88} ${height * 0.58} ${width * 0.78} ${height * 0.8}`} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
                <path d={`M ${width * 0.26} ${height * 0.42} Q ${width * 0.38} ${height * 0.26} ${width * 0.52} ${height * 0.42}`} fill="none" stroke={stroke} strokeWidth="2" />
            </svg>
        );
    }

    return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="inline-block">
            <rect x={width * 0.12} y={height * 0.12} width={width * 0.76} height={height * 0.76} rx="5" fill="white" stroke={stroke} strokeWidth="2" />
            <line x1={width * 0.28} y1={height * 0.24} x2={width * 0.28} y2={height * 0.76} stroke={stroke} strokeWidth="2" />
            <line x1={width * 0.72} y1={height * 0.24} x2={width * 0.72} y2={height * 0.76} stroke={stroke} strokeWidth="2" />
            <line x1={width * 0.22} y1={height * 0.5} x2={width * 0.78} y2={height * 0.5} stroke={stroke} strokeWidth="2" />
        </svg>
    );
};

export const SampleTypeIndicator: React.FC<SampleTypeIndicatorProps> = ({
    sampleType,
    sampleColor,
    size = 'md',
    showLabel = false,
    className = '',
    labColors: propLabColors,
}) => {
    const { colors: contextLabColors } = useSampleTypeColors();
    const labColors = propLabColors ?? contextLabColors;
    const config = getSampleConfig(sampleType, labColors);

    const renderIcon = () => {
        switch (config.type) {
            case 'urine':
                return <UrineContainer config={config} size={size} />;
            case 'stool':
                return <StoolContainer config={config} size={size} />;
            case 'swab':
                return <SwabIcon config={config} size={size} />;
            case 'radiology-xray':
                return <RadiologyIcon config={config} size={size} mode="xray" />;
            case 'radiology-ct':
                return <RadiologyIcon config={config} size={size} mode="ct" />;
            case 'radiology-usg':
                return <RadiologyIcon config={config} size={size} mode="usg" />;
            case 'vacutainer':
            default:
                return <VacutainerTube config={config} size={size} />;
        }
    };

    return (
        <div className={`inline-flex items-center gap-1.5 ${className}`}>
            <div className="flex items-center">
                {renderIcon()}
            </div>
            {showLabel && (
                <span className="text-xs font-medium text-gray-700 ml-1">
                    {config.label}
                </span>
            )}
        </div>
    );
};

// Helper component for displaying multiple sample types
export const SampleTypeGroup: React.FC<{
    samples: Array<{ sampleType: string; sampleColor?: string; count?: number }>;
    size?: 'sm' | 'md' | 'lg';
    maxDisplay?: number;
    labColors?: Record<string, string>;
}> = ({ samples, size = 'sm', maxDisplay = 3, labColors }) => {
    const uniqueSamples = Array.from(
        new Map(samples.map(s => [s.sampleType, s])).values()
    ).slice(0, maxDisplay);

    const remaining = samples.length - uniqueSamples.length;

    return (
        <div className="inline-flex items-center gap-1">
            {uniqueSamples.map((sample, idx) => (
                <div key={idx} className="relative">
                    <SampleTypeIndicator
                        sampleType={sample.sampleType}
                        sampleColor={sample.sampleColor}
                        size={size}
                        labColors={labColors}
                    />
                    {sample.count && sample.count > 1 && (
                        <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                            {sample.count}
                        </span>
                    )}
                </div>
            ))}
            {remaining > 0 && (
                <span className="text-xs text-gray-500 ml-1">+{remaining}</span>
            )}
        </div>
    );
};

export default SampleTypeIndicator;
