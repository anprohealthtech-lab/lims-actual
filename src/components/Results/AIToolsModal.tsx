import React, { useState, useEffect } from 'react';
import { X, Brain, Camera, FileText, Zap, Upload, Eye, CheckCircle, AlertTriangle, Target } from 'lucide-react';
import { attachments } from '../../utils/supabase';
import { useEscapeModalClose } from '../../hooks/useEscapeModalClose';

interface AIToolsModalProps {
  isOpen: boolean;
  onClose: () => void;
  patient: {
    id: string;
    name: string;
  };
  result: {
    id: string;
    testName: string;
    values: { parameter: string; value: string; unit: string; reference: string; flag?: string }[];
    attachmentId?: string; // Link to source document for OCR-extracted results
  };
  onAIResultGenerated: (aiData: any) => void;
}

const getFlagDisplay = (flag?: string) => {
  const rawFlag = flag || '';
  const normalizedFlag = rawFlag.trim().toLowerCase();

  if (['critical_h', 'critical high', 'critical_high', 'ch', 'h*', 'hh'].includes(normalizedFlag)) {
    return { label: 'Critical High', className: 'bg-red-100 text-red-800' };
  }

  if (['critical_l', 'critical low', 'critical_low', 'cl', 'l*', 'll'].includes(normalizedFlag)) {
    return { label: 'Critical Low', className: 'bg-blue-100 text-blue-800' };
  }

  if (normalizedFlag === 'h' || normalizedFlag === 'high') {
    return { label: 'High', className: 'bg-red-100 text-red-800' };
  }

  if (normalizedFlag === 'l' || normalizedFlag === 'low') {
    return { label: 'Low', className: 'bg-blue-100 text-blue-800' };
  }

  return { label: rawFlag, className: 'bg-yellow-100 text-yellow-800' };
};

const AIToolsModal: React.FC<AIToolsModalProps> = ({ 
  isOpen, 
  onClose, 
  patient, 
  result, 
  onAIResultGenerated 
}) => {
  useEscapeModalClose(onClose, isOpen);
  // Initialize with document tab if attachmentId exists, otherwise photo tab
  const [activeTab, setActiveTab] = useState(() => {
    if (result.attachmentId) {
      console.log('Initializing with document tab, attachmentId:', result.attachmentId);
      return 'document';
    }
    return 'photo';
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [aiResults, setAIResults] = useState<any>(null);
  const [confidence, setConfidence] = useState<number>(0);
  const [processingSteps, setProcessingSteps] = useState<string[]>([]);
  const [documentData, setDocumentData] = useState<any>(null);
  const [loadingDocument, setLoadingDocument] = useState(false);

  // Load document data when attachmentId is available
  useEffect(() => {
    const loadDocumentData = async () => {
      if (result.attachmentId) {
        console.log('Loading document data for attachmentId:', result.attachmentId);
        setLoadingDocument(true);
        try {
          const { data: attachment, error } = await attachments.getById(result.attachmentId);
          if (error) {
            console.error('Error loading attachment:', error);
          } else {
            console.log('Successfully loaded attachment:', attachment);
            setDocumentData(attachment);
          }
        } catch (error) {
          console.error('Error fetching document:', error);
        } finally {
          setLoadingDocument(false);
        }
      } else {
        console.log('No attachmentId found for result:', result.id);
      }
    };

    loadDocumentData();
  }, [result.attachmentId]); // Remove activeTab dependency

  const aiTools = [
    {
      id: 'photo',
      name: 'Photo Analysis',
      description: 'Analyze test cards and strips using AI',
      icon: Camera,
      color: 'blue',
      features: ['Blood grouping cards', 'Lateral flow tests', 'COVID test strips'],
    },
    {
      id: 'ocr',
      name: 'OCR Extraction',
      description: 'Extract results from instrument displays',
      icon: FileText,
      color: 'green',
      features: ['Screen capture', 'PDF parsing', 'Auto data entry'],
    },
    {
      id: 'document',
      name: 'Source Document',
      description: 'View the original document this result was extracted from',
      icon: Eye,
      color: 'indigo',
      features: ['Original document view', 'AI extraction details', 'Document metadata'],
    },
    {
      id: 'validation',
      name: 'Result Validation',
      description: 'AI-powered quality control and validation',
      icon: Target,
      color: 'purple',
      features: ['Anomaly detection', 'Reference range validation', 'Critical value alerts'],
    },
  ];

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setAIResults(null);
      setProcessingSteps([]);
      setConfidence(0);
    }
  };

  const processWithAI = async () => {
    if (!selectedFile && activeTab !== 'validation') return;
    
    setProcessing(true);
    setProcessingSteps([]);
    setConfidence(0);
    
    const steps = [
      'Initializing AI analysis...',
      'Processing input data...',
      'Applying machine learning models...',
      'Validating results...',
      'Generating confidence scores...',
      'Preparing integration data...',
    ];

    for (let i = 0; i < steps.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 600));
      setProcessingSteps(prev => [...prev, steps[i]]);
      setConfidence((i + 1) / steps.length * 100);
    }
    
    // Simulate AI analysis results
    setTimeout(() => {
      let mockResults;
      
      if (activeTab === 'photo') {
        mockResults = {
          type: 'photo_analysis',
          detectedTest: 'Blood Group Card',
          results: [
            { parameter: 'ABO Group', value: 'B', confidence: 0.98 },
            { parameter: 'Rh Factor', value: 'Positive', confidence: 0.97 },
          ],
          qualityScore: 0.95,
          recommendations: ['Results match expected pattern', 'High confidence detection'],
          linkedToPatient: patient.id,
          linkedToResult: result.id,
        };
      } else if (activeTab === 'ocr') {
        mockResults = {
          type: 'ocr_extraction',
          extractedData: result.values.map(v => ({
            parameter: v.parameter,
            extractedValue: v.value,
            confidence: 0.94 + Math.random() * 0.05,
            originalValue: v.value,
            match: true,
          })),
          documentType: 'Instrument Display',
          qualityScore: 0.92,
          recommendations: ['All values extracted successfully', 'High OCR accuracy'],
          linkedToPatient: patient.id,
          linkedToResult: result.id,
        };
      } else {
        mockResults = {
          type: 'result_validation',
          validationResults: result.values.map(v => ({
            parameter: v.parameter,
            value: v.value,
            validationStatus: 'PASS',
            confidence: 0.96,
            flags: v.flag ? [v.flag] : [],
            recommendations: v.flag ? ['Value outside normal range - clinical correlation recommended'] : ['Value within normal limits'],
          })),
          overallScore: 0.94,
          criticalFindings: result.values.filter(v => v.flag).length,
          recommendations: ['Review flagged values', 'Consider clinical context'],
          linkedToPatient: patient.id,
          linkedToResult: result.id,
        };
      }
      
      setAIResults(mockResults);
      setProcessing(false);
    }, 300);
  };

  const handleIntegrateResults = () => {
    if (aiResults) {
      onAIResultGenerated(aiResults);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 flex items-center">
              <Brain className="h-6 w-6 mr-2 text-purple-600" />
              AI Tools for {patient.name}
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Test: {result.testName} • Result ID: {result.id}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500 p-1 rounded"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="p-6">
          {/* Tool Selection Tabs */}
          <div className="bg-gray-50 rounded-lg p-1 mb-6">
            <div className="flex space-x-1">
              {aiTools
                .filter(tool => tool.id !== 'document' || result.attachmentId) // Only show document tab if attachmentId exists
                .map((tool) => (
                <button
                  key={tool.id}
                  onClick={() => {
                    setActiveTab(tool.id);
                    setAIResults(null);
                    setConfidence(0);
                    setProcessingSteps([]);
                    setSelectedFile(null);
                  }}
                  className={`
                    flex-1 flex items-center justify-center px-4 py-3 rounded-md text-sm font-medium transition-all
                    ${activeTab === tool.id
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }
                  `}
                >
                  <tool.icon className="h-4 w-4 mr-2" />
                  {tool.name}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left Column - Input */}
            <div className="space-y-6">
              {/* Tool Description */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="font-medium text-blue-900 mb-2">
                  {aiTools.find(t => t.id === activeTab)?.name}
                </h3>
                <p className="text-sm text-blue-800 mb-3">
                  {aiTools.find(t => t.id === activeTab)?.description}
                </p>
                <div className="flex flex-wrap gap-1">
                  {aiTools.find(t => t.id === activeTab)?.features.map((feature, index) => (
                    <span key={index} className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      {feature}
                    </span>
                  ))}
                </div>
              </div>

              {/* File Upload for Photo/OCR */}
              {(activeTab === 'photo' || activeTab === 'ocr') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    Upload {activeTab === 'photo' ? 'Test Image' : 'Document/Screenshot'}
                  </label>
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-gray-400 transition-colors bg-gray-50">
                    {selectedFile ? (
                      <div className="space-y-4">
                        <div className="flex items-center justify-center">
                          <div className="bg-green-100 p-4 rounded-full">
                            <FileText className="h-12 w-12 text-green-500" />
                          </div>
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-900">{selectedFile.name}</div>
                          <div className="text-xs text-gray-500">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</div>
                        </div>
                        <button
                          onClick={() => document.getElementById('file-upload')?.click()}
                          className="text-blue-600 hover:text-blue-700 text-sm font-medium bg-blue-50 px-3 py-1 rounded"
                        >
                          Change File
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="flex justify-center">
                          <div className="bg-blue-100 p-4 rounded-full">
                            <Upload className="h-12 w-12 text-blue-600" />
                          </div>
                        </div>
                        <div>
                          <button
                            onClick={() => document.getElementById('file-upload')?.click()}
                            className="flex items-center justify-center mx-auto px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                          >
                            <Upload className="h-5 w-5 mr-2" />
                            Choose File
                          </button>
                          <p className="text-sm text-gray-500 mt-3">
                            Supports JPG, PNG, PDF (max 10MB)
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                  <input
                    id="file-upload"
                    type="file"
                    accept="image/*,.pdf"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </div>
              )}

              {/* Current Result Data for Validation */}
              {activeTab === 'validation' && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <h3 className="font-medium text-gray-900 mb-3">Current Result Data</h3>
                  <div className="space-y-2">
                    {result.values.map((value, index) => (
                      <div key={index} className="flex justify-between items-center text-sm">
                        <span className="text-gray-700">{value.parameter}:</span>
                        <div className="flex items-center space-x-2">
                          <span className="font-medium">{value.value} {value.unit}</span>
                          {value.flag && (() => {
                            const flagDisplay = getFlagDisplay(value.flag);
                            return (
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${flagDisplay.className}`}>
                                {flagDisplay.label}
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Source Document Preview */}
              {activeTab === 'document' && (
                <div className="space-y-4">
                  {!result.attachmentId ? (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                      <div className="flex items-center">
                        <AlertTriangle className="h-5 w-5 text-yellow-500 mr-3" />
                        <div>
                          <h4 className="font-medium text-yellow-900">No Source Document</h4>
                          <p className="text-sm text-yellow-700 mt-1">
                            This result was not extracted from a document using AI OCR.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : loadingDocument ? (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <div className="flex items-center">
                        <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-600 border-t-transparent mr-3"></div>
                        <span className="text-blue-900">Loading document...</span>
                      </div>
                    </div>
                  ) : documentData ? (
                    <div className="space-y-4">
                      {/* Document Metadata */}
                      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
                        <h4 className="font-medium text-indigo-900 mb-3 flex items-center">
                          <FileText className="h-5 w-5 mr-2" />
                          Document Information
                        </h4>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <div className="text-indigo-700">Original Filename:</div>
                            <div className="font-medium text-indigo-900">{documentData.original_filename}</div>
                          </div>
                          <div>
                            <div className="text-indigo-700">File Type:</div>
                            <div className="font-medium text-indigo-900">{documentData.file_type}</div>
                          </div>
                          <div>
                            <div className="text-indigo-700">Upload Date:</div>
                            <div className="font-medium text-indigo-900">
                              {new Date(documentData.upload_timestamp).toLocaleDateString()}
                            </div>
                          </div>
                          <div>
                            <div className="text-indigo-700">File Size:</div>
                            <div className="font-medium text-indigo-900">
                              {(documentData.file_size / 1024 / 1024).toFixed(2)} MB
                            </div>
                          </div>
                          {documentData.description && (
                            <div className="col-span-2">
                              <div className="text-indigo-700">Description:</div>
                              <div className="font-medium text-indigo-900">{documentData.description}</div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Document Preview */}
                      <div className="bg-white border border-gray-200 rounded-lg p-4">
                        <h4 className="font-medium text-gray-900 mb-3 flex items-center">
                          <Eye className="h-5 w-5 mr-2" />
                          Document Preview
                        </h4>
                        {documentData.file_type?.startsWith('image/') ? (
                          <div className="text-center">
                            <img
                              src={documentData.file_url}
                              alt={documentData.original_filename}
                              className="max-w-full max-h-96 mx-auto rounded-lg shadow-sm border border-gray-200"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                                e.currentTarget.nextElementSibling?.removeAttribute('hidden');
                              }}
                            />
                            <div hidden className="text-gray-500 p-8">
                              <FileText className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                              <p>Unable to load image preview</p>
                            </div>
                          </div>
                        ) : documentData.file_type === 'application/pdf' ? (
                          <div className="text-center p-8 bg-gray-50 rounded-lg">
                            <FileText className="h-12 w-12 mx-auto mb-3 text-gray-400" />
                            <p className="text-gray-600 mb-3">PDF Document</p>
                            <a
                              href={documentData.file_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                            >
                              <Eye className="h-4 w-4 mr-2" />
                              Open PDF
                            </a>
                          </div>
                        ) : (
                          <div className="text-center p-8 bg-gray-50 rounded-lg">
                            <FileText className="h-12 w-12 mx-auto mb-3 text-gray-400" />
                            <p className="text-gray-600 mb-3">Document type: {documentData.file_type}</p>
                            <a
                              href={documentData.file_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                            >
                              <Eye className="h-4 w-4 mr-2" />
                              View Document
                            </a>
                          </div>
                        )}
                      </div>

                      {/* AI Extraction Summary */}
                      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                        <h4 className="font-medium text-green-900 mb-3 flex items-center">
                          <Brain className="h-5 w-5 mr-2" />
                          AI Extraction Summary
                        </h4>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <div className="text-green-700">Parameters Extracted:</div>
                            <div className="font-medium text-green-900">{result.values.length}</div>
                          </div>
                          <div>
                            <div className="text-green-700">Extraction Method:</div>
                            <div className="font-medium text-green-900">AI OCR + NLP</div>
                          </div>
                        </div>
                        <div className="mt-3">
                          <div className="text-green-700 text-sm">Extracted Parameters:</div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {result.values.map((param, index) => (
                              <span key={index} className="inline-flex items-center px-2 py-1 rounded text-xs bg-green-100 text-green-800">
                                {param.parameter}: {param.value} {param.unit}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                      <div className="flex items-center">
                        <AlertTriangle className="h-5 w-5 text-red-500 mr-3" />
                        <div>
                          <h4 className="font-medium text-red-900">Document Not Found</h4>
                          <p className="text-sm text-red-700 mt-1">
                            The source document could not be loaded.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Process Button */}
              {activeTab !== 'document' && (
                <button
                  onClick={processWithAI}
                  disabled={processing || ((activeTab === 'photo' || activeTab === 'ocr') && !selectedFile)}
                className="w-full flex items-center justify-center px-6 py-4 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 disabled:from-gray-400 disabled:to-gray-400 disabled:cursor-not-allowed transition-all shadow-lg"
              >
                {processing ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent mr-3"></div>
                    Processing with AI...
                  </>
                ) : (
                  <>
                    <Zap className="h-5 w-5 mr-3" />
                    <Brain className="h-4 w-4 mr-2" />
                    Analyze with AI
                  </>
                )}
              </button>
              )}

              {/* Processing Progress */}
              {processing && (
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                  <div className="flex items-center mb-3">
                    <Brain className="h-5 w-5 text-purple-600 mr-2" />
                    <span className="font-medium text-purple-900">AI Processing Pipeline</span>
                  </div>
                  <div className="space-y-2">
                    {processingSteps.map((step, index) => (
                      <div key={index} className="flex items-center text-sm text-purple-800">
                        <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
                        {step}
                      </div>
                    ))}
                  </div>
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-sm text-purple-700 mb-1">
                      <span>Progress</span>
                      <span>{confidence.toFixed(0)}%</span>
                    </div>
                    <div className="w-full bg-purple-200 rounded-full h-2">
                      <div 
                        className="bg-gradient-to-r from-purple-600 to-blue-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${confidence}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right Column - Results */}
            <div className="space-y-6">
              {aiResults ? (
                <>
                  {/* AI Results */}
                  <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                        <Target className="h-5 w-5 mr-2 text-green-600" />
                        AI Analysis Results
                      </h3>
                      <div className="flex items-center">
                        <CheckCircle className="h-5 w-5 text-green-500 mr-2" />
                        <span className="text-sm font-medium px-3 py-1 rounded-full bg-green-100 text-green-800">
                          {Math.round((aiResults.qualityScore || aiResults.overallScore) * 100)}% Confidence
                        </span>
                      </div>
                    </div>

                    {/* Results based on tool type */}
                    {activeTab === 'photo' && (
                      <div className="space-y-4">
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                          <div className="text-sm text-blue-600 font-medium">Detected Test</div>
                          <div className="text-blue-900 font-semibold">{aiResults.detectedTest}</div>
                        </div>
                        <div className="space-y-2">
                          {(aiResults.results || []).map((item: any, index: number) => (
                            <div key={index} className="flex justify-between items-center p-3 bg-gray-50 rounded">
                              <span className="font-medium">{item.parameter}</span>
                              <div className="flex items-center space-x-2">
                                <span className="font-bold">{item.value}</span>
                                <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                                  {Math.round(item.confidence * 100)}%
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {activeTab === 'ocr' && (
                      <div className="space-y-4">
                        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                          <div className="text-sm text-green-600 font-medium">Document Type</div>
                          <div className="text-green-900 font-semibold">{aiResults.documentType}</div>
                        </div>
                        <div className="space-y-2">
                          {aiResults.extractedData.map((item: any, index: number) => (
                            <div key={index} className="flex justify-between items-center p-3 bg-gray-50 rounded">
                              <span className="font-medium">{item.parameter}</span>
                              <div className="flex items-center space-x-2">
                                <span className="font-bold">{item.extractedValue}</span>
                                {item.match && <CheckCircle className="h-4 w-4 text-green-500" />}
                                <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                                  {Math.round(item.confidence * 100)}%
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {activeTab === 'validation' && (
                      <div className="space-y-4">
                        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                          <div className="text-sm text-purple-600 font-medium">Validation Summary</div>
                          <div className="text-purple-900 font-semibold">
                            {aiResults.criticalFindings} critical findings detected
                          </div>
                        </div>
                        <div className="space-y-2">
                          {(aiResults.validationResults || []).map((item: any, index: number) => (
                            <div key={index} className="flex justify-between items-center p-3 bg-gray-50 rounded">
                              <span className="font-medium">{item.parameter}</span>
                              <div className="flex items-center space-x-2">
                                <span className="font-bold">{item.value}</span>
                                <span className={`text-xs px-2 py-1 rounded font-medium ${
                                  item.validationStatus === 'PASS' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                }`}>
                                  {item.validationStatus}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Recommendations */}
                    <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <h4 className="font-medium text-yellow-900 mb-2">AI Recommendations</h4>
                      <ul className="text-sm text-yellow-800 space-y-1">
                        {(aiResults.recommendations || []).map((rec: string, index: number) => (
                          <li key={index} className="flex items-start">
                            <span className="text-yellow-600 mr-2">•</span>
                            {rec}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Integration Actions */}
                    <div className="flex space-x-3 mt-6">
                      <button
                        onClick={handleIntegrateResults}
                        className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                      >
                        Integrate with Result
                      </button>
                      <button className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
                        Save AI Analysis
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
                  <Brain className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Ready for AI Analysis</h3>
                  <p className="text-gray-600 mb-4">
                    {activeTab === 'validation' 
                      ? 'Click "Analyze with AI" to validate the current result data'
                      : 'Upload a file and click "Analyze with AI" to get started'
                    }
                  </p>
                  
                  <div className="bg-white border border-gray-200 rounded-lg p-4 text-left">
                    <h4 className="font-medium text-gray-900 mb-3 flex items-center">
                      <Zap className="h-4 w-4 mr-2" />
                      AI Integration Benefits
                    </h4>
                    <ul className="text-sm text-gray-600 space-y-2">
                      <li className="flex items-center">
                        <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
                        Automated data extraction and validation
                      </li>
                      <li className="flex items-center">
                        <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
                        Real-time quality assessment
                      </li>
                      <li className="flex items-center">
                        <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
                        Seamless integration with patient records
                      </li>
                      <li className="flex items-center">
                        <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
                        Enhanced accuracy and confidence scoring
                      </li>
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIToolsModal;
