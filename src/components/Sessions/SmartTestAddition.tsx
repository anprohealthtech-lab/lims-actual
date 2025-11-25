import { useState, useEffect } from 'react';
import { 
  Search, 
  Plus, 
  Package, 
  TestTube, 
  Clock, 
  DollarSign,
  AlertTriangle,
  CheckCircle,
  X,
  Filter
} from 'lucide-react';
import { supabase, database } from '../../utils/supabase';

interface TestGroup {
  id: string;
  name: string;
  price: number;
  turnaround_time: string;
  sample_type: string;
  category: string;
  description?: string;
  is_package: boolean;
  package_tests?: TestGroup[];
}

interface AddTestRule {
  allowed: boolean;
  reason: string;
  requires_approval: boolean;
  requires_new_sample: boolean;
}

interface Props {
  sessionId: string;
  patientId: string;
  currentOrderId?: string;
  currentOrderStatus?: string;
  onTestsAdded: (tests: TestGroup[], orderType: 'modify' | 'additional') => void;
  onClose: () => void;
}

export default function SmartTestAddition({ 
  sessionId, 
  currentOrderStatus = 'pending',
  onTestsAdded, 
  onClose 
}: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [availableTests, setAvailableTests] = useState<TestGroup[]>([]);
  const [selectedTests, setSelectedTests] = useState<TestGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [additionRules, setAdditionRules] = useState<AddTestRule | null>(null);
  const [orderType, setOrderType] = useState<'modify' | 'additional'>('modify');

  const categories = [
    { value: 'all', label: 'All Tests' },
    { value: 'routine', label: 'Routine' },
    { value: 'biochemistry', label: 'Biochemistry' },
    { value: 'hematology', label: 'Hematology' },
    { value: 'microbiology', label: 'Microbiology' },
    { value: 'pathology', label: 'Pathology' },
    { value: 'radiology', label: 'Radiology' }
  ];

  const popularPackages = [
    {
      id: 'basic-health',
      name: 'Basic Health Checkup',
      price: 1200,
      turnaround_time: '4 hours',
      tests: ['CBC', 'LFT', 'Kidney Function', 'Lipid Profile'],
      description: 'Complete basic health screening'
    },
    {
      id: 'diabetes-panel',
      name: 'Diabetes Panel',
      price: 800,
      turnaround_time: '2 hours',
      tests: ['FBS', 'HbA1c', 'PP Glucose'],
      description: 'Comprehensive diabetes monitoring'
    },
    {
      id: 'thyroid-profile',
      name: 'Thyroid Profile',
      price: 600,
      turnaround_time: '6 hours',
      tests: ['TSH', 'T3', 'T4'],
      description: 'Complete thyroid function assessment'
    }
  ];

  useEffect(() => {
    fetchAvailableTests();
    determineAdditionRules();
  }, [currentOrderStatus]);

  const fetchAvailableTests = async () => {
    try {
      setLoading(true);
      
      // Get current user's lab_id
      const lab_id = await database.getCurrentUserLabId();
      if (!lab_id) {
        console.error('No lab context found');
        setLoading(false);
        return;
      }

      // Fetch test groups (lab-scoped)
      const { data: testGroups, error } = await supabase
        .from('test_groups')
        .select('*')
        .or(`lab_id.eq.${lab_id},lab_id.is.null`)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;

      setAvailableTests(testGroups || []);
    } catch (error) {
      console.error('Error fetching tests:', error);
    } finally {
      setLoading(false);
    }
  };

  const determineAdditionRules = () => {
    // Smart rules based on current order status
    let rules: AddTestRule;

    switch (currentOrderStatus) {
      case 'pending':
      case 'confirmed':
        rules = {
          allowed: true,
          reason: 'Tests can be added before sample collection',
          requires_approval: false,
          requires_new_sample: false
        };
        setOrderType('modify');
        break;
      
      case 'sample_collection':
        rules = {
          allowed: true,
          reason: 'Limited tests can be added during collection',
          requires_approval: true,
          requires_new_sample: false
        };
        setOrderType('additional');
        break;
      
      case 'processing':
      case 'completed':
        rules = {
          allowed: true,
          reason: 'New tests require separate order and sample',
          requires_approval: true,
          requires_new_sample: true
        };
        setOrderType('additional');
        break;
      
      default:
        rules = {
          allowed: false,
          reason: 'Cannot add tests to this order',
          requires_approval: false,
          requires_new_sample: false
        };
    }

    setAdditionRules(rules);
  };

  const filteredTests = availableTests.filter(test => {
    const matchesSearch = test.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         test.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || test.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const toggleTestSelection = (test: TestGroup) => {
    const isSelected = selectedTests.some(t => t.id === test.id);
    if (isSelected) {
      setSelectedTests(prev => prev.filter(t => t.id !== test.id));
    } else {
      setSelectedTests(prev => [...prev, test]);
    }
  };

  const selectPackage = (packageName: string) => {
    const packageTests = availableTests.filter(test => 
      packageName === 'basic-health' ? 
        ['CBC', 'LFT', 'Kidney Function', 'Lipid Profile'].includes(test.name) :
      packageName === 'diabetes-panel' ?
        ['FBS', 'HbA1c', 'PP Glucose'].includes(test.name) :
      packageName === 'thyroid-profile' ?
        ['TSH', 'T3', 'T4'].includes(test.name) : false
    );
    
    setSelectedTests(prev => {
      const newTests = packageTests.filter(test => !prev.some(t => t.id === test.id));
      return [...prev, ...newTests];
    });
  };

  const getTotalCost = () => {
    return selectedTests.reduce((sum, test) => sum + test.price, 0);
  };

  const handleAddTests = () => {
    if (selectedTests.length > 0 && additionRules?.allowed) {
      onTestsAdded(selectedTests, orderType);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'allowed': return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'warning': return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case 'restricted': return <X className="h-5 w-5 text-red-500" />;
      default: return null;
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto"></div>
          <p className="text-center mt-4 text-gray-600">Loading available tests...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Add Tests to Session</h2>
            <p className="text-sm text-gray-500 mt-1">Session #{sessionId}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Addition Rules Status */}
        {additionRules && (
          <div className={`p-4 border-b ${
            additionRules.allowed ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
          }`}>
            <div className="flex items-center">
              {getStatusIcon(additionRules.allowed ? 'allowed' : 'restricted')}
              <div className="ml-3">
                <p className={`text-sm font-medium ${
                  additionRules.allowed ? 'text-green-800' : 'text-red-800'
                }`}>
                  {additionRules.reason}
                </p>
                {additionRules.requires_approval && (
                  <p className="text-xs text-yellow-600 mt-1">
                    ⚠️ Requires supervisor approval
                  </p>
                )}
                {additionRules.requires_new_sample && (
                  <p className="text-xs text-blue-600 mt-1">
                    🧪 Will require new sample collection
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="flex h-full max-h-[calc(90vh-200px)]">
          {/* Left Panel - Test Selection */}
          <div className="flex-1 p-6 overflow-y-auto">
            {/* Search and Filters */}
            <div className="space-y-4 mb-6">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                <input
                  type="text"
                  placeholder="Search tests, packages, or keywords..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              
              <div className="flex items-center space-x-2">
                <Filter className="h-5 w-5 text-gray-400" />
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="border border-gray-300 rounded-md px-3 py-1 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {categories.map(category => (
                    <option key={category.value} value={category.value}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Popular Packages */}
            <div className="mb-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <Package className="h-5 w-5 mr-2" />
                Popular Packages
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {popularPackages.map(pkg => (
                  <div key={pkg.id} className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors">
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-medium text-gray-900">{pkg.name}</h4>
                      <span className="text-sm font-bold text-blue-600">₹{pkg.price.toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-gray-500 mb-2">{pkg.description}</p>
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
                      <span className="flex items-center">
                        <TestTube className="h-3 w-3 mr-1" />
                        {pkg.tests.length} tests
                      </span>
                      <span className="flex items-center">
                        <Clock className="h-3 w-3 mr-1" />
                        {pkg.turnaround_time}
                      </span>
                    </div>
                    <button
                      onClick={() => selectPackage(pkg.id)}
                      className="w-full bg-blue-50 text-blue-600 border border-blue-200 rounded-md py-1 px-3 text-sm hover:bg-blue-100 transition-colors"
                    >
                      <Plus className="h-3 w-3 inline mr-1" />
                      Add Package
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Individual Tests */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <TestTube className="h-5 w-5 mr-2" />
                Individual Tests
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredTests.slice(0, 20).map(test => (
                  <div
                    key={test.id}
                    className={`border rounded-lg p-3 cursor-pointer transition-all ${
                      selectedTests.some(t => t.id === test.id)
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                    onClick={() => toggleTestSelection(test)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900 text-sm">{test.name}</h4>
                        <div className="flex items-center space-x-3 mt-1 text-xs text-gray-500">
                          <span className="flex items-center">
                            <DollarSign className="h-3 w-3 mr-1" />
                            ₹{test.price}
                          </span>
                          <span className="flex items-center">
                            <Clock className="h-3 w-3 mr-1" />
                            {test.turnaround_time}
                          </span>
                        </div>
                      </div>
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                        selectedTests.some(t => t.id === test.id)
                          ? 'border-blue-500 bg-blue-500'
                          : 'border-gray-300'
                      }`}>
                        {selectedTests.some(t => t.id === test.id) && (
                          <CheckCircle className="h-3 w-3 text-white" />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Panel - Selected Tests */}
          <div className="w-80 border-l border-gray-200 p-6 bg-gray-50">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Selected Tests</h3>
            
            {selectedTests.length === 0 ? (
              <div className="text-center text-gray-500 py-8">
                <TestTube className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                <p>No tests selected</p>
                <p className="text-sm">Choose tests from the left panel</p>
              </div>
            ) : (
              <div className="space-y-3">
                {selectedTests.map(test => (
                  <div key={test.id} className="bg-white border border-gray-200 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900 text-sm">{test.name}</h4>
                        <p className="text-xs text-gray-500">₹{test.price}</p>
                      </div>
                      <button
                        onClick={() => toggleTestSelection(test)}
                        className="text-red-400 hover:text-red-600"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
                
                <div className="border-t border-gray-200 pt-4 mt-4">
                  <div className="flex justify-between items-center text-lg font-semibold">
                    <span>Total Cost:</span>
                    <span className="text-blue-600">₹{getTotalCost().toLocaleString()}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {selectedTests.length} test{selectedTests.length !== 1 ? 's' : ''} selected
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              {orderType === 'modify' ? '✏️ Modifying current order' : '➕ Creating additional order'}
            </div>
            <div className="flex space-x-3">
              <button
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddTests}
                disabled={selectedTests.length === 0 || !additionRules?.allowed}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                Add {selectedTests.length} Test{selectedTests.length !== 1 ? 's' : ''}
                {selectedTests.length > 0 && ` (₹${getTotalCost().toLocaleString()})`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
