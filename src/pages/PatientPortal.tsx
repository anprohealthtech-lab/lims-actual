import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LogOut, Download, Search, RefreshCw, FileText, Printer,
  User, Phone, Droplets, Calendar, ChevronDown, ChevronUp,
  Clock, CheckCircle, Loader, AlertCircle, KeyRound, Eye, EyeOff
} from 'lucide-react';
import { supabase } from '../utils/supabase';
import { getCurrentPatientMeta, patientSignOut } from '../utils/patientAuth';

interface PatientInfo {
  id: string;
  name: string;
  age: number | null;
  gender: string | null;
  phone: string | null;
  blood_group: string | null;
  date_of_birth: string | null;
  display_id: string | null;
}

interface Report {
  id: string;
  pdf_url: string | null;
  print_pdf_url: string | null;
  status: string;
  generated_date: string | null;
}

interface Order {
  id: string;
  sample_id: string | null;
  order_date: string;
  status: string;
  total_amount: number;
  reports: Report | null;
  order_tests?: { test_group?: { name: string } }[];
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  'Pending Collection': { label: 'Pending Collection', color: 'bg-yellow-100 text-yellow-800', icon: <Clock className="h-3 w-3" /> },
  'In Progress':        { label: 'In Progress',        color: 'bg-blue-100 text-blue-800',   icon: <Loader className="h-3 w-3 animate-spin" /> },
  'Pending Approval':   { label: 'Pending Approval',   color: 'bg-orange-100 text-orange-800', icon: <Clock className="h-3 w-3" /> },
  'Report Ready':       { label: 'Report Ready',       color: 'bg-green-100 text-green-800', icon: <CheckCircle className="h-3 w-3" /> },
  'Completed':          { label: 'Completed',          color: 'bg-green-100 text-green-800', icon: <CheckCircle className="h-3 w-3" /> },
  'Delivered':          { label: 'Delivered',          color: 'bg-gray-100 text-gray-700',   icon: <CheckCircle className="h-3 w-3" /> },
};

const PatientPortal: React.FC = () => {
  const navigate = useNavigate();
  const [patient, setPatient] = useState<PatientInfo | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [showChangePIN, setShowChangePIN] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showNewPin, setShowNewPin] = useState(false);
  const [pinLoading, setPinLoading] = useState(false);
  const [pinMessage, setPinMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [labName, setLabName] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    let filtered = [...orders];
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (o) => o.sample_id?.toLowerCase().includes(s) || o.id.toLowerCase().includes(s)
      );
    }
    if (statusFilter !== 'All') {
      filtered = filtered.filter((o) => o.status === statusFilter);
    }
    setFilteredOrders(filtered);
  }, [orders, searchTerm, statusFilter]);

  const loadData = async () => {
    try {
      setLoading(true);
      const meta = await getCurrentPatientMeta();
      if (!meta) { navigate('/patient/login'); return; }

      // Fetch patient record (RLS ensures own record only)
      const { data: patientData } = await supabase
        .from('patients')
        .select('id, name, age, gender, phone, blood_group, date_of_birth, display_id')
        .eq('id', meta.patient_id)
        .single();

      if (patientData) setPatient(patientData);

      // Fetch lab name
      const { data: labData } = await supabase
        .from('labs')
        .select('name')
        .eq('id', meta.lab_id)
        .single();

      if (labData) setLabName(labData.name);

      // Fetch orders (RLS ensures own orders only)
      const { data: ordersData } = await supabase
        .from('orders')
        .select(`
          id, sample_id, order_date, status, total_amount,
          reports(id, pdf_url, print_pdf_url, status, generated_date)
        `)
        .eq('patient_id', meta.patient_id)
        .order('order_date', { ascending: false });

      setOrders(ordersData || []);
    } catch (err) {
      console.error('PatientPortal load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await patientSignOut();
    navigate('/patient/login');
  };

  const handleChangePIN = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinMessage(null);

    if (newPin.length !== 6) { setPinMessage({ type: 'error', text: 'PIN must be exactly 6 digits.' }); return; }
    if (newPin !== confirmPin) { setPinMessage({ type: 'error', text: 'PINs do not match.' }); return; }

    setPinLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPin });
      if (error) throw error;
      setPinMessage({ type: 'success', text: 'PIN changed successfully.' });
      setNewPin('');
      setConfirmPin('');
      setTimeout(() => setShowChangePIN(false), 2000);
    } catch {
      setPinMessage({ type: 'error', text: 'Failed to change PIN. Please try again.' });
    } finally {
      setPinLoading(false);
    }
  };

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const openReport = (url: string) => window.open(url, '_blank');

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600 mx-auto" />
          <p className="mt-4 text-gray-600">Loading your reports...</p>
        </div>
      </div>
    );
  }

  const readyCount = orders.filter((o) => ['Report Ready', 'Completed', 'Delivered'].includes(o.status)).length;

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{labName || 'Patient Portal'}</h1>
            <p className="text-sm text-gray-500 mt-0.5">Your health records</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <LogOut className="h-4 w-4 mr-1.5" />
            Logout
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* Patient Identity Card */}
        {patient && (
          <div className="bg-gradient-to-r from-teal-600 to-cyan-600 rounded-2xl p-6 text-white">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center">
                  <User className="h-7 w-7 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold">{patient.name}</h2>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-teal-100 text-sm">
                    {patient.gender && <span>{patient.gender}</span>}
                    {patient.age && <span>{patient.age} yrs</span>}
                    {patient.blood_group && (
                      <span className="flex items-center gap-1">
                        <Droplets className="h-3.5 w-3.5" />
                        {patient.blood_group}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {patient.display_id && (
                <div className="text-right text-sm text-teal-100">
                  <p className="text-xs">Patient ID</p>
                  <p className="font-mono font-medium">{patient.display_id}</p>
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-4 text-sm text-teal-100">
              {patient.phone && (
                <span className="flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5" />
                  {patient.phone}
                </span>
              )}
              {patient.date_of_birth && (
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  {formatDate(patient.date_of_birth)}
                </span>
              )}
            </div>

            {/* Summary stats */}
            <div className="mt-4 grid grid-cols-3 gap-3">
              {[
                { label: 'Total Orders', value: orders.length },
                { label: 'Reports Ready', value: readyCount },
                { label: 'In Progress', value: orders.length - readyCount },
              ].map(({ label, value }) => (
                <div key={label} className="bg-white/15 rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold">{value}</p>
                  <p className="text-xs text-teal-100 mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Orders & Reports */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          {/* Toolbar */}
          <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search by Sample ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
            >
              <option value="All">All Status</option>
              <option value="Pending Collection">Pending Collection</option>
              <option value="In Progress">In Progress</option>
              <option value="Report Ready">Report Ready</option>
              <option value="Completed">Completed</option>
              <option value="Delivered">Delivered</option>
            </select>
            <button
              onClick={loadData}
              className="flex items-center px-3 py-2 text-sm bg-teal-50 text-teal-700 rounded-lg hover:bg-teal-100 transition-colors"
            >
              <RefreshCw className="h-4 w-4 mr-1.5" />
              Refresh
            </button>
          </div>

          <div className="p-4">
            <p className="text-xs text-gray-500 mb-3">
              Showing {filteredOrders.length} of {orders.length} orders
            </p>

            {filteredOrders.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <FileText className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p className="font-medium">No orders found</p>
                <p className="text-sm mt-1">
                  {orders.length === 0
                    ? 'Your orders will appear here once processed by the lab.'
                    : 'Try adjusting your search or filter.'}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredOrders.map((order) => {
                  const statusCfg = STATUS_CONFIG[order.status] || { label: order.status, color: 'bg-gray-100 text-gray-700', icon: null };
                  const hasReport = !!order.reports?.pdf_url;

                  return (
                    <div
                      key={order.id}
                      className="border border-gray-200 rounded-xl p-4 hover:border-teal-200 hover:bg-teal-50/30 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {order.sample_id && (
                              <span className="font-mono text-sm font-semibold text-gray-900">
                                {order.sample_id}
                              </span>
                            )}
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusCfg.color}`}>
                              {statusCfg.icon}
                              {statusCfg.label}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">{formatDate(order.order_date)}</p>
                        </div>

                        {/* Report Actions */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {hasReport ? (
                            <>
                              <button
                                onClick={() => openReport(order.reports!.pdf_url!)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-white bg-teal-600 hover:bg-teal-700 transition-colors"
                                title="View/Download report"
                              >
                                <FileText className="h-3.5 w-3.5" />
                                E-Copy
                              </button>
                              {order.reports?.print_pdf_url && (
                                <button
                                  onClick={() => openReport(order.reports!.print_pdf_url!)}
                                  className="inline-flex items-center justify-center p-1.5 rounded-lg text-white bg-teal-700 hover:bg-teal-800 transition-colors"
                                  title="Print version"
                                >
                                  <Printer className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </>
                          ) : (
                            <span className="text-xs text-gray-400 italic">Report pending</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Change PIN Section */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <button
            onClick={() => { setShowChangePIN(!showChangePIN); setPinMessage(null); }}
            className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors rounded-xl"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gray-100 rounded-lg flex items-center justify-center">
                <KeyRound className="h-4 w-4 text-gray-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">Change PIN</p>
                <p className="text-xs text-gray-500">Update your 6-digit login PIN</p>
              </div>
            </div>
            {showChangePIN ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
          </button>

          {showChangePIN && (
            <div className="px-4 pb-4 border-t border-gray-100">
              <form onSubmit={handleChangePIN} className="mt-4 space-y-4">
                {pinMessage && (
                  <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${pinMessage.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                    {pinMessage.type === 'success'
                      ? <CheckCircle className="h-4 w-4 flex-shrink-0" />
                      : <AlertCircle className="h-4 w-4 flex-shrink-0" />}
                    {pinMessage.text}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">New PIN</label>
                  <div className="relative">
                    <input
                      type={showNewPin ? 'text' : 'password'}
                      inputMode="numeric"
                      maxLength={6}
                      value={newPin}
                      onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 font-mono tracking-widest pr-10"
                      placeholder="6-digit PIN"
                      required
                    />
                    <button type="button" onClick={() => setShowNewPin(!showNewPin)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showNewPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Confirm New PIN</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 font-mono tracking-widest"
                    placeholder="Repeat PIN"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={pinLoading || newPin.length !== 6 || confirmPin.length !== 6}
                  className="w-full py-2 text-sm font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:bg-teal-300 disabled:cursor-not-allowed transition-colors"
                >
                  {pinLoading ? 'Updating...' : 'Update PIN'}
                </button>
              </form>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default PatientPortal;
