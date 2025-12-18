import React, { useState } from 'react';
import { X, Beaker, AlertTriangle, Settings, Brain, Calculator } from 'lucide-react';

interface AnalyteFormProps {
  onClose: () => void;
  onSubmit: (data: any) => void;
  analyte?: Analyte | null;
}

interface Analyte {
  id: string;
  name: string;
  unit: string;
  referenceRange: string;
  lowCritical?: string;
  highCritical?: string;
  interpretation: {
    low: string;
    normal: string;
    high: string;
  };
  category: string;
  isActive: boolean;
  createdDate: string;
  aiProcessingType?: string;
  groupAiMode?: 'group_only' | 'individual' | 'both';
  aiPromptOverride?: string;
  // Calculated parameter fields
  isCalculated?: boolean;
  formula?: string;
  formulaVariables?: string[];
  formulaDescription?: string;
}

const AnalyteForm: React.FC<AnalyteFormProps> = ({ onClose, onSubmit, analyte }) => {
  const [formData, setFormData] = useState({
    name: analyte?.name || '',
    unit: analyte?.unit || '',
    referenceRange: analyte?.referenceRange || '',
    lowCritical: analyte?.lowCritical || '',
    highCritical: analyte?.highCritical || '',
    category: analyte?.category || '',
    interpretationLow: analyte?.interpretation?.low || '',
    interpretationNormal: analyte?.interpretation?.normal || '',
    interpretationHigh: analyte?.interpretation?.high || '',
    isActive: analyte?.isActive ?? true,
    groupAiMode: analyte?.groupAiMode || 'individual',
    aiProcessingType: analyte?.aiProcessingType || 'ocr_report',
    aiPromptOverride: analyte?.aiPromptOverride || '',
    // Calculated parameter fields
    isCalculated: analyte?.isCalculated || false,
    formula: analyte?.formula || '',
    formulaVariables: analyte?.formulaVariables?.join(', ') || '',
    formulaDescription: analyte?.formulaDescription || '',
  });

  const categories = [
    'Hematology',
    'Biochemistry', 
    'Serology',
    'Microbiology',
    'Immunology',
    'Molecular Biology',
    'Histopathology',
    'Cytology',
  ];

  const aiProcessingTypes = [
    { value: 'none', label: 'None - Manual Entry Only', description: 'No AI processing for this analyte' },
    { value: 'ocr_report', label: 'OCR Report Processing', description: 'Extract values from printed reports and instrument displays' },
    { value: 'vision_card', label: 'Vision Card Analysis', description: 'Analyze test cards and lateral flow devices' },
    { value: 'vision_color', label: 'Vision Color Analysis', description: 'Color-based analysis for strips and visual tests' },
  ];
  
  const groupAiModes = [
    { value: 'individual', label: 'Individual Analyte Processing', description: 'AI processes this analyte independently.' },
    { value: 'group_only', label: 'Group-Level Processing Only', description: 'AI processes this analyte only as part of a test group.' },
    { value: 'both', label: 'Both Individual & Group Processing', description: 'AI can process this analyte individually or as part of a group.' },
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      interpretation: {
        low: formData.interpretationLow,
        normal: formData.interpretationNormal,
        high: formData.interpretationHigh,
      },
      // Parse formula variables from comma-separated string
      formulaVariables: formData.formulaVariables
        ? formData.formulaVariables.split(',').map(v => v.trim()).filter(Boolean)
        : [],
    });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value
    }));
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900 flex items-center">
            <Beaker className="h-6 w-6 mr-2 text-blue-600" />
            {analyte ? 'Edit Analyte' : 'Add New Analyte'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500 p-1 rounded"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Basic Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900 flex items-center">
              <Settings className="h-5 w-5 mr-2" />
              Basic Information
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Analyte Name *
                </label>
                <input
                  type="text"
                  name="name"
                  required
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="e.g., Hemoglobin"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Category *
                </label>
                <select
                  name="category"
                  required
                  value={formData.category}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select Category</option>
                  {categories.map(category => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Unit *
                </label>
                <input
                  type="text"
                  name="unit"
                  required
                  value={formData.unit}
                  onChange={handleChange}
                  placeholder="e.g., g/dL, mg/dL, /μL"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reference Range *
                </label>
                <input
                  type="text"
                  name="referenceRange"
                  required
                  value={formData.referenceRange}
                  onChange={handleChange}
                  placeholder="e.g., 12.0-16.0 or M: 13.5-17.5, F: 12.0-16.0"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>

          {/* Critical Values */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900 flex items-center">
              <AlertTriangle className="h-5 w-5 mr-2 text-red-500" />
              Critical Values
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Low Critical Value
                </label>
                <input
                  type="text"
                  name="lowCritical"
                  value={formData.lowCritical}
                  onChange={handleChange}
                  placeholder="e.g., 7.0"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  High Critical Value
                </label>
                <input
                  type="text"
                  name="highCritical"
                  value={formData.highCritical}
                  onChange={handleChange}
                  placeholder="e.g., 20.0"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>

          {/* Clinical Interpretation */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900">Clinical Interpretation</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Low Values Interpretation
                </label>
                <textarea
                  name="interpretationLow"
                  rows={2}
                  value={formData.interpretationLow}
                  onChange={handleChange}
                  placeholder="Clinical significance of low values"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Normal Values Interpretation
                </label>
                <textarea
                  name="interpretationNormal"
                  rows={2}
                  value={formData.interpretationNormal}
                  onChange={handleChange}
                  placeholder="Clinical significance of normal values"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  High Values Interpretation
                </label>
                <textarea
                  name="interpretationHigh"
                  rows={2}
                  value={formData.interpretationHigh}
                  onChange={handleChange}
                  placeholder="Clinical significance of high values"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>

          {/* Settings */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900 flex items-center">
              <Settings className="h-5 w-5 mr-2" />
              Analyte Settings
            </h3>
            
            <div className="space-y-3">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  name="isActive"
                  checked={formData.isActive}
                  onChange={handleChange}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="ml-2 text-sm text-gray-700">Analyte is active and available for use</span>
              </label>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  name="isCalculated"
                  checked={formData.isCalculated}
                  onChange={handleChange}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="ml-2 text-sm text-gray-700">This is a calculated parameter (value derived from formula)</span>
              </label>
            </div>
          </div>

          {/* Calculated Parameter Configuration */}
          {formData.isCalculated && (
            <div className="space-y-4 bg-amber-50 border border-amber-200 rounded-lg p-4">
              <h3 className="text-lg font-medium text-gray-900 flex items-center">
                <Calculator className="h-5 w-5 mr-2 text-amber-600" />
                Formula Configuration
              </h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Formula *
                  </label>
                  <input
                    type="text"
                    name="formula"
                    value={formData.formula}
                    onChange={handleChange}
                    placeholder="e.g., TC - HDL - (TG / 5)"
                    required={formData.isCalculated}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent font-mono"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Use variable names that match source analytes. Supports: +, -, *, /, parentheses, sqrt(), pow(), abs(), round()
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Variable Names (comma-separated) *
                  </label>
                  <input
                    type="text"
                    name="formulaVariables"
                    value={formData.formulaVariables}
                    onChange={handleChange}
                    placeholder="e.g., TC, HDL, TG"
                    required={formData.isCalculated}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    These variables must be linked to source analytes in the Dependencies section (after saving)
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Formula Description
                  </label>
                  <textarea
                    name="formulaDescription"
                    rows={2}
                    value={formData.formulaDescription}
                    onChange={handleChange}
                    placeholder="e.g., LDL Cholesterol calculated using Friedewald equation"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  />
                </div>

                {/* Formula Preview */}
                <div className="bg-white border border-amber-300 rounded-lg p-3">
                  <h4 className="text-sm font-medium text-amber-900 mb-2">Formula Preview</h4>
                  <div className="text-sm text-amber-800 font-mono bg-amber-100 p-2 rounded">
                    {formData.formula || '(No formula entered)'}
                  </div>
                  {formData.formulaVariables && (
                    <div className="mt-2 text-xs text-amber-700">
                      <strong>Variables:</strong> {formData.formulaVariables.split(',').map(v => v.trim()).filter(Boolean).join(', ') || 'None'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* AI Configuration */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900 flex items-center">
              <Brain className="h-5 w-5 mr-2 text-purple-600" />
              AI Processing Configuration
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  AI Processing Type
                </label>
                <select
                  name="aiProcessingType"
                  value={formData.aiProcessingType}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {aiProcessingTypes.map(type => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
                <div className="text-xs text-gray-500 mt-1">
                  {aiProcessingTypes.find(t => t.value === formData.aiProcessingType)?.description}
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Group AI Mode
                </label>
                <select
                  name="groupAiMode"
                  value={formData.groupAiMode}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {groupAiModes.map(mode => (
                    <option key={mode.value} value={mode.value}>{mode.label}</option>
                  ))}
                </select>
                <div className="text-xs text-gray-500 mt-1">{groupAiModes.find(m => m.value === formData.groupAiMode)?.description}</div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Custom AI Prompt (Optional)
                </label>
                <textarea
                  name="aiPromptOverride"
                  rows={4}
                  value={formData.aiPromptOverride}
                  onChange={handleChange}
                  placeholder="Enter custom prompt for AI processing. Leave empty to use default prompts."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <div className="text-xs text-gray-500 mt-1">
                  Custom prompts override default AI behavior for this specific analyte
                </div>
              </div>
              
              {/* AI Configuration Preview */}
              {formData.aiProcessingType !== 'none' && (
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                  <h4 className="text-sm font-medium text-purple-900 mb-2">AI Configuration Preview</h4>
                  <div className="text-xs text-purple-800 space-y-1">
                    <div><strong>Processing Type:</strong> {aiProcessingTypes.find(t => t.value === formData.aiProcessingType)?.label}</div>
                    <div><strong>Vision API Features:</strong> {
                      formData.aiProcessingType === 'ocr_report' ? 'Text Detection' :
                      formData.aiProcessingType === 'vision_card' ? 'Object Detection' :
                      formData.aiProcessingType === 'vision_color' ? 'Color Analysis' : 'None'
                    }</div>
                    <div><strong>Custom Prompt:</strong> {formData.aiPromptOverride ? 'Yes' : 'Default'}</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-end space-x-4 pt-6 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              {analyte ? 'Update Analyte' : 'Add Analyte'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AnalyteForm;