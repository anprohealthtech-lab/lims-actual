import React from 'react';
import { X, Beaker, AlertTriangle, Settings, Edit, Brain } from 'lucide-react';

interface Analyte {
  id: string;
  name: string;
  unit: string;
  referenceRange: string;
  lowCritical?: string | number;
  highCritical?: string | number;
  interpretation: {
    low: string;
    normal: string;
    high: string;
  };
  category: string;
  isActive: boolean;
  createdDate: string;
  aiProcessingType?: string;
  groupAiMode?: 'group_only' | 'individual' | 'both' | string;
  aiPromptOverride?: string;
  normalRangeMin?: number;
  normalRangeMax?: number;
  method?: string;
  description?: string;
  isCritical?: boolean;
  ref_range_knowledge?: { text_rules?: string };
  expected_normal_values?: string[];
}

interface AnalyteDetailModalProps {
  analyte: Analyte;
  onClose: () => void;
  onEdit: () => void;
}

const AnalyteDetailModal: React.FC<AnalyteDetailModalProps> = ({ analyte, onClose, onEdit }) => {
  const getCategoryColor = (category: string) => {
    const colors = {
      'Hematology': 'bg-red-100 text-red-800',
      'Biochemistry': 'bg-blue-100 text-blue-800',
      'Serology': 'bg-green-100 text-green-800',
      'Microbiology': 'bg-purple-100 text-purple-800',
      'Immunology': 'bg-orange-100 text-orange-800',
    };
    return colors[category as keyof typeof colors] || 'bg-gray-100 text-gray-800';
  };

  const getAIProcessingTypeLabel = (type?: string) => {
    const types = {
      'none': 'Manual Entry Only',
      'ocr_report': 'OCR Report Processing',
      'vision_card': 'Vision Card Analysis',
      'vision_color': 'Vision Color Analysis'
    };
    return types[type as keyof typeof types] || 'Not Configured';
  };

  const getAIProcessingTypeColor = (type?: string) => {
    const colors = {
      'none': 'bg-gray-100 text-gray-800',
      'ocr_report': 'bg-blue-100 text-blue-800',
      'vision_card': 'bg-green-100 text-green-800',
      'vision_color': 'bg-purple-100 text-purple-800'
    };
    return colors[type as keyof typeof colors] || 'bg-gray-100 text-gray-800';
  };

  const getGroupAiModeLabel = (mode?: 'group_only' | 'individual' | 'both') => {
    if (!mode) return 'Not Configured';
    if (mode === 'group_only') return 'Group Only';
    if (mode === 'individual') return 'Individual';
    return 'Both';
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900 flex items-center">
            <Beaker className="h-6 w-6 mr-2 text-blue-600" />
            Analyte Details
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500 p-1 rounded"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Analyte Summary */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-2xl font-bold text-gray-900">{analyte.name}</h3>
                <p className="text-gray-600">Analyte ID: {analyte.id}</p>
                <div className="flex items-center space-x-4 mt-2">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getCategoryColor(analyte.category)}`}>
                    {analyte.category}
                  </span>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    analyte.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {analyte.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-blue-600">{analyte.unit}</div>
                <div className="text-sm text-gray-600">Unit</div>
              </div>
            </div>
          </div>

          {/* Reference Information */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <Settings className="h-5 w-5 mr-2 text-blue-500" />
                Reference Values
              </h4>
              <div className="space-y-3">
                <div>
                  <div className="text-sm text-gray-600">Reference Range</div>
                  <div className="font-medium text-gray-900">{analyte.referenceRange}</div>
                </div>
                {(analyte.normalRangeMin !== undefined || analyte.normalRangeMax !== undefined) && (
                  <div>
                    <div className="text-sm text-gray-600">Numeric Range</div>
                    <div className="font-medium text-gray-900">
                      {analyte.normalRangeMin ?? '—'} - {analyte.normalRangeMax ?? '—'} {analyte.unit}
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-sm text-gray-600">Low Critical</div>
                  <div className="font-medium text-gray-900">{analyte.lowCritical || 'Not specified'}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">High Critical</div>
                  <div className="font-medium text-gray-900">{analyte.highCritical || 'Not specified'}</div>
                </div>
                {analyte.expected_normal_values && analyte.expected_normal_values.length > 0 && (
                  <div>
                    <div className="text-sm text-gray-600">Expected Values</div>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {analyte.expected_normal_values.map((val, idx) => (
                        <span key={idx} className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                          {val}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {analyte.ref_range_knowledge?.text_rules && (
                  <div>
                    <div className="text-sm text-gray-600">Reference Range Rules</div>
                    <div className="font-medium text-gray-900 whitespace-pre-wrap">
                      {analyte.ref_range_knowledge.text_rules}
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-sm text-gray-600">Created Date</div>
                  <div className="font-medium text-gray-900">{new Date(analyte.createdDate).toLocaleDateString()}</div>
                </div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <AlertTriangle className="h-5 w-5 mr-2 text-orange-500" />
                Critical Values
              </h4>
              <div className="space-y-3">
                {analyte.lowCritical && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <div className="text-sm font-medium text-red-800">Low Critical: {analyte.lowCritical}</div>
                    <div className="text-xs text-red-600 mt-1">Values below this require immediate attention</div>
                  </div>
                )}
                {analyte.highCritical && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <div className="text-sm font-medium text-red-800">High Critical: {analyte.highCritical}</div>
                    <div className="text-xs text-red-600 mt-1">Values above this require immediate attention</div>
                  </div>
                )}
                {!analyte.lowCritical && !analyte.highCritical && (
                  <div className="text-gray-500 text-sm">No critical values defined</div>
                )}
              </div>
            </div>
          </div>

          {/* Clinical Interpretation */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h4 className="text-lg font-semibold text-gray-900 mb-4">Clinical Interpretation</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h5 className="font-medium text-blue-900 mb-2">Low Values</h5>
                <p className="text-sm text-blue-800">{analyte.interpretation.low || 'No interpretation provided'}</p>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h5 className="font-medium text-green-900 mb-2">Normal Values</h5>
                <p className="text-sm text-green-800">{analyte.interpretation.normal || 'No interpretation provided'}</p>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <h5 className="font-medium text-red-900 mb-2">High Values</h5>
                <p className="text-sm text-red-800">{analyte.interpretation.high || 'No interpretation provided'}</p>
              </div>
            </div>
          </div>

          {/* AI Configuration */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Brain className="h-5 w-5 mr-2 text-purple-500" />
              AI Processing Configuration
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="text-sm text-gray-600">AI Processing Type</div>
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                  getAIProcessingTypeColor(analyte.aiProcessingType)
                }`}>
                  {getAIProcessingTypeLabel(analyte.aiProcessingType)}
                </span>
              </div>
              <div>
                <div className="text-sm text-gray-600">Group AI Mode</div>
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                  analyte.groupAiMode === 'group_only' ? 'bg-orange-100 text-orange-800' : 'bg-blue-100 text-blue-800'
                }`}>
                  {getGroupAiModeLabel(analyte.groupAiMode)}
                </span>
              </div>
              <div>
                <div className="text-sm text-gray-600">Custom AI Prompt</div>
                <div className="font-medium text-gray-900">
                  {analyte.aiPromptOverride ? 'Configured' : 'Using Default'}
                </div>
              </div>
            </div>
            
            {analyte.aiPromptOverride && (
              <div className="mt-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
                <h5 className="font-medium text-purple-900 mb-2">Custom AI Prompt</h5>
                <p className="text-sm text-purple-800 italic">
                  {analyte.aiPromptOverride}
                </p>
              </div>
            )}
            
            {analyte.aiProcessingType && analyte.aiProcessingType !== 'none' && (
              <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <h5 className="font-medium text-blue-900 mb-2">AI Capabilities</h5>
                <div className="text-sm text-blue-800 space-y-1">
                  {analyte.aiProcessingType === 'ocr_report' && (
                    <>
                      <div>• Text extraction from printed reports</div>
                      <div>• Instrument display recognition</div>
                      <div>• Automatic parameter matching</div>
                    </>
                  )}
                  {analyte.aiProcessingType === 'vision_card' && (
                    <>
                      <div>• Test card object detection</div>
                      <div>• Control/test line analysis</div>
                      <div>• Result interpretation</div>
                    </>
                  )}
                  {analyte.aiProcessingType === 'vision_color' && (
                    <>
                      <div>• Color pattern analysis</div>
                      <div>• Dominant color extraction</div>
                      <div>• Color-based result determination</div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Method & Notes */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Settings className="h-5 w-5 mr-2 text-blue-500" />
              Method & Notes
            </h4>
            <div className="space-y-3">
              <div>
                <div className="text-sm text-gray-600">Testing Method</div>
                <div className="font-medium text-gray-900">{analyte.method || 'Not specified'}</div>
              </div>
              <div>
                <div className="text-sm text-gray-600">Description & Notes</div>
                <div className="font-medium text-gray-900 whitespace-pre-wrap">
                  {analyte.description || 'No additional notes'}
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end space-x-4 pt-6 border-t border-gray-200">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Close
            </button>
            <button
              onClick={onEdit}
              className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              <Edit className="h-4 w-4 mr-2" />
              Edit Analyte
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AnalyteDetailModal;