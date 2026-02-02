import React, { useState, useEffect } from 'react';
import { X, Users, AlertTriangle, CheckCircle, Loader2, ArrowRight } from 'lucide-react';
import { supabase, formatAge } from '../../utils/supabase';

interface Patient {
  id: string;
  lab_id?: string;
  name: string;
  age: number;
  gender: string;
  phone: string;
  email?: string;
  address: string;
  display_id?: string;
  registration_date: string;
  total_tests?: number;
}

interface PatientMergeModalProps {
  masterPatient: Patient;
  onClose: () => void;
  onSuccess: () => void;
}

const PatientMergeModal: React.FC<PatientMergeModalProps> = ({
  masterPatient,
  onClose,
  onSuccess,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [potentialDuplicates, setPotentialDuplicates] = useState<Patient[]>([]);
  const [selectedDuplicate, setSelectedDuplicate] = useState<Patient | null>(null);
  const [loading, setLoading] = useState(false);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    searchPotentialDuplicates();
  }, []);

  const searchPotentialDuplicates = async () => {
    setLoading(true);
    try {
      // Get lab_id from master patient or current user
      let labId = masterPatient.lab_id;
      
      if (!labId) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.user_metadata?.lab_id) {
          labId = user.user_metadata.lab_id;
        }
      }

      if (!labId) {
        throw new Error('Lab context not found. Unable to search for duplicates.');
      }

      // Search for patients with similar names or phone numbers
      const { data, error } = await supabase
        .from('patients')
        .select('*')
        .eq('lab_id', labId)
        .eq('is_active', true)
        .or(`is_duplicate.is.null,is_duplicate.eq.false`)
        .neq('id', masterPatient.id)
        .limit(50);

      if (error) throw error;

      // Filter for potential duplicates (similar name or same phone)
      const duplicates = (data || []).filter((p: Patient) => {
        const nameSimilarity = 
          p.name.toLowerCase().includes(masterPatient.name.toLowerCase().split(' ')[0]) ||
          masterPatient.name.toLowerCase().includes(p.name.toLowerCase().split(' ')[0]);
        const phoneMatch = p.phone === masterPatient.phone;
        return nameSimilarity || phoneMatch;
      });

      setPotentialDuplicates(duplicates);
    } catch (err: any) {
      console.error('Error searching duplicates:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleMerge = async () => {
    if (!selectedDuplicate) return;

    if (!confirm(`Are you sure you want to merge "${selectedDuplicate.name}" into "${masterPatient.name}"? This will mark the first patient as a duplicate.`)) {
      return;
    }

    setMerging(true);
    setError('');

    try {
      // Get current user ID
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Call merge RPC function
      const { data, error } = await supabase.rpc('merge_patients', {
        p_master_id: masterPatient.id,
        p_duplicate_id: selectedDuplicate.id,
        p_merged_by: user.id,
      });

      if (error) throw error;

      const result = data as { success: boolean; error?: string; message?: string };

      if (!result.success) {
        throw new Error(result.error || 'Merge failed');
      }

      alert('Patients merged successfully! The duplicate patient will no longer appear in the main list.');
      onSuccess();
    } catch (err: any) {
      console.error('Error merging patients:', err);
      setError(err.message || 'Failed to merge patients');
    } finally {
      setMerging(false);
    }
  };

  const filteredDuplicates = potentialDuplicates.filter(p =>
    searchTerm === '' ||
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.phone.includes(searchTerm)
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-6xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <Users className="h-6 w-6 text-white" />
            <h3 className="text-xl font-bold text-white">Merge Duplicate Patient</h3>
          </div>
          <button
            onClick={onClose}
            className="text-white hover:bg-white hover:bg-opacity-20 rounded-full p-2 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">{/* Content scrolls */}
          {/* Master Patient Card */}
          <div className="mb-6">
            <h4 className="text-sm font-semibold text-gray-700 mb-2 uppercase">Master Patient (Keep)</h4>
            <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-4 border-2 border-green-200">
              <div className="flex items-start justify-between">
                <div>
                  <h5 className="text-lg font-bold text-gray-900">{masterPatient.name}</h5>
                  <div className="mt-2 space-y-1 text-sm text-gray-600">
                    <p><span className="font-medium">ID:</span> {masterPatient.display_id || masterPatient.id.slice(0, 8)}</p>
                    <p><span className="font-medium">Age/Gender:</span> {formatAge(masterPatient.age, (masterPatient as any).age_unit)} / {masterPatient.gender}</p>
                    <p><span className="font-medium">Phone:</span> {masterPatient.phone}</p>
                    {masterPatient.email && <p><span className="font-medium">Email:</span> {masterPatient.email}</p>}
                    <p><span className="font-medium">Address:</span> {masterPatient.address}</p>
                  </div>
                </div>
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
            </div>
          </div>

          {/* Search for Duplicates */}
          <div className="mb-6">
            <h4 className="text-sm font-semibold text-gray-700 mb-2 uppercase">Select Duplicate Patient to Merge</h4>
            <input
              type="text"
              placeholder="Search by name or phone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Error Display */}
          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start space-x-3">
              <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
              <div>
                <h5 className="font-semibold text-red-900">Error</h5>
                <p className="text-sm text-red-700">{error}</p>
              </div>
            </div>
          )}

          {/* Potential Duplicates List */}
          {loading ? (
            <div className="text-center py-12">
              <Loader2 className="h-12 w-12 text-gray-400 animate-spin mx-auto mb-4" />
              <p className="text-gray-500">Searching for potential duplicates...</p>
            </div>
          ) : filteredDuplicates.length === 0 ? (
            <div className="text-center py-12">
              <Users className="h-16 w-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No potential duplicates found</p>
              <p className="text-sm text-gray-400 mt-2">Try adjusting your search criteria</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredDuplicates.map((patient) => (
                <button
                  key={patient.id}
                  onClick={() => setSelectedDuplicate(patient)}
                  className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                    selectedDuplicate?.id === patient.id
                      ? 'border-blue-500 bg-blue-50 shadow-md'
                      : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h5 className="text-lg font-bold text-gray-900">{patient.name}</h5>
                      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-gray-600">
                        <p><span className="font-medium">ID:</span> {patient.display_id || patient.id.slice(0, 8)}</p>
                        <p><span className="font-medium">Age/Gender:</span> {formatAge(patient.age, (patient as any).age_unit)} / {patient.gender}</p>
                        <p><span className="font-medium">Phone:</span> {patient.phone}</p>
                        {patient.email && <p><span className="font-medium">Email:</span> {patient.email}</p>}
                        <p className="col-span-2"><span className="font-medium">Address:</span> {patient.address}</p>
                      </div>
                    </div>
                    {selectedDuplicate?.id === patient.id && (
                      <CheckCircle className="h-6 w-6 text-blue-600 ml-4" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Merge Preview */}
          {selectedDuplicate && (
            <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-xl p-4">
              <div className="flex items-start space-x-3">
                <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5" />
                <div className="flex-1">
                  <h5 className="font-semibold text-yellow-900 mb-2">Merge Preview</h5>
                  <div className="flex items-center space-x-4 text-sm">
                    <div className="flex-1 text-center p-3 bg-white rounded-lg">
                      <p className="font-medium text-gray-900">{selectedDuplicate.name}</p>
                      <p className="text-xs text-gray-500 mt-1">Will be marked as duplicate</p>
                    </div>
                    <ArrowRight className="h-5 w-5 text-yellow-600" />
                    <div className="flex-1 text-center p-3 bg-white rounded-lg">
                      <p className="font-medium text-gray-900">{masterPatient.name}</p>
                      <p className="text-xs text-gray-500 mt-1">Master patient (kept)</p>
                    </div>
                  </div>
                  <p className="text-sm text-yellow-700 mt-3">
                    <strong>Note:</strong> The duplicate patient record will remain in the database but will be hidden from the main patient list. 
                    All orders and tests will stay with their original patient records. You can unmerge later if needed.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions - Fixed at bottom */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-end space-x-3 shrink-0">
          <button
            onClick={onClose}
            className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleMerge}
            disabled={!selectedDuplicate || merging}
            className="px-6 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
          >
            {merging ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Merging...
              </>
            ) : (
              <>
                <Users className="h-4 w-4 mr-2" />
                Merge Patients
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PatientMergeModal;
