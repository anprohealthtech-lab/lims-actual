import React, { useState, useEffect } from 'react';
import { X, Users, Loader2, AlertTriangle, UserCheck, Calendar, User } from 'lucide-react';
import { supabase } from '../../utils/supabase';
import { format } from 'date-fns';
import { useEscapeModalClose } from '../../hooks/useEscapeModalClose';

interface Patient {
  id: string;
  name: string;
  age: number;
  gender: string;
  phone: string;
  email?: string;
  address: string;
  display_id?: string;
  registration_date: string;
  merge_date?: string;
  merged_by?: string;
  merged_by_name?: string;
}

interface ViewDuplicatesModalProps {
  patientId: string;
  onClose: () => void;
  onUnmerge: () => void;
}

const ViewDuplicatesModal: React.FC<ViewDuplicatesModalProps> = ({
  patientId,
  onClose,
  onUnmerge,
}) => {
  useEscapeModalClose(onClose);
  const [loading, setLoading] = useState(true);
  const [masterPatient, setMasterPatient] = useState<Patient | null>(null);
  const [duplicates, setDuplicates] = useState<Patient[]>([]);
  const [error, setError] = useState('');
  const [unmergingId, setUnmergingId] = useState<string | null>(null);

  useEffect(() => {
    fetchDuplicates();
  }, [patientId]);

  const fetchDuplicates = async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error } = await supabase.rpc('get_patient_with_duplicates', {
        p_patient_id: patientId,
      });

      if (error) throw error;

      const result = data as {
        master_patient: Patient;
        duplicates: Patient[];
        total_count: number;
      };

      setMasterPatient(result.master_patient);
      setDuplicates(result.duplicates || []);
    } catch (err: any) {
      console.error('Error fetching duplicates:', err);
      setError(err.message || 'Failed to load duplicates');
    } finally {
      setLoading(false);
    }
  };

  const handleUnmerge = async (duplicateId: string, duplicateName: string) => {
    if (!confirm(`Are you sure you want to unmerge "${duplicateName}"? This will restore it as a separate patient.`)) {
      return;
    }

    setUnmergingId(duplicateId);
    setError('');

    try {
      const { data, error } = await supabase.rpc('unmerge_patient', {
        p_duplicate_id: duplicateId,
      });

      if (error) throw error;

      const result = data as { success: boolean; error?: string; message?: string };

      if (!result.success) {
        throw new Error(result.error || 'Unmerge failed');
      }

      alert('Patient unmerged successfully! They will now appear as a separate patient.');
      
      // Refresh the duplicates list
      await fetchDuplicates();
      onUnmerge();
    } catch (err: any) {
      console.error('Error unmerging patient:', err);
      setError(err.message || 'Failed to unmerge patient');
    } finally {
      setUnmergingId(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Users className="h-6 w-6 text-white" />
            <h3 className="text-xl font-bold text-white">Merged Patient Records</h3>
          </div>
          <button
            onClick={onClose}
            className="text-white hover:bg-white hover:bg-opacity-20 rounded-full p-2 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(90vh-80px)]">
          {loading ? (
            <div className="text-center py-12">
              <Loader2 className="h-12 w-12 text-gray-400 animate-spin mx-auto mb-4" />
              <p className="text-gray-500">Loading merged records...</p>
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-6 flex items-start space-x-3">
              <AlertTriangle className="h-6 w-6 text-red-600 mt-0.5" />
              <div>
                <h5 className="font-semibold text-red-900 text-lg">Error Loading Data</h5>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            </div>
          ) : (
            <>
              {/* Master Patient Card */}
              {masterPatient && (
                <div className="mb-6">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3 uppercase flex items-center">
                    <UserCheck className="h-4 w-4 mr-2" />
                    Master Patient Record
                  </h4>
                  <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-5 border-2 border-green-200">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h5 className="text-xl font-bold text-gray-900 mb-3">{masterPatient.name}</h5>
                        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-gray-600">
                          <div>
                            <span className="font-medium text-gray-700">Patient ID:</span>
                            <p className="mt-0.5">{masterPatient.display_id || masterPatient.id.slice(0, 8)}</p>
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">Age / Gender:</span>
                            <p className="mt-0.5">{masterPatient.age} years / {masterPatient.gender}</p>
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">Phone:</span>
                            <p className="mt-0.5">{masterPatient.phone}</p>
                          </div>
                          {masterPatient.email && (
                            <div>
                              <span className="font-medium text-gray-700">Email:</span>
                              <p className="mt-0.5">{masterPatient.email}</p>
                            </div>
                          )}
                          <div className="col-span-2">
                            <span className="font-medium text-gray-700">Address:</span>
                            <p className="mt-0.5">{masterPatient.address}</p>
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">Registered:</span>
                            <p className="mt-0.5">{format(new Date(masterPatient.registration_date), 'PPP')}</p>
                          </div>
                        </div>
                      </div>
                      <div className="ml-4 bg-green-100 rounded-full p-3">
                        <UserCheck className="h-8 w-8 text-green-600" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Duplicates Section */}
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-3 uppercase flex items-center">
                  <Users className="h-4 w-4 mr-2" />
                  Merged Duplicate Records ({duplicates.length})
                </h4>
                
                {duplicates.length === 0 ? (
                  <div className="text-center py-12 bg-gray-50 rounded-xl">
                    <Users className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500 font-medium">No duplicate records found</p>
                    <p className="text-sm text-gray-400 mt-2">This patient has no merged duplicates</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {duplicates.map((duplicate) => (
                      <div
                        key={duplicate.id}
                        className="bg-amber-50 border-2 border-amber-200 rounded-xl p-5"
                      >
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex-1">
                            <h5 className="text-lg font-bold text-gray-900">{duplicate.name}</h5>
                            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-gray-600">
                              <div>
                                <span className="font-medium text-gray-700">Patient ID:</span>
                                <p className="mt-0.5">{duplicate.display_id || duplicate.id.slice(0, 8)}</p>
                              </div>
                              <div>
                                <span className="font-medium text-gray-700">Age / Gender:</span>
                                <p className="mt-0.5">{duplicate.age} years / {duplicate.gender}</p>
                              </div>
                              <div>
                                <span className="font-medium text-gray-700">Phone:</span>
                                <p className="mt-0.5">{duplicate.phone}</p>
                              </div>
                              {duplicate.email && (
                                <div>
                                  <span className="font-medium text-gray-700">Email:</span>
                                  <p className="mt-0.5">{duplicate.email}</p>
                                </div>
                              )}
                              <div className="col-span-2">
                                <span className="font-medium text-gray-700">Address:</span>
                                <p className="mt-0.5">{duplicate.address}</p>
                              </div>
                            </div>
                          </div>
                          <div className="ml-4 bg-amber-100 rounded-full p-3">
                            <User className="h-8 w-8 text-amber-600" />
                          </div>
                        </div>

                        {/* Merge Info */}
                        {duplicate.merge_date && (
                          <div className="mt-4 pt-4 border-t border-amber-300 flex items-center justify-between">
                            <div className="flex items-center space-x-4 text-sm text-gray-600">
                              <div className="flex items-center">
                                <Calendar className="h-4 w-4 mr-1.5 text-amber-600" />
                                <span>
                                  Merged on {format(new Date(duplicate.merge_date), 'PPp')}
                                </span>
                              </div>
                              {duplicate.merged_by_name && (
                                <div className="flex items-center">
                                  <User className="h-4 w-4 mr-1.5 text-amber-600" />
                                  <span>by {duplicate.merged_by_name}</span>
                                </div>
                              )}
                            </div>
                            <button
                              onClick={() => handleUnmerge(duplicate.id, duplicate.name)}
                              disabled={unmergingId === duplicate.id}
                              className="px-4 py-2 bg-white border-2 border-amber-500 text-amber-700 rounded-lg hover:bg-amber-50 transition-all font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                            >
                              {unmergingId === duplicate.id ? (
                                <>
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  Unmerging...
                                </>
                              ) : (
                                <>
                                  <Users className="h-4 w-4 mr-2" />
                                  Unmerge
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Info Note */}
              <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start space-x-3">
                  <AlertTriangle className="h-5 w-5 text-blue-600 mt-0.5" />
                  <div className="text-sm text-blue-800">
                    <p className="font-medium mb-1">About Merged Records</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>Duplicate records remain in the database and retain all their orders/tests</li>
                      <li>Duplicates are hidden from the main patient list but accessible here</li>
                      <li>You can unmerge any duplicate to restore it as a separate patient</li>
                      <li>Unmerging does not affect any test results or billing records</li>
                    </ul>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg hover:from-purple-700 hover:to-indigo-700 transition-all font-semibold"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ViewDuplicatesModal;
