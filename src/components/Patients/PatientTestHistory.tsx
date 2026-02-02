import React, { useState } from 'react';
import { X, FileText, Calendar, User, TestTube, Download, Eye, Filter, Search } from 'lucide-react';
import { formatAge } from '../../utils/supabase';

interface Patient {
  id: string;
  name: string;
  age: number;
  gender: string;
  phone: string;
  email?: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  emergency_contact?: string;
  emergency_phone?: string;
  blood_group?: string;
  allergies?: string;
  medical_history?: string;
  registration_date: string;
  last_visit: string;
  total_tests: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface PatientTestHistoryProps {
  patient: Patient;
  onClose: () => void;
}

interface TestHistory {
  id: string;
  testName: string;
  orderDate: string;
  completedDate: string;
  status: 'Completed' | 'In Progress' | 'Pending' | 'Cancelled';
  result: string;
  doctor: string;
  orderId: string;
  reportUrl?: string;
}

const PatientTestHistory: React.FC<PatientTestHistoryProps> = ({ patient, onClose }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('All');
  const [selectedTest, setSelectedTest] = useState<TestHistory | null>(null);

  // Mock test history data
  const testHistory: TestHistory[] = [
    {
      id: 'TH001',
      testName: 'Complete Blood Count (CBC)',
      orderDate: '2024-01-20',
      completedDate: '2024-01-20',
      status: 'Completed',
      result: 'Normal',
      doctor: 'Dr. Rajesh Kumar',
      orderId: 'ORD001234',
    },
    {
      id: 'TH002',
      testName: 'Lipid Profile',
      orderDate: '2024-01-18',
      completedDate: '2024-01-18',
      status: 'Completed',
      result: 'High LDL',
      doctor: 'Dr. Sarah Wilson',
      orderId: 'ORD001235',
    },
    {
      id: 'TH003',
      testName: 'Blood Sugar (Fasting)',
      orderDate: '2024-01-15',
      completedDate: '2024-01-15',
      status: 'Completed',
      result: 'Normal',
      doctor: 'Dr. Rajesh Kumar',
      orderId: 'ORD001236',
    },
    {
      id: 'TH004',
      testName: 'Liver Function Test',
      orderDate: '2024-01-10',
      completedDate: '2024-01-10',
      status: 'Completed',
      result: 'Slightly Elevated',
      doctor: 'Dr. Sarah Wilson',
      orderId: 'ORD001237',
    },
    {
      id: 'TH005',
      testName: 'Thyroid Function Test',
      orderDate: '2024-01-05',
      completedDate: '',
      status: 'In Progress',
      result: 'Pending',
      doctor: 'Dr. Rajesh Kumar',
      orderId: 'ORD001238',
    },
  ];

  const statuses = ['All', 'Completed', 'In Progress', 'Pending', 'Cancelled'];

  const filteredTests = testHistory.filter(test => {
    const matchesSearch = test.testName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         test.orderId.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = selectedStatus === 'All' || test.status === selectedStatus;
    return matchesSearch && matchesStatus;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Completed': return 'bg-green-100 text-green-800';
      case 'In Progress': return 'bg-blue-100 text-blue-800';
      case 'Pending': return 'bg-yellow-100 text-yellow-800';
      case 'Cancelled': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getResultColor = (result: string) => {
    switch (result.toLowerCase()) {
      case 'normal': return 'text-green-600';
      case 'high ldl':
      case 'slightly elevated': return 'text-orange-600';
      case 'pending': return 'text-gray-500';
      default: return 'text-gray-900';
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 flex items-center">
              <FileText className="h-6 w-6 mr-2 text-blue-600" />
              Test History - {patient.name}
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Patient ID: {patient.id} • Total Tests: {testHistory.length}
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
          {/* Patient Summary */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-blue-600 font-medium">Patient Name</div>
                <div className="text-blue-900 font-semibold">{patient.name}</div>
              </div>
              <div>
                <div className="text-blue-600 font-medium">Age/Gender</div>
                <div className="text-blue-900">{formatAge(patient.age, (patient as any).age_unit)}, {patient.gender}</div>
              </div>
              <div>
                <div className="text-blue-600 font-medium">Phone</div>
                <div className="text-blue-900">{patient.phone}</div>
              </div>
              <div>
                <div className="text-blue-600 font-medium">Last Visit</div>
                <div className="text-blue-900">{new Date(patient.last_visit).toLocaleDateString()}</div>
              </div>
            </div>
          </div>

          {/* Search and Filter */}
          <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search tests by name or order ID..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {statuses.map(status => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
              <button className="flex items-center px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">
                <Filter className="h-4 w-4 mr-2" />
                Date Range
              </button>
            </div>
          </div>

          {/* Test History Table */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">
                Test History ({filteredTests.length})
              </h3>
            </div>
            
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Test Details
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Dates
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Result
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Doctor
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredTests.map((test) => (
                    <tr key={test.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{test.testName}</div>
                          <div className="text-sm text-gray-500">Order: {test.orderId}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          <div>Ordered: {new Date(test.orderDate).toLocaleDateString()}</div>
                          {test.completedDate && (
                            <div className="text-gray-500">Completed: {new Date(test.completedDate).toLocaleDateString()}</div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(test.status)}`}>
                          {test.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`text-sm font-medium ${getResultColor(test.result)}`}>
                          {test.result}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {test.doctor}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                        <button
                          onClick={() => setSelectedTest(test)}
                          className="text-blue-600 hover:text-blue-900 p-1 rounded"
                          title="View Details"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        {test.status === 'Completed' && (
                          <button
                            className="text-green-600 hover:text-green-900 p-1 rounded"
                            title="Download Report"
                          >
                            <Download className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Summary Statistics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-green-600">
                {testHistory.filter(t => t.status === 'Completed').length}
              </div>
              <div className="text-sm text-green-700">Completed Tests</div>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-blue-600">
                {testHistory.filter(t => t.status === 'In Progress').length}
              </div>
              <div className="text-sm text-blue-700">In Progress</div>
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-yellow-600">
                {testHistory.filter(t => t.status === 'Pending').length}
              </div>
              <div className="text-sm text-yellow-700">Pending</div>
            </div>
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-purple-600">
                {new Set(testHistory.map(t => t.doctor)).size}
              </div>
              <div className="text-sm text-purple-700">Doctors</div>
            </div>
          </div>
        </div>

        {/* Test Detail Modal */}
        {selectedTest && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-60 p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl">
              <div className="flex items-center justify-between p-6 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Test Details</h3>
                <button
                  onClick={() => setSelectedTest(null)}
                  className="text-gray-400 hover:text-gray-500"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="font-medium text-gray-700">Test Name</div>
                    <div className="text-gray-900">{selectedTest.testName}</div>
                  </div>
                  <div>
                    <div className="font-medium text-gray-700">Order ID</div>
                    <div className="text-gray-900">{selectedTest.orderId}</div>
                  </div>
                  <div>
                    <div className="font-medium text-gray-700">Order Date</div>
                    <div className="text-gray-900">{new Date(selectedTest.orderDate).toLocaleDateString()}</div>
                  </div>
                  <div>
                    <div className="font-medium text-gray-700">Completed Date</div>
                    <div className="text-gray-900">
                      {selectedTest.completedDate ? new Date(selectedTest.completedDate).toLocaleDateString() : 'Not completed'}
                    </div>
                  </div>
                  <div>
                    <div className="font-medium text-gray-700">Status</div>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(selectedTest.status)}`}>
                      {selectedTest.status}
                    </span>
                  </div>
                  <div>
                    <div className="font-medium text-gray-700">Result</div>
                    <div className={`font-medium ${getResultColor(selectedTest.result)}`}>
                      {selectedTest.result}
                    </div>
                  </div>
                  <div className="col-span-2">
                    <div className="font-medium text-gray-700">Referring Doctor</div>
                    <div className="text-gray-900">{selectedTest.doctor}</div>
                  </div>
                </div>
                <div className="flex justify-end space-x-3 mt-6">
                  <button
                    onClick={() => setSelectedTest(null)}
                    className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  >
                    Close
                  </button>
                  {selectedTest.status === 'Completed' && (
                    <button className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700">
                      <Download className="h-4 w-4 mr-2 inline" />
                      Download Report
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PatientTestHistory;