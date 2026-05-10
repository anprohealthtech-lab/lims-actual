import React from 'react';
import { X, TestTube, DollarSign, Clock, Settings, AlertTriangle, Edit } from 'lucide-react';
import { useEscapeModalClose } from '../../hooks/useEscapeModalClose';

interface Test {
  id: string;
  name: string;
  category: string;
  method: string;
  sampleType: string;
  price: number;
  turnaroundTime: string;
  referenceRange: string;
  units: string;
  description: string;
  isActive: boolean;
  requiresFasting: boolean;
  criticalValues: string;
  interpretation: string;
  createdDate: string;
}

interface TestDetailModalProps {
  test: Test;
  onClose: () => void;
  onEdit: () => void;
}

const TestDetailModal: React.FC<TestDetailModalProps> = ({ test, onClose, onEdit }) => {
  useEscapeModalClose(onClose);
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

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900 flex items-center">
            <TestTube className="h-6 w-6 mr-2 text-blue-600" />
            Test Details
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500 p-1 rounded"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Test Summary */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-2xl font-bold text-gray-900">{test.name}</h3>
                <p className="text-gray-600">Test ID: {test.id}</p>
                <div className="flex items-center space-x-4 mt-2">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getCategoryColor(test.category)}`}>
                    {test.category}
                  </span>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    test.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {test.isActive ? 'Active' : 'Inactive'}
                  </span>
                  {test.requiresFasting && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                      Fasting Required
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-green-600">₹{test.price}</div>
                <div className="text-sm text-gray-600">Price</div>
              </div>
            </div>
          </div>

          {/* Test Information */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <Settings className="h-5 w-5 mr-2 text-blue-500" />
                Test Information
              </h4>
              <div className="space-y-3">
                <div>
                  <div className="text-sm text-gray-600">Method</div>
                  <div className="font-medium text-gray-900">{test.method}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Sample Type</div>
                  <div className="font-medium text-gray-900">{test.sampleType}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Turnaround Time</div>
                  <div className="font-medium text-gray-900">{test.turnaroundTime}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Units</div>
                  <div className="font-medium text-gray-900">{test.units || 'N/A'}</div>
                </div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <DollarSign className="h-5 w-5 mr-2 text-green-500" />
                Clinical Information
              </h4>
              <div className="space-y-3">
                <div>
                  <div className="text-sm text-gray-600">Reference Range</div>
                  <div className="font-medium text-gray-900">{test.referenceRange}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Critical Values</div>
                  <div className="font-medium text-gray-900">{test.criticalValues || 'None specified'}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Created Date</div>
                  <div className="font-medium text-gray-900">{new Date(test.createdDate).toLocaleDateString()}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Description */}
          {test.description && (
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h4 className="text-lg font-semibold text-gray-900 mb-4">Description</h4>
              <p className="text-gray-700">{test.description}</p>
            </div>
          )}

          {/* Clinical Interpretation */}
          {test.interpretation && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
              <h4 className="text-lg font-semibold text-yellow-900 mb-4 flex items-center">
                <AlertTriangle className="h-5 w-5 mr-2" />
                Clinical Interpretation
              </h4>
              <p className="text-yellow-800">{test.interpretation}</p>
            </div>
          )}

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
              Edit Test
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TestDetailModal;
