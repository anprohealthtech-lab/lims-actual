// src/components/WhatsApp/QueueManagement.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Trash2, Clock, AlertCircle, CheckCircle, Loader, FileText, Bell, MapPin, Building2, User, Calendar, Filter } from 'lucide-react';
import { supabase, database } from '../../utils/supabase';

interface PdfQueueItem {
    id: string;
    order_id: string;
    lab_id: string;
    status: string;
    error_message?: string;
    created_at: string;
    updated_at?: string;
    started_at?: string;
    completed_at?: string;
    progress_stage?: string;
    progress_percent?: number;
    retry_count?: number;
    // Joined from orders
    orders?: {
        patient_name?: string;
        sample_id?: string;
        location_id?: string;
        locations?: {
            name?: string;
        };
    };
}

interface NotificationQueueItem {
    id: string;
    lab_id: string;
    recipient_type: string;
    recipient_phone: string;
    recipient_name?: string;
    trigger_type: string;
    status: string;
    last_error?: string;
    retry_count: number;
    created_at: string;
    updated_at?: string;
    // Location comes through orders relationship
    orders?: {
        location_id?: string;
        locations?: {
            name?: string;
        };
    };
}

interface Location {
    id: string;
    name: string;
}

const QueueManagement: React.FC = () => {
    const [pdfQueue, setPdfQueue] = useState<PdfQueueItem[]>([]);
    const [notificationQueue, setNotificationQueue] = useState<NotificationQueueItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [labId, setLabId] = useState<string | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'pdf' | 'notification'; id: string } | null>(null);
    const [deleting, setDeleting] = useState(false);

    // Location filtering
    const [locations, setLocations] = useState<Location[]>([]);
    const [selectedLocationId, setSelectedLocationId] = useState<string>('all');
    const [userLocationIds, setUserLocationIds] = useState<string[]>([]);

    // Fetch user's locations
    useEffect(() => {
        const fetchUserLocations = async () => {
            try {
                const id = await database.getCurrentUserLabId();
                setLabId(id);

                if (id) {
                    // Get user's accessible location IDs
                    const locationIds = await database.getCurrentUserLocationIds();
                    setUserLocationIds(locationIds);

                    // Get location details
                    if (locationIds.length > 0) {
                        const { data: locData } = await supabase
                            .from('locations')
                            .select('id, name')
                            .in('id', locationIds)
                            .order('name');
                        setLocations(locData || []);
                    }
                }
            } catch (err) {
                console.error('Error fetching user locations:', err);
            }
        };
        fetchUserLocations();
    }, []);

    const fetchQueues = useCallback(async () => {
        if (!labId) return;

        setLoading(true);
        try {
            // Fetch PDF Queue with order details for location filtering
            let pdfQuery = supabase
                .from('pdf_generation_queue')
                .select(`
                    *,
                    orders!inner (
                        patient_name,
                        sample_id,
                        location_id,
                        locations!location_id ( name )
                    )
                `)
                .eq('lab_id', labId)
                .order('created_at', { ascending: false })
                .limit(100);

            // Apply location filter if selected
            if (selectedLocationId !== 'all') {
                pdfQuery = pdfQuery.eq('orders.location_id', selectedLocationId);
            } else if (userLocationIds.length > 0) {
                // Filter by user's accessible locations
                pdfQuery = pdfQuery.in('orders.location_id', userLocationIds);
            }

            const { data: pdfData, error: pdfError } = await pdfQuery;

            if (pdfError) console.error('Error fetching PDF queue:', pdfError);
            else setPdfQueue(pdfData || []);

            // Fetch Notification Queue
            // NOTE: notification_queue doesn't have location_id, but has order_id
            // We can join through orders -> locations for location filtering
            let notifQuery = supabase
                .from('notification_queue')
                .select(`
                    *,
                    orders ( location_id, locations!location_id ( name ) )
                `)
                .eq('lab_id', labId)
                .order('created_at', { ascending: false })
                .limit(100);

            // Apply location filter through orders relationship
            if (selectedLocationId !== 'all') {
                notifQuery = notifQuery.eq('orders.location_id', selectedLocationId);
            } else if (userLocationIds.length > 0) {
                notifQuery = notifQuery.in('orders.location_id', userLocationIds);
            }

            const { data: notifData, error: notifError } = await notifQuery;

            if (notifError) console.error('Error fetching notification queue:', notifError);
            else setNotificationQueue(notifData || []);
        } catch (err) {
            console.error('Error fetching queues:', err);
        } finally {
            setLoading(false);
        }
    }, [labId, selectedLocationId, userLocationIds]);

    useEffect(() => {
        if (labId) fetchQueues();
    }, [labId, fetchQueues]);

    const handleDelete = async () => {
        if (!deleteConfirm) return;

        setDeleting(true);
        try {
            const table = deleteConfirm.type === 'pdf' ? 'pdf_generation_queue' : 'notification_queue';
            const { error } = await supabase
                .from(table)
                .delete()
                .eq('id', deleteConfirm.id);

            if (error) throw error;

            // Refresh the list
            await fetchQueues();
            setDeleteConfirm(null);
        } catch (err) {
            console.error('Error deleting:', err);
            alert('Failed to delete. Please try again.');
        } finally {
            setDeleting(false);
        }
    };

    const getStatusBadge = (status: string) => {
        const styles: Record<string, string> = {
            pending: 'bg-yellow-100 text-yellow-800 border border-yellow-200',
            processing: 'bg-blue-100 text-blue-800 border border-blue-200',
            completed: 'bg-green-100 text-green-800 border border-green-200',
            failed: 'bg-red-100 text-red-800 border border-red-200',
            sent: 'bg-green-100 text-green-800 border border-green-200',
        };

        const icons: Record<string, React.ReactNode> = {
            pending: <Clock className="w-3 h-3" />,
            processing: <Loader className="w-3 h-3 animate-spin" />,
            completed: <CheckCircle className="w-3 h-3" />,
            failed: <AlertCircle className="w-3 h-3" />,
            sent: <CheckCircle className="w-3 h-3" />,
        };

        return (
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-800 border border-gray-200'}`}>
                {icons[status]}
                {status}
            </span>
        );
    };

    // Improved date formatting
    const formatDateTime = (dateStr?: string | null): string => {
        if (!dateStr) return '-';

        try {
            const date = new Date(dateStr);
            // Check for invalid date (epoch 0 or NaN)
            if (isNaN(date.getTime()) || date.getFullYear() < 2020) {
                return '-';
            }

            const now = new Date();
            const diffMs = now.getTime() - date.getTime();
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMins / 60);
            const diffDays = Math.floor(diffHours / 24);

            if (diffMins < 1) return 'Just now';
            if (diffMins < 60) return `${diffMins}m ago`;
            if (diffHours < 24) return `${diffHours}h ago`;
            if (diffDays < 7) return `${diffDays}d ago`;

            // Format as date and time
            return date.toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
        } catch {
            return '-';
        }
    };

    const getEffectiveDate = (item: PdfQueueItem): string => {
        // Use updated_at if available, otherwise created_at
        return formatDateTime(item.updated_at || item.created_at);
    };

    const canDelete = (status: string) => {
        return ['pending', 'processing', 'failed'].includes(status);
    };

    // Count by status
    const pdfStatusCounts = {
        pending: pdfQueue.filter(i => i.status === 'pending').length,
        processing: pdfQueue.filter(i => i.status === 'processing').length,
        completed: pdfQueue.filter(i => i.status === 'completed').length,
        failed: pdfQueue.filter(i => i.status === 'failed').length,
    };

    const notifStatusCounts = {
        pending: notificationQueue.filter(i => i.status === 'pending').length,
        processing: notificationQueue.filter(i => i.status === 'processing').length,
        sent: notificationQueue.filter(i => i.status === 'sent').length,
        failed: notificationQueue.filter(i => i.status === 'failed').length,
    };

    if (loading && !pdfQueue.length && !notificationQueue.length) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Location Filter */}
            {locations.length > 1 && (
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 text-gray-600">
                            <Filter className="w-4 h-4" />
                            <span className="text-sm font-medium">Filter by Location:</span>
                        </div>
                        <select
                            value={selectedLocationId}
                            onChange={(e) => setSelectedLocationId(e.target.value)}
                            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                            <option value="all">All Locations</option>
                            {locations.map(loc => (
                                <option key={loc.id} value={loc.id}>{loc.name}</option>
                            ))}
                        </select>
                    </div>
                </div>
            )}

            {/* PDF Queue Section */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-b">
                    <div className="flex items-center gap-3">
                        <div className="bg-blue-100 p-2 rounded-lg">
                            <FileText className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-gray-900">PDF Generation Queue</h3>
                            <div className="flex items-center gap-3 mt-1 text-xs">
                                <span className="text-yellow-600">{pdfStatusCounts.pending} pending</span>
                                <span className="text-blue-600">{pdfStatusCounts.processing} processing</span>
                                <span className="text-green-600">{pdfStatusCounts.completed} completed</span>
                                {pdfStatusCounts.failed > 0 && (
                                    <span className="text-red-600">{pdfStatusCounts.failed} failed</span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="bg-blue-600 text-white text-sm px-3 py-1 rounded-full font-medium">
                            {pdfQueue.length}
                        </span>
                        <button
                            onClick={fetchQueues}
                            disabled={loading}
                            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-white/80 rounded-lg transition-colors"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                            Refresh
                        </button>
                    </div>
                </div>

                {pdfQueue.length === 0 ? (
                    <div className="p-12 text-center">
                        <FileText className="w-16 h-16 mx-auto mb-3 text-gray-200" />
                        <p className="text-gray-500 font-medium">No PDF jobs in queue</p>
                        <p className="text-gray-400 text-sm mt-1">PDF generation jobs will appear here</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                                <tr>
                                    <th className="px-5 py-3 text-left font-semibold">Order / Patient</th>
                                    <th className="px-5 py-3 text-left font-semibold">Location</th>
                                    <th className="px-5 py-3 text-left font-semibold">Status</th>
                                    <th className="px-5 py-3 text-left font-semibold">Created</th>
                                    <th className="px-5 py-3 text-left font-semibold">Last Updated</th>
                                    <th className="px-5 py-3 text-left font-semibold">Error</th>
                                    <th className="px-5 py-3 text-right font-semibold">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {pdfQueue.map((item) => (
                                    <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-5 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="bg-gray-100 p-2 rounded-lg">
                                                    <User className="w-4 h-4 text-gray-500" />
                                                </div>
                                                <div>
                                                    <div className="font-medium text-gray-900">
                                                        {item.orders?.patient_name || 'Unknown Patient'}
                                                    </div>
                                                    <div className="text-xs text-gray-500 font-mono mt-0.5">
                                                        {item.orders?.sample_id || item.order_id.slice(0, 8) + '...'}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-5 py-4">
                                            {item.orders?.locations?.name ? (
                                                <div className="flex items-center gap-1.5 text-sm text-gray-600">
                                                    <MapPin className="w-3.5 h-3.5 text-gray-400" />
                                                    {item.orders.locations.name}
                                                </div>
                                            ) : (
                                                <span className="text-gray-400 text-sm">-</span>
                                            )}
                                        </td>
                                        <td className="px-5 py-4">
                                            {getStatusBadge(item.status)}
                                            {item.progress_stage && (
                                                <div className="text-xs text-gray-500 mt-1">
                                                    {item.progress_stage}
                                                    {item.progress_percent !== undefined && ` (${item.progress_percent}%)`}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-5 py-4">
                                            <div className="flex items-center gap-1.5 text-sm text-gray-600">
                                                <Calendar className="w-3.5 h-3.5 text-gray-400" />
                                                {formatDateTime(item.created_at)}
                                            </div>
                                        </td>
                                        <td className="px-5 py-4 text-sm text-gray-500">
                                            {getEffectiveDate(item)}
                                        </td>
                                        <td className="px-5 py-4">
                                            {item.error_message ? (
                                                <div className="max-w-xs">
                                                    <span className="text-sm text-red-600 line-clamp-2" title={item.error_message}>
                                                        {item.error_message}
                                                    </span>
                                                    {item.retry_count !== undefined && item.retry_count > 0 && (
                                                        <div className="text-xs text-gray-400 mt-1">
                                                            Retried {item.retry_count} time(s)
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="text-gray-400">-</span>
                                            )}
                                        </td>
                                        <td className="px-5 py-4 text-right">
                                            {canDelete(item.status) && (
                                                <button
                                                    onClick={() => setDeleteConfirm({ type: 'pdf', id: item.id })}
                                                    className="text-gray-400 hover:text-red-600 p-2 rounded-lg hover:bg-red-50 transition-colors"
                                                    title="Delete from queue"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Notification Queue Section */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-green-50 to-emerald-50 border-b">
                    <div className="flex items-center gap-3">
                        <div className="bg-green-100 p-2 rounded-lg">
                            <Bell className="w-5 h-5 text-green-600" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-gray-900">Notification Queue</h3>
                            <div className="flex items-center gap-3 mt-1 text-xs">
                                <span className="text-yellow-600">{notifStatusCounts.pending} pending</span>
                                <span className="text-blue-600">{notifStatusCounts.processing} processing</span>
                                <span className="text-green-600">{notifStatusCounts.sent} sent</span>
                                {notifStatusCounts.failed > 0 && (
                                    <span className="text-red-600">{notifStatusCounts.failed} failed</span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="bg-green-600 text-white text-sm px-3 py-1 rounded-full font-medium">
                            {notificationQueue.length}
                        </span>
                        <button
                            onClick={fetchQueues}
                            disabled={loading}
                            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-white/80 rounded-lg transition-colors"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                            Refresh
                        </button>
                    </div>
                </div>

                {notificationQueue.length === 0 ? (
                    <div className="p-12 text-center">
                        <Bell className="w-16 h-16 mx-auto mb-3 text-gray-200" />
                        <p className="text-gray-500 font-medium">No notifications in queue</p>
                        <p className="text-gray-400 text-sm mt-1">WhatsApp notifications will appear here</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                                <tr>
                                    <th className="px-5 py-3 text-left font-semibold">Recipient</th>
                                    <th className="px-5 py-3 text-left font-semibold">Location</th>
                                    <th className="px-5 py-3 text-left font-semibold">Type</th>
                                    <th className="px-5 py-3 text-left font-semibold">Trigger</th>
                                    <th className="px-5 py-3 text-left font-semibold">Status</th>
                                    <th className="px-5 py-3 text-left font-semibold">Created</th>
                                    <th className="px-5 py-3 text-left font-semibold">Error</th>
                                    <th className="px-5 py-3 text-right font-semibold">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {notificationQueue.map((item) => (
                                    <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-5 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className={`p-2 rounded-lg ${item.recipient_type === 'patient' ? 'bg-purple-100' : 'bg-indigo-100'}`}>
                                                    <User className={`w-4 h-4 ${item.recipient_type === 'patient' ? 'text-purple-600' : 'text-indigo-600'}`} />
                                                </div>
                                                <div>
                                                    <div className="font-medium text-gray-900">
                                                        {item.recipient_name || 'Unknown'}
                                                    </div>
                                                    <div className="text-xs text-gray-500 mt-0.5">
                                                        {item.recipient_phone}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-5 py-4">
                                            {item.orders?.locations?.name ? (
                                                <div className="flex items-center gap-1.5 text-sm text-gray-600">
                                                    <MapPin className="w-3.5 h-3.5 text-gray-400" />
                                                    {item.orders.locations.name}
                                                </div>
                                            ) : (
                                                <span className="text-gray-400 text-sm">-</span>
                                            )}
                                        </td>
                                        <td className="px-5 py-4">
                                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                                                item.recipient_type === 'patient'
                                                    ? 'bg-purple-100 text-purple-800 border border-purple-200'
                                                    : 'bg-indigo-100 text-indigo-800 border border-indigo-200'
                                            }`}>
                                                {item.recipient_type}
                                            </span>
                                        </td>
                                        <td className="px-5 py-4">
                                            <span className="text-sm text-gray-600 capitalize">
                                                {item.trigger_type?.replace(/_/g, ' ') || '-'}
                                            </span>
                                        </td>
                                        <td className="px-5 py-4">
                                            {getStatusBadge(item.status)}
                                            {item.retry_count > 0 && (
                                                <div className="text-xs text-gray-400 mt-1">
                                                    Retry #{item.retry_count}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-5 py-4">
                                            <div className="flex items-center gap-1.5 text-sm text-gray-600">
                                                <Calendar className="w-3.5 h-3.5 text-gray-400" />
                                                {formatDateTime(item.created_at)}
                                            </div>
                                        </td>
                                        <td className="px-5 py-4">
                                            {item.last_error ? (
                                                <span className="text-sm text-red-600 line-clamp-2 max-w-xs" title={item.last_error}>
                                                    {item.last_error}
                                                </span>
                                            ) : (
                                                <span className="text-gray-400">-</span>
                                            )}
                                        </td>
                                        <td className="px-5 py-4 text-right">
                                            {canDelete(item.status) && (
                                                <button
                                                    onClick={() => setDeleteConfirm({ type: 'notification', id: item.id })}
                                                    className="text-gray-400 hover:text-red-600 p-2 rounded-lg hover:bg-red-50 transition-colors"
                                                    title="Delete from queue"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Delete Confirmation Modal */}
            {deleteConfirm && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="bg-red-100 p-3 rounded-full">
                                <Trash2 className="w-6 h-6 text-red-600" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-gray-900">Delete Queue Entry</h3>
                                <p className="text-sm text-gray-500">This action cannot be undone</p>
                            </div>
                        </div>
                        <p className="text-gray-600 mb-6">
                            Are you sure you want to delete this {deleteConfirm.type === 'pdf' ? 'PDF generation job' : 'notification'}?
                        </p>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setDeleteConfirm(null)}
                                disabled={deleting}
                                className="px-4 py-2.5 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDelete}
                                disabled={deleting}
                                className="px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2 font-medium"
                            >
                                {deleting && <Loader className="w-4 h-4 animate-spin" />}
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default QueueManagement;
