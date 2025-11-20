import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Search, Filter, X, Save, AlertCircle, Beaker, Layers, Package, DollarSign, Eye, Edit } from 'lucide-react';
import { database } from '../utils/supabase';
import TestGroupForm from '../components/Tests/TestGroupForm';
import TestForm from '../components/Tests/TestForm';
import AnalyteForm from '../components/Tests/AnalyteForm';
import PackageForm from '../components/Tests/PackageForm';
import TestDetailModal from '../components/Tests/TestDetailModal';
import AnalyteDetailModal from '../components/Tests/AnalyteDetailModal';
import TestGroupDetailModal from '../components/Tests/TestGroupDetailModal';
import PackageDetailModal from '../components/Tests/PackageDetailModal';
import EditAnalyteModal from '../components/Tests/EditAnalyteModal';

interface Test {
  id: string;
  name: string;
  category: string;
  method?: string;
  sampleType?: string;
  price?: number;
  turnaroundTime?: string;
  referenceRange?: string;
  units?: string;
  description?: string;
  isActive?: boolean;
  requiresFasting?: boolean;
  criticalValues?: string;
  interpretation?: string;
}

interface Analyte {
  id: string;
  name: string;
  unit: string;
  referenceRange?: string;
  lowCritical?: number;
  highCritical?: number;
  interpretation?: string;
  category: string;
  isActive?: boolean;
  createdDate?: string;
}

interface TestGroup {
  id: string;
  name: string;
  code?: string;
  category: string;
  clinicalPurpose?: string;
  price?: number;
  turnaroundTime?: string;
  sampleType?: string;
  requiresFasting?: boolean;
  isActive?: boolean;
  createdDate?: string;
  default_ai_processing_type?: string;
  group_level_prompt?: string;
  testType?: string;
  gender?: string;
  sampleColor?: string;
  barcodeSuffix?: string;
  lmpRequired?: boolean;
  idRequired?: boolean;
  consentForm?: boolean;
  preCollectionGuidelines?: string;
  flabsId?: string;
  onlyFemale?: boolean;
  onlyMale?: boolean;
  onlyBilling?: boolean;
  startFromNextPage?: boolean;
  analytes?: string[];
}

interface PackageType {
  id: string;
  name: string;
  description: string;
  testGroupIds: string[];
  price: number;
  discountPercentage: number;
  category: string;
  validityDays: number;
  isActive: boolean;
}

const Tests: React.FC = () => {
  console.log('🔵 Tests.tsx page is opening/rendering');
  
  const [tests, setTests] = useState<Test[]>([]);
  const [testGroups, setTestGroups] = useState<TestGroup[]>([]);
  const [analytes, setAnalytes] = useState<Analyte[]>([]);
  const [packages, setPackages] = useState<PackageType[]>([]);
  const [showTestForm, setShowTestForm] = useState(false);
  const [showAnalyteForm, setShowAnalyteForm] = useState(false);
  const [showTestGroupForm, setShowTestGroupForm] = useState(false);
  const [showPackageForm, setShowPackageForm] = useState(false);
  const [showTestDetail, setShowTestDetail] = useState(false);
  const [showAnalyteDetail, setShowAnalyteDetail] = useState(false);
  const [showTestGroupDetail, setShowTestGroupDetail] = useState(false);
  const [showPackageDetail, setShowPackageDetail] = useState(false);
  const [selectedTest, setSelectedTest] = useState<Test | null>(null);
  const [selectedAnalyte, setSelectedAnalyte] = useState<Analyte | null>(null);
  const [selectedTestGroup, setSelectedTestGroup] = useState<TestGroup | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<PackageType | null>(null);
  const [editingTest, setEditingTest] = useState<Test | null>(null);
  const [editingAnalyte, setEditingAnalyte] = useState<Analyte | null>(null);
  const [editingTestGroup, setEditingTestGroup] = useState<TestGroup | null>(null);
  const [editingPackage, setEditingPackage] = useState<PackageType | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [activeTab, setActiveTab] = useState<'groups' | 'analytes' | 'legacy'>('groups');
  const [showEditAnalyteModal, setShowEditAnalyteModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  console.log('✅ Tests component state initialized');

  // Load data on component mount
  React.useEffect(() => {
    console.log('📊 Loading data from database...');
    const loadData = async () => {
      try {
        console.log('🔄 Starting data load sequence');
        // Load analytes from database
        const { data: dbAnalytesData, error: analytesError } = await database.analytes.getAll();
        if (analytesError) {
          console.error('❌ Error loading analytes from database:', analytesError);
          setAnalytes([]);
        } else {
          console.log('✅ Analytes loaded:', dbAnalytesData?.length || 0, 'records');
          const transformedAnalytes = (dbAnalytesData || []).map(analyte => ({
            id: analyte.id,
            name: analyte.name,
            unit: analyte.unit,
            referenceRange: analyte.reference_range || analyte.referenceRange,
            lowCritical: analyte.low_critical,
            highCritical: analyte.high_critical,
            interpretation: analyte.interpretation,
            category: analyte.category,
            isActive: analyte.is_active ?? true,
            createdDate: analyte.created_at || new Date().toISOString()
          }));
          setAnalytes(transformedAnalytes);
        }
        
        // Load test groups from database
        const { data: dbTestGroupsData, error: testGroupsError } = await database.testGroups.getAll();
        if (testGroupsError) {
          console.error('❌ Error loading test groups from database:', testGroupsError);
          setTestGroups([]);
        } else {
          console.log('✅ Test Groups loaded:', dbTestGroupsData?.length || 0, 'records');
          const transformedTestGroups = (dbTestGroupsData || []).map(group => ({
            id: group.id,
            name: group.name,
            code: group.code,
            category: group.category,
            clinicalPurpose: group.clinical_purpose,
            price: group.price,
            turnaroundTime: group.turnaround_time,
            sampleType: group.sample_type,
            requiresFasting: group.requires_fasting,
            isActive: group.is_active,
            createdDate: group.created_at,
            default_ai_processing_type: group.default_ai_processing_type,
            group_level_prompt: group.group_level_prompt,
            testType: group.test_type || 'Default',
            gender: group.gender || 'Both',
            sampleColor: group.sample_color || 'Red',
            barcodeSuffix: group.barcode_suffix,
            lmpRequired: group.lmp_required || false,
            idRequired: group.id_required || false,
            consentForm: group.consent_form || false,
            preCollectionGuidelines: group.pre_collection_guidelines,
            flabsId: group.flabs_id,
            onlyFemale: group.only_female || false,
            onlyMale: group.only_male || false,
            onlyBilling: group.only_billing || false,
            startFromNextPage: group.start_from_next_page || false,
            analytes: group.test_group_analytes ? group.test_group_analytes.map(tga => tga.analyte_id) : []
          }));
          setTestGroups(transformedTestGroups);
        }

        setTests([]);
        setPackages([]);
      } catch (error) {
        console.error('Error loading data:', error);
        setAnalytes([]);
        setTestGroups([]);
        setTests([]);
        setPackages([]);
      }
    };
    
    loadData().then(() => {
      console.log('✅ All data loaded successfully');
    });
  }, []);

  const categories = ['All', 'Hematology', 'Biochemistry', 'Serology', 'Microbiology', 'Immunology'];

  const filteredPackages = packages.filter(pkg => {
    const matchesSearch = pkg.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         pkg.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || pkg.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const filteredTestGroups = testGroups.filter(group => {
    const matchesSearch = group.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (group.code?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false);
    const matchesCategory = selectedCategory === 'All' || group.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const filteredAnalytes = analytes.filter(analyte => {
    const matchesSearch = analyte.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         analyte.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || analyte.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const filteredLegacyTests = tests.filter(test => {
    const matchesSearch = test.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         test.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || test.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

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

  const handleAddTest = (_formData: any) => {
    console.warn('Individual tests are not supported. Please use test groups instead.');
    alert('Individual tests are not supported. Please use test groups instead.');
    setShowTestForm(false);
  };

  const handleAddAnalyte = async (formData: any) => {
    console.log('Creating analyte with data:', formData);
    try {
      const { data: newAnalyte, error } = await database.analytes.create({
        name: formData.name,
        unit: formData.unit,
        reference_range: formData.referenceRange,
        low_critical: formData.lowCritical,
        high_critical: formData.highCritical,
        interpretation_low: formData.interpretation?.low,
        interpretation_normal: formData.interpretation?.normal,
        interpretation_high: formData.interpretation?.high,
        category: formData.category,
        is_active: formData.isActive ?? true,
      });
      
      if (error) {
        console.error('Error creating analyte:', error);
        alert('Failed to create analyte. Please try again.');
        return;
      }
      
      if (newAnalyte) {
        const transformedAnalyte = {
          id: newAnalyte.id,
          name: newAnalyte.name,
          unit: newAnalyte.unit,
          referenceRange: newAnalyte.reference_range,
          lowCritical: newAnalyte.low_critical,
          highCritical: newAnalyte.high_critical,
          interpretation: newAnalyte.interpretation_low || '',
          category: newAnalyte.category,
          isActive: newAnalyte.is_active,
          createdDate: newAnalyte.created_at || new Date().toISOString()
        };
        
        setAnalytes(prev => [...prev, transformedAnalyte]);
        setShowAnalyteForm(false);
        alert('Analyte created successfully!');
      }
    } catch (error) {
      console.error('Unexpected error:', error);
      alert('Failed to create analyte. Please try again.');
    }
  };

  const handleAddTestGroup = async (formData: any) => {
    console.log('Creating test group with data:', formData);
    try {
      const { data: newTestGroup, error } = await database.testGroups.create(formData);
      
      if (error) {
        console.error('Error creating test group:', error);
        alert('Failed to create test group. Please try again.');
        return;
      }
      
      if (newTestGroup) {
        setTestGroups(prev => [...prev, newTestGroup]);
        setShowTestGroupForm(false);
        alert('Test group created successfully!');
      }
    } catch (error) {
      console.error('Unexpected error:', error);
      alert('Failed to create test group. Please try again.');
    }
  };

  const handleAddPackage = (_formData: any) => {
    console.warn('Packages are not supported yet. Please use test groups instead.');
    alert('Packages are not supported yet. Please use test groups instead.');
    setShowPackageForm(false);
  };

  // View handlers
  const handleViewPackage = (pkg: PackageType) => {
    setSelectedPackage(pkg);
    setShowPackageDetail(true);
  };

  const handleViewTestGroup = (group: TestGroup) => {
    setSelectedTestGroup(group);
    setShowTestGroupDetail(true);
  };

  const handleViewAnalyte = (analyte: Analyte) => {
    setSelectedAnalyte(analyte);
    setShowAnalyteDetail(true);
  };

  const handleViewLegacyTest = (test: Test) => {
    setSelectedTest(test);
    setShowTestDetail(true);
  };

  // Edit handlers
  const handleEditPackage = (pkg: PackageType) => {
    setEditingPackage(pkg);
    setShowPackageForm(true);
  };

  const handleEditTestGroup = (group: TestGroup) => {
    setEditingTestGroup(group);
    setShowTestGroupForm(true);
  };

  const handleEditAnalyte = (analyte: Analyte) => {
    setEditingAnalyte(analyte);
    setShowEditAnalyteModal(true);
  };

  const handleEditLegacyTest = (test: Test) => {
    setEditingTest(test);
    setShowTestForm(true);
  };

  // Update handlers
  const handleUpdatePackage = (formData: any) => {
    if (!editingPackage) return;
    
    const updatedPackage = {
      ...editingPackage,
      name: formData.name,
      description: formData.description,
      testGroupIds: formData.testGroupIds,
      price: formData.price,
      discountPercentage: formData.discountPercentage,
      category: formData.category,
      validityDays: formData.validityDays,
      isActive: formData.isActive,
    };
    
    setPackages(prev => prev.map(p => p.id === editingPackage.id ? updatedPackage : p));
    setShowPackageForm(false);
    setEditingPackage(null);
  };

  const handleUpdateTestGroup = async (formData: any) => {
    if (!editingTestGroup) return;

    try {
      const { data: updatedTestGroup, error } = await database.testGroups.update(editingTestGroup.id, formData);
      
      if (error) {
        console.error('Error updating test group:', error);
        alert('Failed to update test group. Please try again.');
        return;
      }
      
      if (updatedTestGroup) {
        setTestGroups(prev => prev.map(tg => tg.id === editingTestGroup.id ? updatedTestGroup : tg));
        setShowTestGroupForm(false);
        setEditingTestGroup(null);
        alert('Test group updated successfully!');
      }
    } catch (error) {
      console.error('Unexpected error:', error);
      alert('Failed to update test group. Please try again.');
    }
  };

  const handleUpdateAnalyte = async (formData: any) => {
    if (!editingAnalyte) return;
    
    console.log('Updating analyte with data:', formData);
    try {
      const { data: updatedAnalyte, error } = await database.analytes.update(editingAnalyte.id, {
        name: formData.name,
        unit: formData.unit,
        reference_range: formData.referenceRange,
        low_critical: formData.lowCritical,
        high_critical: formData.highCritical,
        interpretation_low: formData.interpretation?.low,
        interpretation_normal: formData.interpretation?.normal,
        interpretation_high: formData.interpretation?.high,
        category: formData.category,
        is_active: formData.isActive,
      });
      
      if (error) {
        console.error('Error updating analyte:', error);
        alert('Failed to update analyte. Please try again.');
        return;
      }
      
      if (updatedAnalyte) {
        const transformedAnalyte = {
          id: updatedAnalyte.id,
          name: updatedAnalyte.name,
          unit: updatedAnalyte.unit,
          referenceRange: updatedAnalyte.reference_range,
          lowCritical: updatedAnalyte.low_critical,
          highCritical: updatedAnalyte.high_critical,
          interpretation: updatedAnalyte.interpretation_low || '',
          category: updatedAnalyte.category,
          isActive: updatedAnalyte.is_active,
          createdDate: updatedAnalyte.created_at || editingAnalyte.createdDate
        };
        
        setAnalytes(prev => prev.map(a => a.id === editingAnalyte.id ? transformedAnalyte : a));
        setShowEditAnalyteModal(false);
        setEditingAnalyte(null);
        alert('Analyte updated successfully!');
      }
    } catch (error) {
      console.error('Unexpected error:', error);
      alert('Failed to update analyte. Please try again.');
    }
  };

  const handleUpdateTest = (formData: any) => {
    if (!editingTest) return;
    
    const updatedTest = {
      ...editingTest,
      name: formData.name,
      category: formData.category,
      method: formData.method,
      sampleType: formData.sampleType,
      price: parseFloat(formData.price),
      turnaroundTime: formData.turnaroundTime,
      referenceRange: formData.referenceRange,
      units: formData.units,
      description: formData.description,
      isActive: formData.isActive,
      requiresFasting: formData.requiresFasting,
      criticalValues: formData.criticalValues,
      interpretation: formData.interpretation,
    };
    
    setTests(prev => prev.map(t => t.id === editingTest.id ? updatedTest : t));
    setShowTestForm(false);
    setEditingTest(null);
  };

  // Close handlers
  const handleClosePackageForm = () => {
    setShowPackageForm(false);
    setEditingPackage(null);
  };

  const handleCloseTestGroupForm = () => {
    setShowTestGroupForm(false);
    setEditingTestGroup(null);
  };

  const handleCloseAnalyteForm = () => {
    setShowAnalyteForm(false);
    setEditingAnalyte(null);
  };

  const handleCloseTestForm = () => {
    setShowTestForm(false);
    setEditingTest(null);
  };

  const handleCloseAnalyteModal = () => {
    setShowEditAnalyteModal(false);
    setEditingAnalyte(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Test Management System</h1>
          <p className="text-gray-600 mt-1">Manage analytes, test groups, and diagnostic panels</p>
        </div>
        <div className="flex space-x-3">
          <button 
            onClick={() => setShowAnalyteForm(true)}
            className="flex items-center px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Beaker className="h-4 w-4 mr-2" />
            Add Analyte
          </button>
          <button 
            onClick={() => setShowPackageForm(true)}
            className="flex items-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            <Plus className="h-5 w-5 mr-2" />
            Create Package
          </button>
          <button 
            onClick={() => setShowTestGroupForm(true)}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-5 w-5 mr-2" />
            Create Test Group
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md flex items-center space-x-2">
          <AlertCircle className="w-5 h-5 text-red-600" />
          <span className="text-red-700">{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-600 hover:text-red-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-1">
        <div className="flex space-x-1">
          <button
            onClick={() => setActiveTab('groups')}
            className={`flex-1 flex items-center justify-center px-4 py-3 rounded-md text-sm font-medium transition-all ${
              activeTab === 'groups'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <Layers className="h-4 w-4 mr-2" />
            Test Groups ({testGroups.length})
          </button>
          <button
            onClick={() => setActiveTab('analytes')}
            className={`flex-1 flex items-center justify-center px-4 py-3 rounded-md text-sm font-medium transition-all ${
              activeTab === 'analytes'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <Beaker className="h-4 w-4 mr-2" />
            Analytes ({analytes.length})
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center">
            <div className="bg-purple-100 p-3 rounded-lg">
              <Package className="h-6 w-6 text-purple-600" />
            </div>
            <div className="ml-4">
              <div className="text-2xl font-bold text-gray-900">{packages.length}</div>
              <div className="text-sm text-gray-600">Health Packages</div>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center">
            <div className="bg-green-100 p-3 rounded-lg">
              <Layers className="h-6 w-6 text-green-600" />
            </div>
            <div className="ml-4">
              <div className="text-2xl font-bold text-gray-900">{testGroups.length}</div>
              <div className="text-sm text-gray-600">Test Groups</div>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center">
            <div className="bg-blue-100 p-3 rounded-lg">
              <Beaker className="h-6 w-6 text-blue-600" />
            </div>
            <div className="ml-4">
              <div className="text-2xl font-bold text-gray-900">{analytes.length}</div>
              <div className="text-sm text-gray-600">Analytes</div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center">
            <div className="bg-orange-100 p-3 rounded-lg">
              <DollarSign className="h-6 w-6 text-orange-600" />
            </div>
            <div className="ml-4">
              <div className="text-2xl font-bold text-gray-900">₹{packages.length > 0 ? Math.round(packages.reduce((sum, pkg) => sum + pkg.price, 0) / packages.length) : 0}</div>
              <div className="text-sm text-gray-600">Avg Package Price</div>
            </div>
          </div>
        </div>
      </div>

      {/* Search and Filter Bar */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search tests by name or ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {categories.map(category => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
          <button className="flex items-center px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">
            <Filter className="h-4 w-4 mr-2" />
            More Filters
          </button>
        </div>
      </div>

      {/* Test Groups Tab */}
      {activeTab === 'groups' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">
              Test Groups ({filteredTestGroups.length})
            </h3>
          </div>
          
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Group Details</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Analytes</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Price</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sample Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredTestGroups.map((group) => (
                  <tr key={group.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900">{group.name}</div>
                        <div className="text-sm text-gray-500">Code: {group.code} • {group.turnaroundTime}</div>
                        <div className="text-xs text-gray-400 mt-1">{group.clinicalPurpose}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getCategoryColor(group.category)}`}>
                        {group.category}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{group.analytes?.length || 0} analytes</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">₹{group.price || 0}</div>
                      {group.requiresFasting && <div className="text-xs text-orange-600">Fasting required</div>}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {group.sampleType || 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                      <button 
                        onClick={() => handleViewTestGroup(group)}
                        className="text-blue-600 hover:text-blue-900 p-1 rounded"
                        title="View Test Group Details"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <button 
                        onClick={() => handleEditTestGroup(group)}
                        className="text-gray-600 hover:text-gray-900 p-1 rounded"
                        title="Edit Test Group"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Analytes Tab */}
      {activeTab === 'analytes' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">
              Analytes ({filteredAnalytes.length})
            </h3>
          </div>
          
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Analyte Details</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reference Range</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Critical Values</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredAnalytes.map((analyte) => (
                  <tr key={analyte.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900">{analyte.name}</div>
                        <div className="text-sm text-gray-500">ID: {analyte.id} • Unit: {analyte.unit}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getCategoryColor(analyte.category)}`}>
                        {analyte.category}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900">{analyte.referenceRange || 'N/A'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {analyte.lowCritical && <div className="text-red-600">Low: {analyte.lowCritical}</div>}
                        {analyte.highCritical && <div className="text-red-600">High: {analyte.highCritical}</div>}
                        {!analyte.lowCritical && !analyte.highCritical && <span className="text-gray-400">None</span>}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                      <button 
                        onClick={() => handleViewAnalyte(analyte)}
                        className="text-blue-600 hover:text-blue-900 p-1 rounded"
                        title="View Analyte Details"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <button 
                        onClick={() => handleEditAnalyte(analyte)}
                        className="text-gray-600 hover:text-gray-900 p-1 rounded"
                        title="Edit Analyte"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Test Form Modal */}
      {showTestForm && (
        <TestForm
          onClose={handleCloseTestForm}
          onSubmit={editingTest ? handleUpdateTest : handleAddTest}
          test={editingTest}
        />
      )}

      {/* Analyte Form Modal */}
      {showAnalyteForm && (
        <AnalyteForm
          onClose={handleCloseAnalyteForm}
          onSubmit={editingAnalyte ? handleUpdateAnalyte : handleAddAnalyte}
          analyte={editingAnalyte}
        />
      )}

      {/* Test Group Form Modal - USES ENHANCED TESTGROUPFORM */}
      {showTestGroupForm && (
        <TestGroupForm
          onClose={handleCloseTestGroupForm}
          onSubmit={editingTestGroup ? handleUpdateTestGroup : handleAddTestGroup}
          testGroup={editingTestGroup}
        />
      )}

      {/* Package Form Modal */}
      {showPackageForm && (
        <PackageForm
          onClose={handleClosePackageForm}
          onSubmit={editingPackage ? handleUpdatePackage : handleAddPackage}
          package={editingPackage}
        />
      )}

      {/* Detail Modals */}
      {showTestDetail && selectedTest && (
        <TestDetailModal
          test={selectedTest}
          onClose={() => setShowTestDetail(false)}
          onEdit={() => {
            setShowTestDetail(false);
            handleEditLegacyTest(selectedTest);
          }}
        />
      )}

      {showAnalyteDetail && selectedAnalyte && (
        <AnalyteDetailModal
          analyte={selectedAnalyte}
          onClose={() => setShowAnalyteDetail(false)}
          onEdit={() => {
            setShowAnalyteDetail(false);
            handleEditAnalyte(selectedAnalyte);
          }}
        />
      )}

      {showTestGroupDetail && selectedTestGroup && (
        <TestGroupDetailModal
          testGroup={selectedTestGroup}
          analytes={analytes}
          onClose={() => setShowTestGroupDetail(false)}
          onEdit={() => {
            setShowTestGroupDetail(false);
            handleEditTestGroup(selectedTestGroup);
          }}
        />
      )}

      {showPackageDetail && selectedPackage && (
        <PackageDetailModal
          package={selectedPackage}
          testGroups={testGroups}
          onClose={() => setShowPackageDetail(false)}
          onEdit={() => {
            setShowPackageDetail(false);
            handleEditPackage(selectedPackage);
          }}
        />
      )}

      {/* Edit Analyte Modal */}
      {showEditAnalyteModal && editingAnalyte && (
        <EditAnalyteModal
          analyte={editingAnalyte}
          isOpen={showEditAnalyteModal}
          onClose={handleCloseAnalyteModal}
          onSave={handleUpdateAnalyte}
        />
      )}
    </div>
  );
};

export default Tests;
