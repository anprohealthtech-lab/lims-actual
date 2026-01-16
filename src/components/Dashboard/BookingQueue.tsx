import React, { useEffect, useState } from 'react';
import { Calendar, Clock, User, Phone, ArrowRight, Home, Building2, Globe, FileText } from 'lucide-react';
import { database } from '../../utils/supabase';
import { Booking } from '../../types';
import { format } from 'date-fns';

interface BookingQueueProps {
    onProcessBooking?: (booking: Booking) => void;
}

const BookingQueue: React.FC<BookingQueueProps> = ({ onProcessBooking }) => {
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadBookings();
    }, []);

    const loadBookings = async () => {
        try {
            setLoading(true);
            const { data, error } = await database.bookings.list(); // Currently fetches all, can filter by status='pending' later
            if (data) {
                setBookings(data as Booking[]);
            }
        } catch (error) {
            console.error('Error loading bookings:', error);
        } finally {
            setLoading(false);
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
            case 'converted': return 'bg-gray-100 text-gray-600'; // Or generic
            case 'cancelled': return 'bg-red-100 text-red-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    if (loading) {
        return (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex items-center justify-center min-h-[200px]">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col h-full">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-primary-600" />
                    Booking Queue
                </h3>
                <span className="text-xs font-medium bg-primary-50 text-primary-700 px-2.5 py-1 rounded-full">
                    {bookings.length} Pending
                </span>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-2 max-h-[400px]">
                {bookings.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 text-sm">
                        No pending bookings found.
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
                                </div>

                                <button
                                    onClick={() => onProcessBooking?.(booking)}
                                    className="text-xs font-medium text-primary-600 hover:text-primary-700 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    Process <ArrowRight className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <div className="p-3 border-t border-gray-100 bg-gray-50 rounded-b-xl">
                <button className="w-full text-center text-xs font-medium text-gray-600 hover:text-primary-600 transition-colors">
                    View All Bookings
                </button>
            </div>
        </div>
    );
};

export default BookingQueue;
