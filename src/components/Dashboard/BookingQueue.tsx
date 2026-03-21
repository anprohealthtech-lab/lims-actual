import React, { useEffect, useState } from 'react';
import { Calendar, Clock, User, Phone, ArrowRight, Home, Building2, Globe, FileText, Plus, X, Eye, Trash2, UserCheck, MessageCircle, CheckCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { database } from '../../utils/supabase';
import { Booking } from '../../types';
import { format } from 'date-fns';
import CreateBookingModal from './CreateBookingModal';
import { WhatsAppAPI } from '../../utils/whatsappAPI';

interface BookingQueueProps {
    onProcessBooking?: (booking: Booking) => void;
    onViewAll?: () => void;
}

interface Phlebo {
    id: string;
    name: string;
    email: string;
    phone?: string;
}

const BookingQueue: React.FC<BookingQueueProps> = ({ onProcessBooking, onViewAll }) => {
    const navigate = useNavigate();
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
    const [cancelling, setCancelling] = useState<string | null>(null);

    // Phlebo state
    const [phlebos, setPhlebos] = useState<Phlebo[]>([]);
    const [selectedPhleboId, setSelectedPhleboId] = useState<string>('');
    const [assigningPhlebo, setAssigningPhlebo] = useState(false);
    const [phleboAssigned, setPhleboAssigned] = useState(false);

    // WhatsApp state
    const [sendingWA, setSendingWA] = useState<'patient' | 'phlebo' | null>(null);
    const [waSentTo, setWaSentTo] = useState<Set<string>>(new Set());

    useEffect(() => {
        loadBookings();
        loadPhlebos();
    }, []);

    // Sync selected phlebo when modal opens
    useEffect(() => {
        if (selectedBooking) {
            setSelectedPhleboId(selectedBooking.assigned_phlebo_id || '');
            setPhleboAssigned(false);
            setWaSentTo(new Set());
        }
    }, [selectedBooking?.id]);

    const loadBookings = async () => {
        try {
            setLoading(true);
            const { data, error } = await database.bookings.list({ status: 'pending' });
            if (data) {
                const activeBookings = (data as Booking[]).filter(
                    b => !['converted', 'cancelled'].includes(b.status)
                );
                setBookings(activeBookings);
            }
        } catch (error) {
            console.error('Error loading bookings:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadPhlebos = async () => {
        try {
            const { data } = await database.users.getPhlebotomists();
            if (data) setPhlebos(data as Phlebo[]);
        } catch (err) {
            console.error('Error loading phlebotomists:', err);
        }
    };

    const handleAssignPhlebo = async () => {
        if (!selectedBooking || !selectedPhleboId) return;
        const phlebo = phlebos.find(p => p.id === selectedPhleboId);
        if (!phlebo) return;

        try {
            setAssigningPhlebo(true);
            const { error } = await database.bookings.update(selectedBooking.id, {
                assigned_phlebo_id: selectedPhleboId,
                assigned_phlebo_name: phlebo.name,
            });
            if (error) throw error;

            // Update local state
            setSelectedBooking(prev => prev ? {
                ...prev,
                assigned_phlebo_id: selectedPhleboId,
                assigned_phlebo_name: phlebo.name,
            } : null);
            setBookings(prev => prev.map(b => b.id === selectedBooking.id
                ? { ...b, assigned_phlebo_id: selectedPhleboId, assigned_phlebo_name: phlebo.name }
                : b
            ));
            setPhleboAssigned(true);
        } catch (err) {
            console.error('Error assigning phlebo:', err);
            alert('Failed to assign phlebotomist');
        } finally {
            setAssigningPhlebo(false);
        }
    };

    const buildPatientMessage = (booking: Booking, phleboName?: string) => {
        const patientName = booking.patient_info?.name || 'Patient';
        const scheduledStr = booking.scheduled_at
            ? format(new Date(booking.scheduled_at), 'dd MMM yyyy \'at\' hh:mm a')
            : 'your scheduled time';
        const address = booking.home_collection_address?.address || '';
        const tests = booking.test_details?.map(t => t.name).join(', ') || 'requested tests';

        let msg = `Hello ${patientName},\n\nYour home collection is confirmed for ${scheduledStr}.`;
        if (address) msg += `\n\nCollection address: ${address}`;
        if (phleboName) msg += `\n\nOur phlebotomist *${phleboName}* will visit you for sample collection.`;
        msg += `\n\nTests: ${tests}`;
        msg += `\n\nKindly be available at the time of collection. Thank you!`;
        return msg;
    };

    const buildPhleboMessage = (booking: Booking, phleboName?: string) => {
        const patientName = booking.patient_info?.name || 'Patient';
        const patientPhone = booking.patient_info?.phone || '';
        const scheduledStr = booking.scheduled_at
            ? format(new Date(booking.scheduled_at), 'dd MMM yyyy \'at\' hh:mm a')
            : 'scheduled time';
        const address = booking.home_collection_address?.address || '';
        const tests = booking.test_details?.map(t => t.name).join(', ') || 'as requested';

        let msg = `Hi ${phleboName || 'Phlebotomist'},\n\nYou have a *home collection assignment*:\n`;
        msg += `\nPatient: *${patientName}*`;
        if (patientPhone) msg += `\nPhone: ${patientPhone}`;
        msg += `\nScheduled: ${scheduledStr}`;
        if (address) msg += `\nAddress: ${address}`;
        msg += `\nTests: ${tests}`;
        msg += `\n\nPlease be on time. Thank you!`;
        return msg;
    };

    const handleSendWhatsApp = async (target: 'patient' | 'phlebo') => {
        if (!selectedBooking) return;

        const phleboName = selectedBooking.assigned_phlebo_name ||
            phlebos.find(p => p.id === selectedPhleboId)?.name;

        let phone: string | undefined;
        let message: string;

        if (target === 'patient') {
            phone = selectedBooking.patient_info?.phone;
            message = buildPatientMessage(selectedBooking, phleboName);
        } else {
            const phlebo = phlebos.find(p => p.id === (selectedBooking.assigned_phlebo_id || selectedPhleboId));
            phone = phlebo?.phone;
            message = buildPhleboMessage(selectedBooking, phleboName);
        }

        if (!phone) {
            alert(`No phone number found for ${target === 'patient' ? 'patient' : 'phlebotomist'}`);
            return;
        }

        try {
            setSendingWA(target);
            const result = await WhatsAppAPI.sendTextMessage(phone, message);
            if (result.success) {
                setWaSentTo(prev => new Set([...prev, target]));
            } else {
                alert(`Failed to send WhatsApp: ${result.message || 'Unknown error'}`);
            }
        } catch (err) {
            console.error('WhatsApp send error:', err);
            alert('Failed to send WhatsApp message');
        } finally {
            setSendingWA(null);
        }
    };

    const handleCancelBooking = async (bookingId: string) => {
        if (!window.confirm('Are you sure you want to cancel this booking?')) return;

        try {
            setCancelling(bookingId);
            const { error } = await database.bookings.update(bookingId, {
                status: 'cancelled',
                updated_at: new Date().toISOString()
            });
            if (error) throw error;
            await loadBookings();
        } catch (error) {
            console.error('Error cancelling booking:', error);
            alert('Failed to cancel booking');
        } finally {
            setCancelling(null);
        }
    };

    const getSourceIcon = (source: string) => {
        switch (source) {
            case 'b2b_portal': return <Building2 className="w-4 h-4 text-blue-500" />;
            case 'front_desk': return <User className="w-4 h-4 text-green-500" />;
            case 'patient_app': return <Phone className="w-4 h-4 text-purple-500" />;
            case 'phone_call': return <Phone className="w-4 h-4 text-orange-500" />;
            default: return <Globe className="w-4 h-4 text-gray-500" />;
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'pending': return 'bg-yellow-100 text-yellow-800';
            case 'quoted': return 'bg-blue-100 text-blue-800';
            case 'confirmed': return 'bg-green-100 text-green-800';
            case 'converted': return 'bg-gray-100 text-gray-600';
            case 'cancelled': return 'bg-red-100 text-red-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    const currentPhlebo = phlebos.find(p => p.id === (selectedBooking?.assigned_phlebo_id || selectedPhleboId));
    const canSendPhleboWA = !!(currentPhlebo?.phone);
    const canSendPatientWA = !!(selectedBooking?.patient_info?.phone);

    if (loading) {
        return (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex items-center justify-center min-h-[200px]">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
        );
    }

    return (
        <>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col h-full">
                <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                        <Calendar className="w-5 h-5 text-primary-600" />
                        Booking Queue
                    </h3>
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-medium bg-primary-50 text-primary-700 px-2.5 py-1 rounded-full">
                            {bookings.length} Pending
                        </span>
                        <button
                            onClick={() => setShowCreateModal(true)}
                            className="p-1.5 bg-primary-50 text-primary-600 rounded-lg hover:bg-primary-100 transition-colors"
                            title="Log Phone Booking"
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-2 max-h-[400px]">
                    {bookings.length === 0 ? (
                        <div className="text-center py-8 text-gray-500 text-sm flex flex-col items-center gap-2">
                            <span>No pending bookings found.</span>
                            <button
                                onClick={() => setShowCreateModal(true)}
                                className="text-primary-600 font-medium hover:underline"
                            >
                                Log a call?
                            </button>
                        </div>
                    ) : (
                        bookings.map((booking) => (
                            <div
                                key={booking.id}
                                className="p-3 rounded-lg border border-gray-100 hover:border-primary-200 hover:shadow-sm transition-all bg-gray-50/50 group"
                            >
                                <div className="flex items-start justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        {getSourceIcon(booking.booking_source)}
                                        <span className="font-medium text-gray-900">
                                            {booking.patient_info?.name || 'Unknown Patient'}
                                        </span>
                                    </div>
                                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${getStatusColor(booking.status)}`}>
                                        {booking.status}
                                    </span>
                                </div>

                                <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
                                    <div className="flex items-center gap-1">
                                        <Phone className="w-3 h-3" />
                                        {booking.patient_info?.phone || 'N/A'}
                                    </div>
                                    {booking.scheduled_at && (
                                        <div className="flex items-center gap-1">
                                            <Clock className="w-3 h-3" />
                                            {format(new Date(booking.scheduled_at), 'dd MMM, hh:mm a')}
                                        </div>
                                    )}
                                    <div className="flex items-center gap-1">
                                        {booking.collection_type === 'home_collection' ? (
                                            <>
                                                <Home className="w-3 h-3 text-orange-500" />
                                                <span className="text-orange-600 font-medium">Home Visit</span>
                                            </>
                                        ) : (
                                            <span className="text-gray-400">Walk-in</span>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center justify-between">
                                    <div className="text-xs text-gray-500">
                                        <span className="font-medium text-gray-700">{booking.test_details?.length || 0}</span> tests requested
                                        {booking.assigned_phlebo_name && (
                                            <span className="ml-2 text-green-600 font-medium flex items-center gap-1 inline-flex">
                                                <UserCheck className="w-3 h-3" />
                                                {booking.assigned_phlebo_name}
                                            </span>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={() => setSelectedBooking(booking)}
                                            className="text-xs font-medium text-gray-500 hover:text-gray-700 flex items-center gap-1"
                                            title="View Details"
                                        >
                                            <Eye className="w-3 h-3" />
                                        </button>
                                        <button
                                            onClick={() => handleCancelBooking(booking.id)}
                                            disabled={cancelling === booking.id}
                                            className="text-xs font-medium text-red-500 hover:text-red-700 flex items-center gap-1 disabled:opacity-50"
                                            title="Cancel Booking"
                                        >
                                            {cancelling === booking.id ? (
                                                <span className="animate-spin">⏳</span>
                                            ) : (
                                                <Trash2 className="w-3 h-3" />
                                            )}
                                        </button>
                                        <button
                                            onClick={() => onProcessBooking?.(booking)}
                                            className="text-xs font-medium text-primary-600 hover:text-primary-700 flex items-center gap-1"
                                        >
                                            Process <ArrowRight className="w-3 h-3" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <div className="p-3 border-t border-gray-100 bg-gray-50 rounded-b-xl">
                    <button
                        onClick={() => onViewAll ? onViewAll() : navigate('/orders')}
                        className="w-full text-center text-xs font-medium text-gray-600 hover:text-primary-600 transition-colors"
                    >
                        View All Bookings
                    </button>
                </div>
            </div>

            {showCreateModal && (
                <CreateBookingModal
                    onClose={() => setShowCreateModal(false)}
                    onSuccess={() => {
                        setShowCreateModal(false);
                        loadBookings();
                    }}
                />
            )}

            {/* Booking Details Modal */}
            {selectedBooking && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col">
                        <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gray-50 flex-shrink-0">
                            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                                <FileText className="w-4 h-4 text-blue-600" />
                                Booking Details
                            </h3>
                            <button onClick={() => setSelectedBooking(null)} className="p-1 hover:bg-gray-200 rounded-full">
                                <X className="w-5 h-5 text-gray-500" />
                            </button>
                        </div>

                        <div className="p-4 space-y-4 overflow-y-auto">
                            {/* Patient Info */}
                            <div>
                                <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Patient</h4>
                                <div className="bg-gray-50 rounded-lg p-3">
                                    <p className="font-medium text-gray-900">{selectedBooking.patient_info?.name || 'N/A'}</p>
                                    <p className="text-sm text-gray-600">{selectedBooking.patient_info?.phone || 'N/A'}</p>
                                    {selectedBooking.patient_info?.email && (
                                        <p className="text-sm text-gray-500">{selectedBooking.patient_info.email}</p>
                                    )}
                                </div>
                            </div>

                            {/* Booking Info */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Source</h4>
                                    <div className="flex items-center gap-1">
                                        {getSourceIcon(selectedBooking.booking_source)}
                                        <span className="text-sm capitalize">{selectedBooking.booking_source.replace('_', ' ')}</span>
                                    </div>
                                </div>
                                <div>
                                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Status</h4>
                                    <span className={`text-xs uppercase font-bold px-2 py-0.5 rounded-full ${getStatusColor(selectedBooking.status)}`}>
                                        {selectedBooking.status}
                                    </span>
                                </div>
                                <div>
                                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Collection</h4>
                                    <span className="text-sm capitalize">{selectedBooking.collection_type?.replace('_', ' ') || 'Walk-in'}</span>
                                </div>
                                <div>
                                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Scheduled</h4>
                                    <span className="text-sm">
                                        {selectedBooking.scheduled_at
                                            ? format(new Date(selectedBooking.scheduled_at), 'dd MMM yyyy, hh:mm a')
                                            : 'Not scheduled'}
                                    </span>
                                </div>
                            </div>

                            {/* Tests */}
                            {selectedBooking.test_details && selectedBooking.test_details.length > 0 && (
                                <div>
                                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Requested Tests</h4>
                                    <div className="bg-gray-50 rounded-lg p-3 space-y-1">
                                        {selectedBooking.test_details.map((test, i) => (
                                            <div key={i} className="flex justify-between text-sm">
                                                <span>{test.name}</span>
                                                {test.price && <span className="text-gray-500">₹{test.price}</span>}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Home Collection Address */}
                            {selectedBooking.collection_type === 'home_collection' && selectedBooking.home_collection_address && (
                                <div>
                                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Collection Address</h4>
                                    <div className="bg-orange-50 rounded-lg p-3 text-sm text-orange-800">
                                        {selectedBooking.home_collection_address.address}
                                        {selectedBooking.home_collection_address.city && `, ${selectedBooking.home_collection_address.city}`}
                                        {selectedBooking.home_collection_address.pincode && ` - ${selectedBooking.home_collection_address.pincode}`}
                                    </div>
                                </div>
                            )}

                            {/* Phlebotomist Assignment */}
                            <div>
                                <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center gap-1">
                                    <UserCheck className="w-3 h-3" />
                                    Assign Phlebotomist
                                </h4>
                                <div className="flex gap-2">
                                    <select
                                        value={selectedPhleboId}
                                        onChange={e => { setSelectedPhleboId(e.target.value); setPhleboAssigned(false); }}
                                        className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary-300"
                                    >
                                        <option value="">-- Select Phlebotomist --</option>
                                        {phlebos.map(p => (
                                            <option key={p.id} value={p.id}>{p.name}</option>
                                        ))}
                                    </select>
                                    <button
                                        onClick={handleAssignPhlebo}
                                        disabled={!selectedPhleboId || assigningPhlebo}
                                        className="px-3 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 whitespace-nowrap"
                                    >
                                        {assigningPhlebo ? (
                                            <span className="animate-spin">⏳</span>
                                        ) : phleboAssigned ? (
                                            <><CheckCircle className="w-4 h-4" /> Assigned</>
                                        ) : (
                                            'Assign'
                                        )}
                                    </button>
                                </div>
                                {selectedBooking.assigned_phlebo_name && (
                                    <p className="mt-1.5 text-xs text-green-600 flex items-center gap-1">
                                        <CheckCircle className="w-3 h-3" />
                                        Currently assigned: <span className="font-medium">{selectedBooking.assigned_phlebo_name}</span>
                                    </p>
                                )}
                                {phlebos.length === 0 && (
                                    <p className="mt-1.5 text-xs text-gray-400">No phlebotomists found. Mark users as phlebotomists in User Settings.</p>
                                )}
                            </div>

                            {/* WhatsApp Notifications */}
                            <div>
                                <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center gap-1">
                                    <MessageCircle className="w-3 h-3" />
                                    Send WhatsApp Notification
                                </h4>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleSendWhatsApp('patient')}
                                        disabled={!canSendPatientWA || sendingWA === 'patient'}
                                        title={!canSendPatientWA ? 'Patient phone number not available' : 'Notify patient about home collection'}
                                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border transition-colors
                                            ${waSentTo.has('patient')
                                                ? 'bg-green-50 border-green-300 text-green-700'
                                                : 'bg-white border-gray-200 text-gray-700 hover:bg-green-50 hover:border-green-300 hover:text-green-700'}
                                            disabled:opacity-50 disabled:cursor-not-allowed`}
                                    >
                                        {sendingWA === 'patient' ? (
                                            <span className="animate-spin text-xs">⏳</span>
                                        ) : waSentTo.has('patient') ? (
                                            <CheckCircle className="w-4 h-4 text-green-600" />
                                        ) : (
                                            <MessageCircle className="w-4 h-4 text-green-600" />
                                        )}
                                        {waSentTo.has('patient') ? 'Sent to Patient' : 'Notify Patient'}
                                    </button>

                                    <button
                                        onClick={() => handleSendWhatsApp('phlebo')}
                                        disabled={!canSendPhleboWA || sendingWA === 'phlebo' || !(selectedBooking.assigned_phlebo_id || selectedPhleboId)}
                                        title={
                                            !(selectedBooking.assigned_phlebo_id || selectedPhleboId)
                                                ? 'Assign a phlebotomist first'
                                                : !canSendPhleboWA
                                                    ? 'Phlebotomist has no phone number'
                                                    : 'Notify phlebotomist about assignment'
                                        }
                                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border transition-colors
                                            ${waSentTo.has('phlebo')
                                                ? 'bg-blue-50 border-blue-300 text-blue-700'
                                                : 'bg-white border-gray-200 text-gray-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700'}
                                            disabled:opacity-50 disabled:cursor-not-allowed`}
                                    >
                                        {sendingWA === 'phlebo' ? (
                                            <span className="animate-spin text-xs">⏳</span>
                                        ) : waSentTo.has('phlebo') ? (
                                            <CheckCircle className="w-4 h-4 text-blue-600" />
                                        ) : (
                                            <MessageCircle className="w-4 h-4 text-blue-600" />
                                        )}
                                        {waSentTo.has('phlebo') ? 'Sent to Phlebo' : 'Notify Phlebo'}
                                    </button>
                                </div>
                                {!(selectedBooking.assigned_phlebo_id || selectedPhleboId) && (
                                    <p className="mt-1.5 text-xs text-amber-600">Assign a phlebotomist to enable phlebo notification.</p>
                                )}
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2 p-4 border-t border-gray-100 flex-shrink-0">
                            <button
                                onClick={() => {
                                    handleCancelBooking(selectedBooking.id);
                                    setSelectedBooking(null);
                                }}
                                className="flex-1 px-4 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg"
                            >
                                Cancel Booking
                            </button>
                            <button
                                onClick={() => {
                                    onProcessBooking?.(selectedBooking);
                                    setSelectedBooking(null);
                                }}
                                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg"
                            >
                                Process → Order
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default BookingQueue;
