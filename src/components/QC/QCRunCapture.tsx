/**
 * QCRunCapture Component
 *
 * Scan-first QC data capture with:
 * - Camera/file upload for analyzer screenshots
 * - Real-time OCR processing with Gemini Vision
 * - Auto-matching to lots and analytes
 * - Confidence indicators and manual correction
 * - One-click confirm to save
 */

import React, { useState, useRef, useCallback } from 'react';
import {
  Camera,
  Upload,
  X,
  Check,
  AlertCircle,
  Loader2,
  RefreshCw,
  Edit2,
  ChevronDown,
  Image,
  FileText,
  Sparkles,
  CheckCircle,
  XCircle,
  Info
} from 'lucide-react';
import { useQualityControl } from '../../hooks/useQualityControl';
import type {
  QCScanIntakeResponse,
  ExtractedResult,
  MatchingSuggestion
} from '../../types/qc';

interface QCRunCaptureProps {
  labId: string;
  onComplete?: (runId: string) => void;
  onCancel?: () => void;
  preselectedAnalyzer?: string;
  preselectedLot?: string;
}

type CaptureStep = 'capture' | 'processing' | 'review' | 'saving' | 'complete';

export const QCRunCapture: React.FC<QCRunCaptureProps> = ({
  labId,
  onComplete,
  onCancel,
  preselectedAnalyzer,
  preselectedLot
}) => {
  const [step, setStep] = useState<CaptureStep>('capture');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [extractedData, setExtractedData] = useState<QCScanIntakeResponse | null>(null);
  const [editedResults, setEditedResults] = useState<ExtractedResult[]>([]);
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);
  const [analyzerName, setAnalyzerName] = useState(preselectedAnalyzer || '');
  const [runDate, setRunDate] = useState(new Date().toISOString().split('T')[0]);
  const [runType, setRunType] = useState<string>('routine');
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const qc = useQualityControl();

  // Handle file selection
  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        setImagePreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  // Handle camera capture
  const handleCameraCapture = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        setImagePreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  // Process image with OCR
  const processImage = useCallback(async () => {
    if (!imagePreview) return;

    setStep('processing');
    setError(null);

    try {
      const result = await qc.scanAndExtract({
        base64Image: imagePreview,
        documentType: 'analyzer_screen',
        labId,
        analyzerName: analyzerName || undefined,
        runDate,
        lotNumber: preselectedLot || undefined,
        runType: runType as any
      });

      if (result?.success) {
        setExtractedData(result);
        setEditedResults(result.extracted_data.results || []);

        // Set analyzer name if extracted
        if (result.extracted_data.analyzer_name && !analyzerName) {
          setAnalyzerName(result.extracted_data.analyzer_name);
        }

        // Set selected lot if matched
        if (result.matching_results.lot_matched && result.matching_results.lot_id) {
          setSelectedLotId(result.matching_results.lot_id);
        }

        setStep('review');
      } else {
        setError('Failed to extract QC data from image');
        setStep('capture');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Processing failed');
      setStep('capture');
    }
  }, [imagePreview, labId, analyzerName, runDate, preselectedLot, runType, qc]);

  // Update a result value
  const updateResult = useCallback((index: number, field: string, value: any) => {
    setEditedResults(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  }, []);

  // Save QC run
  const saveQCRun = useCallback(async () => {
    if (!extractedData?.qc_run_id) {
      setError('No QC run created');
      return;
    }

    setStep('saving');

    try {
      // The run and results are already created by the scan-intake function
      // Just need to update with any corrections
      // TODO: Add correction tracking here

      setStep('complete');
      onComplete?.(extractedData.qc_run_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setStep('review');
    }
  }, [extractedData, onComplete]);

  // Reset and start over
  const reset = useCallback(() => {
    setStep('capture');
    setImagePreview(null);
    setImageFile(null);
    setExtractedData(null);
    setEditedResults([]);
    setSelectedLotId(null);
    setError(null);
  }, []);

  // Confidence color helper
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.9) return 'text-green-600 bg-green-50';
    if (confidence >= 0.7) return 'text-yellow-600 bg-yellow-50';
    return 'text-red-600 bg-red-50';
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Camera className="h-6 w-6 text-white" />
            <h2 className="text-xl font-bold text-white">Scan QC Data</h2>
          </div>
          <button
            onClick={onCancel}
            className="text-white hover:bg-white hover:bg-opacity-20 rounded-full p-2"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Step: Capture */}
          {step === 'capture' && (
            <div className="space-y-6">
              {/* Run Settings */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Run Date
                  </label>
                  <input
                    type="date"
                    value={runDate}
                    onChange={(e) => setRunDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Analyzer (Optional)
                  </label>
                  <input
                    type="text"
                    value={analyzerName}
                    onChange={(e) => setAnalyzerName(e.target.value)}
                    placeholder="Will be auto-detected"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Run Type
                  </label>
                  <select
                    value={runType}
                    onChange={(e) => setRunType(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  >
                    <option value="routine">Routine</option>
                    <option value="calibration_verification">Calibration Verification</option>
                    <option value="new_lot">New Lot</option>
                    <option value="maintenance">After Maintenance</option>
                    <option value="troubleshooting">Troubleshooting</option>
                  </select>
                </div>
              </div>

              {/* Image Preview or Capture Options */}
              {imagePreview ? (
                <div className="relative">
                  <img
                    src={imagePreview}
                    alt="QC Screenshot"
                    className="w-full max-h-96 object-contain rounded-lg border border-gray-200"
                  />
                  <button
                    onClick={reset}
                    className="absolute top-2 right-2 p-2 bg-white rounded-full shadow hover:bg-gray-100"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="border-2 border-dashed border-gray-300 rounded-xl p-12 text-center">
                  <div className="flex justify-center space-x-6">
                    {/* Camera Button */}
                    <button
                      onClick={() => cameraInputRef.current?.click()}
                      className="flex flex-col items-center p-6 bg-indigo-50 rounded-xl hover:bg-indigo-100 transition-colors"
                    >
                      <Camera className="h-12 w-12 text-indigo-600 mb-3" />
                      <span className="text-sm font-medium text-indigo-700">Take Photo</span>
                      <span className="text-xs text-gray-500 mt-1">Use camera</span>
                    </button>

                    {/* Upload Button */}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex flex-col items-center p-6 bg-purple-50 rounded-xl hover:bg-purple-100 transition-colors"
                    >
                      <Upload className="h-12 w-12 text-purple-600 mb-3" />
                      <span className="text-sm font-medium text-purple-700">Upload Image</span>
                      <span className="text-xs text-gray-500 mt-1">PNG, JPG, PDF</span>
                    </button>
                  </div>

                  <p className="mt-6 text-sm text-gray-500">
                    Take a photo of your analyzer screen or upload a QC printout
                  </p>
                </div>
              )}

              {/* Hidden File Inputs */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf"
                onChange={handleFileSelect}
                className="hidden"
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleCameraCapture}
                className="hidden"
              />

              {/* Error Message */}
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start">
                  <AlertCircle className="h-5 w-5 text-red-500 mr-3 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="font-medium text-red-800">Error</div>
                    <div className="text-sm text-red-600">{error}</div>
                  </div>
                </div>
              )}

              {/* Process Button */}
              {imagePreview && (
                <button
                  onClick={processImage}
                  className="w-full py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg font-medium hover:from-indigo-700 hover:to-purple-700 flex items-center justify-center"
                >
                  <Sparkles className="h-5 w-5 mr-2" />
                  Extract QC Data with AI
                </button>
              )}
            </div>
          )}

          {/* Step: Processing */}
          {step === 'processing' && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="relative">
                <Loader2 className="h-16 w-16 text-indigo-600 animate-spin" />
                <Sparkles className="h-6 w-6 text-purple-500 absolute -top-1 -right-1 animate-pulse" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mt-6">Processing Image</h3>
              <p className="text-gray-500 mt-2">Extracting QC data with AI...</p>
              <div className="mt-4 flex items-center space-x-2 text-sm text-gray-400">
                <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}

          {/* Step: Review */}
          {step === 'review' && extractedData && (
            <div className="space-y-6">
              {/* Extraction Summary */}
              <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <CheckCircle className="h-6 w-6 text-green-600" />
                    <div>
                      <div className="font-semibold text-gray-900">Extraction Complete</div>
                      <div className="text-sm text-gray-600">
                        {editedResults.length} analytes extracted •
                        Confidence: {((extractedData.extraction_confidence || 0) * 100).toFixed(0)}%
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={reset}
                    className="text-sm text-indigo-600 hover:text-indigo-800 flex items-center"
                  >
                    <RefreshCw className="h-4 w-4 mr-1" />
                    Rescan
                  </button>
                </div>
              </div>

              {/* Warnings */}
              {extractedData.warnings && extractedData.warnings.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <div className="flex items-start">
                    <AlertCircle className="h-5 w-5 text-yellow-600 mr-3 flex-shrink-0" />
                    <div>
                      <div className="font-medium text-yellow-800">Attention Needed</div>
                      <ul className="mt-1 text-sm text-yellow-700 list-disc list-inside">
                        {extractedData.warnings.map((warning, idx) => (
                          <li key={idx}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* Extracted Info */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-500 uppercase">Analyzer</div>
                  <div className="font-medium text-gray-900 mt-1">
                    {extractedData.extracted_data.analyzer_name || analyzerName || 'Unknown'}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-500 uppercase">Lot Number</div>
                  <div className="font-medium text-gray-900 mt-1">
                    {extractedData.extracted_data.lot_number || 'Not detected'}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-500 uppercase">Level</div>
                  <div className="font-medium text-gray-900 mt-1">
                    {extractedData.extracted_data.level || 'Not detected'}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-500 uppercase">Lot Match</div>
                  <div className="mt-1">
                    {extractedData.matching_results.lot_matched ? (
                      <span className="text-green-600 font-medium flex items-center">
                        <CheckCircle className="h-4 w-4 mr-1" />
                        Matched
                      </span>
                    ) : (
                      <span className="text-yellow-600 font-medium flex items-center">
                        <AlertCircle className="h-4 w-4 mr-1" />
                        Manual Select
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Results Table */}
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Analyte</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Value</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Unit</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Match</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Confidence</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {editedResults.map((result, idx) => {
                      const analyteMatch = extractedData.matching_results.analyte_matches[result.analyte_name];
                      return (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <input
                              type="text"
                              value={result.analyte_name}
                              onChange={(e) => updateResult(idx, 'analyte_name', e.target.value)}
                              className="w-full px-2 py-1 border border-gray-200 rounded text-sm"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              value={result.observed_value}
                              onChange={(e) => updateResult(idx, 'observed_value', parseFloat(e.target.value))}
                              className="w-24 px-2 py-1 border border-gray-200 rounded text-sm"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="text"
                              value={result.unit || ''}
                              onChange={(e) => updateResult(idx, 'unit', e.target.value)}
                              className="w-20 px-2 py-1 border border-gray-200 rounded text-sm"
                            />
                          </td>
                          <td className="px-4 py-3">
                            {analyteMatch?.matched ? (
                              <span className="inline-flex items-center text-green-600 text-sm">
                                <CheckCircle className="h-4 w-4 mr-1" />
                                Matched
                              </span>
                            ) : (
                              <span className="inline-flex items-center text-yellow-600 text-sm">
                                <AlertCircle className="h-4 w-4 mr-1" />
                                Review
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${getConfidenceColor(result.confidence)}`}>
                              {(result.confidence * 100).toFixed(0)}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Step: Saving */}
          {step === 'saving' && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-12 w-12 text-indigo-600 animate-spin" />
              <h3 className="text-lg font-semibold text-gray-900 mt-6">Saving QC Run</h3>
              <p className="text-gray-500 mt-2">Creating QC results and evaluating Westgard rules...</p>
            </div>
          )}

          {/* Step: Complete */}
          {step === 'complete' && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mt-6">QC Run Saved Successfully</h3>
              <p className="text-gray-500 mt-2">
                {editedResults.length} results created. Westgard rules have been evaluated.
              </p>
              <button
                onClick={() => onComplete?.(extractedData?.qc_run_id || '')}
                className="mt-6 px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                View QC Run
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'review' && (
          <div className="border-t border-gray-200 px-6 py-4 bg-gray-50 flex items-center justify-between">
            <button
              onClick={reset}
              className="px-4 py-2 text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
            <button
              onClick={saveQCRun}
              className="px-6 py-2 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-lg font-medium hover:from-green-700 hover:to-emerald-700 flex items-center"
            >
              <Check className="h-4 w-4 mr-2" />
              Confirm & Save
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default QCRunCapture;
