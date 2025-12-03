import React, { useState, useMemo } from 'react';
import {
  Plus, Search, Filter, Edit, Eye, Phone, Mail, QrCode,
  Trash2, Users, Copy, MoreVertical, ChevronDown, ChevronUp
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { generateQRCodeData } from '../utils/colorAssignment';
import { useMobileOptimizations } from '../utils/platformHelper';
import { MobileFAB } from '../components/ui/MobileFAB';
import PatientForm from '../components/Patients/PatientForm';
import PatientDetails from '../components/Patients/PatientDetails';
import PatientTestHistory from '../components/Patients/PatientTestHistory';
import PatientMergeModal from '../components/Patients/PatientMergeModal';
import ViewDuplicatesModal from '../components/Patients/ViewDuplicatesModal';
import { database, supabase, auth } from '../utils/supabase';

interface Patient {
  id: string;
  display_id?: string;
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
  qr_code_data?: string;
  medical_history?: string;
  registration_date: string;
  last_visit: string;
  total_tests: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  test_count?: number;
  duplicate_count?: number;
  duplicate_patient_ids?: string[];
  duplicate_patient_names?: string[];
}

const Patients: React.FC = () => {
  const navigate = useNavigate();
  const mobile = useMobileOptimizations();

  // State
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  // Modals State
  const [activeModal, setActiveModal] = useState<'form' | 'edit' | 'details' | 'history' | 'merge' | 'duplicates' | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [mergePatient, setMergePatient] = useState<Patient | null>(null);

  // UI State
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [isGeneratingCodes, setIsGeneratingCodes] = useState(false);

  // Load Data
  React.useEffect(() => {
    loadPatients();
    checkAdminStatus();
  }, []);

  const checkAdminStatus = async () => {
    try {
      const { user } = await auth.getCurrentUser();
      if (user?.user_metadata?.role === 'Admin') setIsAdmin(true);
    } catch (err) {
      console.error('Error checking admin status:', err);
    }
  };

  const loadPatients = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('v_patients_with_duplicates')
        .select('*')
        .order('registration_date', { ascending: false });

      if (error) throw error;
      setPatients(data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load patients');
    } finally {
      setLoading(false);
    }
  };

  // Filter Logic
  const filteredPatients = useMemo(() => {
    const lowerSearch = searchTerm.toLowerCase();
    return patients.filter(p =>
      p.name.toLowerCase().includes(lowerSearch) ||
      p.id.toLowerCase().includes(lowerSearch) ||
      p.phone.includes(lowerSearch) ||
      (p.display_id && p.display_id.toLowerCase().includes(lowerSearch))
    );
  }, [patients, searchTerm]);

  // Handlers
  const handleAddPatient = async (formData: any) => {
    try {
      const { ocrResults, attachmentId, requestedTests, selectedDoctorId, ...patientDetails } = formData;

      const patientData = {
        name: `${patientDetails.firstName} ${patientDetails.lastName}`.trim(),
        age: parseInt(patientDetails.age),
        gender: patientDetails.gender,
        phone: patientDetails.phone,
        email: patientDetails.email || null,
        address: patientDetails.address,
        city: patientDetails.city,
        state: patientDetails.state,
        pincode: patientDetails.pincode,
        emergency_contact: patientDetails.emergencyContact || null,
        emergency_phone: patientDetails.emergencyPhone || null,
        blood_group: patientDetails.bloodGroup || null,
        allergies: patientDetails.allergies || null,
        medical_history: patientDetails.medicalHistory || null,
        total_tests: 0,
        is_active: true,
        requestedTests: requestedTests || [],
        referring_doctor: patientDetails.referring_doctor || null,
        referring_doctor_id: selectedDoctorId || null,
      };

      const { data, error } = await database.patients.create(patientData);

      if (error) throw error;

      if (attachmentId && data) {
        await supabase.from('attachments').update({ patient_id: data.id, related_id: data.id }).eq('id', attachmentId);
      }

      setPatients(prev => [data, ...prev]);
      setActiveModal(null);

      // Success Feedback
      if (data.order_created) {
        alert(`Patient registered! Order: ${data.matched_tests}/${data.total_tests} tests. Invoice: ₹${data.total_amount?.toFixed(2) || '0'}`);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to add patient');
    }
  };

  const handleUpdatePatient = async (formData: any) => {
    if (!selectedPatient) return;
    try {
      const patientData = {
        name: `${formData.firstName} ${formData.lastName}`.trim(),
        age: parseInt(formData.age),
        gender: formData.gender,
        phone: formData.phone,
        email: formData.email || null,
        address: formData.address,
        city: formData.city,
        state: formData.state,
        pincode: formData.pincode,
        emergency_contact: formData.emergencyContact || null,
        emergency_phone: formData.emergencyPhone || null,
        blood_group: formData.bloodGroup || null,
        allergies: formData.allergies || null,
        medical_history: formData.medicalHistory || null,
      };

      const { data, error } = await supabase
        .from('patients')
        .update(patientData)
        .eq('id', selectedPatient.id)
        .select()
        .single();

      if (error) throw error;

      setPatients(prev => prev.map(p => p.id === selectedPatient.id ? data : p));
      setActiveModal(null);
      setSelectedPatient(null);
    } catch (err: any) {
      setError(err.message || 'Failed to update patient');
    }
  };

  const handleDeletePatient = async (patientId: string) => {
    try {
      const { data: orders } = await supabase.from('orders').select('id').eq('patient_id', patientId);
      if (orders && orders.length > 0) {
        setError(`Cannot delete: Patient has ${orders.length} active orders.`);
        return;
      }

      const { error } = await database.patients.delete(patientId);
      if (error) throw error;

      setPatients(prev => prev.filter(p => p.id !== patientId));
      setConfirmDelete(null);
    } catch (err: any) {
      setError(err.message || 'Failed to delete patient');
    }
  };

  const handleGenerateQrAndColor = async (patientId: string) => {
    try {
      setIsGeneratingCodes(true);
      const { data: patient } = await database.patients.getById(patientId);
      if (!patient) throw new Error('Patient not found');

      const qrCodeData = generateQRCodeData({
        id: patient.id,
        name: patient.name,
        age: patient.age,
        gender: patient.gender
      });

      const { data: updated, error } = await supabase
        .from('patients')
        .update({ qr_code_data: qrCodeData })
        .eq('id', patientId)
        .select()
        .single();

      if (error) throw error;
      if (updated) {
        setPatients(prev => prev.map(p => p.id === patientId ? updated : p));
        if (selectedPatient?.id === patientId) setSelectedPatient(updated);
      }
    } catch (err) {
      console.error(err);
      setError('Failed to generate QR code');
    } finally {
      setIsGeneratingCodes(false);
    }
  };

  // Render Helpers
  const renderActionButtons = (patient: Patient) => (
    <div className="flex items-center justify-end gap-1 flex-nowrap">
      <button onClick={() => { setSelectedPatient(patient); setActiveModal('details'); }} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md transition-colors shrink-0" title="View Details">
        <Eye className="h-4 w-4" />
      </button>
      <button onClick={() => { setSelectedPatient(patient); setActiveModal('edit'); }} className="p-1.5 text-gray-600 hover:bg-gray-100 rounded-md transition-colors shrink-0" title="Edit">
        <Edit className="h-4 w-4" />
      </button>
      {patient.duplicate_count && patient.duplicate_count > 0 ? (
        <button onClick={() => { setSelectedPatient(patient); setActiveModal('duplicates'); }} className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-md transition-colors shrink-0" title="View Duplicates">
          <Users className="h-4 w-4" />
        </button>
      ) : null}
      <button onClick={() => { setMergePatient(patient); setActiveModal('merge'); }} className="p-1.5 text-purple-600 hover:bg-purple-50 rounded-md transition-colors shrink-0" title="Merge">
        <Copy className="h-4 w-4" />
      </button>
      {isAdmin && (
        confirmDelete === patient.id ? (
          <div className="flex items-center bg-red-50 rounded-md shrink-0">
            <button onClick={() => handleDeletePatient(patient.id)} className="p-1.5 text-red-600 hover:text-red-800" title="Confirm">
              <Trash2 className="h-4 w-4" />
            </button>
            <button onClick={() => setConfirmDelete(null)} className="p-1.5 text-gray-500 hover:text-gray-700" title="Cancel">
              <span className="text-xs font-bold">✕</span>
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(patient.id)} className="p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600 rounded-md transition-colors shrink-0" title="Delete">
            <Trash2 className="h-4 w-4" />
          </button>
        )
      )}
    </div>
  );

  if (loading) return <div className="flex justify-center items-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>;

  return (
    <div className={`flex flex-col h-full bg-gray-50 ${mobile.isMobile ? 'p-2' : 'p-6'}`}>
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Patient Management</h1>
          <p className="text-sm text-gray-500 mt-1">Manage patient records, history, and merges.</p>
        </div>

        <div className="flex items-center gap-3">
          {!mobile.isMobile && (
            <>
              <button
                onClick={() => setActiveModal('form')}
                className="inline-flex items-center px-4 py-2 bg-blue-600 rounded-lg text-sm font-medium text-white hover:bg-blue-700 shadow-sm transition-all"
              >
                <Plus className="h-4 w-4 mr-2" />
                New Patient
              </button>
            </>
          )}
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name, ID, phone..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none text-sm"
          />
        </div>
      </div>

      {/* Data Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 overflow-hidden flex flex-col min-w-0">
        <div className="flex-1 overflow-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50/50 sticky top-0 z-10 backdrop-blur-sm">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-[28%]">Patient Info</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-[24%]">Contact</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-[20%]">Status</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider w-[28%]">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {filteredPatients.map((patient) => (
                <tr key={patient.id} className="group hover:bg-gray-50/80 transition-colors">
                  <td className="px-6 py-3">
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-gray-900 truncate max-w-[200px]" title={patient.name}>
                        {patient.name}
                      </span>
                      <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                        <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">{patient.display_id || 'ID: ' + patient.id.slice(0, 8)}</span>
                        <span>•</span>
                        <span>{patient.age}y {patient.gender}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center text-sm text-gray-600">
                        <Phone className="h-3.5 w-3.5 mr-2 text-gray-400" />
                        {patient.phone}
                      </div>
                      {patient.email && (
                        <div className="flex items-center text-xs text-gray-500 truncate max-w-[180px]" title={patient.email}>
                          <Mail className="h-3.5 w-3.5 mr-2 text-gray-400" />
                          {patient.email}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex flex-col gap-1.5 items-start">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
                        {patient.test_count || 0} Tests
                      </span>
                      {patient.duplicate_count && patient.duplicate_count > 0 ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700 border border-amber-100">
                          <Copy className="h-3 w-3 mr-1" />
                          {patient.duplicate_count} Duplicates
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-400">Last: {new Date(patient.last_visit).toLocaleDateString()}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-3 text-right">
                    {renderActionButtons(patient)}
                  </td>
                </tr>
              ))}
              {filteredPatients.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <Users className="h-12 w-12 text-gray-300 mb-3" />
                      <p className="text-base font-medium">No patients found</p>
                      <p className="text-sm mt-1">Try adjusting your search or add a new patient.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="bg-gray-50 px-6 py-3 border-t border-gray-200 text-xs text-gray-500 flex justify-between items-center">
          <span>Showing {filteredPatients.length} patients</span>
          <span>Total: {patients.length}</span>
        </div>
      </div>

      {/* Modals */}
      {activeModal === 'form' && (
        <PatientForm onClose={() => setActiveModal(null)} onSubmit={handleAddPatient} />
      )}

      {activeModal === 'edit' && selectedPatient && (
        <PatientForm onClose={() => setActiveModal(null)} onSubmit={handleUpdatePatient} patient={selectedPatient} />
      )}

      {activeModal === 'details' && selectedPatient && (
        <PatientDetails
          patient={selectedPatient}
          isGeneratingCodes={isGeneratingCodes}
          onGenerateQrAndColor={handleGenerateQrAndColor}
          onClose={() => setActiveModal(null)}
          onEditPatient={(p) => { setSelectedPatient(p); setActiveModal('edit'); }}
          onCreateOrder={(p) => navigate('/orders', { state: { selectedPatient: p } })}
          onViewAllTests={(p) => { setSelectedPatient(p); setActiveModal('history'); }}
        />
      )}

      {activeModal === 'history' && selectedPatient && (
        <PatientTestHistory patient={selectedPatient} onClose={() => setActiveModal(null)} />
      )}

      {activeModal === 'merge' && mergePatient && (
        <PatientMergeModal
          masterPatient={mergePatient}
          onClose={() => setActiveModal(null)}
          onSuccess={() => { setActiveModal(null); loadPatients(); }}
        />
      )}

      {activeModal === 'duplicates' && selectedPatient && (
        <ViewDuplicatesModal
          patientId={selectedPatient.id}
          onClose={() => setActiveModal(null)}
          onUnmerge={() => loadPatients()}
        />
      )}

      <MobileFAB icon={Plus} onClick={() => setActiveModal('form')} label="Add" />
    </div>
  );
};

export default Patients;