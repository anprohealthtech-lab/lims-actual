import React, { useState } from 'react';
import { supabase } from '../../utils/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { Send, Phone, FileText, Check, X } from 'lucide-react';

interface SendReportModalProps {
    orderId: string;
    patientName: string;
    doctorName: string;
    doctorPhone: string;
    clinicalSummary?: string;
    includeClinicalSummary?: boolean; // Flag from orders table to control default checkbox state
    reportUrl?: string; // Optional if we just want to trigger generation+send, but usually we send existing URL
    onClose: () => void;
}

export const SendReportModal: React.FC<SendReportModalProps> = ({
    orderId,
    patientName,
    doctorName,
    doctorPhone,
    clinicalSummary,
    includeClinicalSummary: includeSummaryFlag,
    reportUrl,
    onClose
}) => {
    const { user } = useAuth();
    const [phone, setPhone] = useState(doctorPhone || '');
    // Only show summary checkbox enabled if: 1) flag is true AND 2) summary exists
    const [includeSummary, setIncludeSummary] = useState(includeSummaryFlag && !!clinicalSummary);
    const [summaryText, setSummaryText] = useState(clinicalSummary || '');
    const [isSending, setIsSending] = useState(false);
    const [sentSuccess, setSentSuccess] = useState(false);

    const handleSend = async () => {
        if (!phone) {
            alert('Please enter a phone number');
            return;
        }
        if (!reportUrl) {
            alert('Report URL is missing. Please generate the report first.');
            return;
        }

        setIsSending(true);
        try {
            // Logic from Edge Function / Netlify
            // We'll call the Netlify function directly or via a trusted Edge Function if CORS issues
            // Direct call to Netlify function (as seen in generate-pdf-auto)
            const NETLIFY_SEND_REPORT_URL = 'https://app.limsapp.in/.netlify/functions/send-report-url';

            // Smart WhatsApp Routing (matching Edge Function logic):
            // Priority 1: Current user's whatsapp_user_id
            // Priority 2: Lab's whatsapp_user_id (fallback)
            
            let whatsappUserId: string | null = null;
            let countryCode = '+91';

            // Get order's lab_id and location_id for routing
            const { data: order, error: orderError } = await supabase
                .from('orders')
                .select('lab_id, location_id')
                .eq('id', orderId)
                .single();

            if (orderError || !order) {
                throw new Error('Could not fetch order details');
            }

            // Priority 1: Current logged-in user's whatsapp_user_id
            if (user?.id) {
                const { data: currentUser } = await supabase
                    .from('users')
                    .select('whatsapp_user_id')
                    .eq('id', user.id)
                    .single();
                
                if (currentUser?.whatsapp_user_id) {
                    whatsappUserId = currentUser.whatsapp_user_id;
                    console.log('Using current user WhatsApp ID');
                }
            }

            // Priority 2: Find any user with WhatsApp at the same lab
            if (!whatsappUserId) {
                const { data: labUsers } = await supabase
                    .from('users')
                    .select('whatsapp_user_id')
                    .eq('lab_id', order.lab_id)
                    .not('whatsapp_user_id', 'is', null)
                    .limit(1);
                
                if (labUsers && labUsers.length > 0) {
                    whatsappUserId = labUsers[0].whatsapp_user_id;
                    console.log('Using lab user WhatsApp ID');
                }
            }

            // Priority 3: Lab-level fallback
            if (!whatsappUserId) {
                const { data: lab } = await supabase
                    .from('labs')
                    .select('whatsapp_user_id, country_code')
                    .eq('id', order.lab_id)
                    .single();
                
                if (lab?.whatsapp_user_id) {
                    whatsappUserId = lab.whatsapp_user_id;
                    console.log('Using lab-level WhatsApp ID');
                }
                if (lab?.country_code) {
                    countryCode = lab.country_code;
                }
            }

            if (!whatsappUserId) {
                throw new Error('Lab WhatsApp integration not configured. Please set up WhatsApp in Settings or contact support.');
            }

            // Format Phone
            let cleanPhone = phone.replace(/\D/g, '');
            if (cleanPhone.startsWith('0')) cleanPhone = cleanPhone.substring(1);

            let formattedPhone = cleanPhone;
            const countryDigits = countryCode.replace(/\D/g, '');

            if (cleanPhone.length === 10) {
                formattedPhone = countryCode + cleanPhone;
            } else if (!cleanPhone.startsWith(countryDigits)) {
                formattedPhone = countryCode + cleanPhone; // Fallback
            } else {
                formattedPhone = '+' + cleanPhone;
            }

            // Construct Message
            // Debug: Log clinical summary state
            console.log('[SendReportModal] Clinical summary state:', {
                orderId,
                includeSummaryFlag: includeSummaryFlag,
                includeSummaryCheckbox: includeSummary,
                summaryTextExists: !!summaryText,
                summaryTextLength: summaryText?.length || 0
            });

            let message = `Hello Dr. ${doctorName || 'Doctor'},\n\nThe report for patient ${patientName} is ready.`;
            if (includeSummary && summaryText) {
                message += `\n\n📋 Clinical Summary:\n${summaryText}`;
                console.log('[SendReportModal] ✅ Clinical summary ADDED to message');
            } else {
                console.log('[SendReportModal] ⚠️ Clinical summary NOT added - checkbox:', includeSummary, 'text exists:', !!summaryText);
            }
            message += `\n\nPlease find the attached report.\n\nThank you.`;

            // Payload
            const payload = {
                userId: whatsappUserId,
                fileUrl: reportUrl,
                fileName: `Report_${patientName}_${orderId.slice(-4)}.pdf`,
                caption: message,
                phoneNumber: formattedPhone,
                templateData: { PatientName: patientName }
            };

            const response = await fetch(NETLIFY_SEND_REPORT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Sending failed: ${errorText || response.statusText}`);
            }

            // Log Success
            await supabase.from('reports').update({
                doctor_informed_at: new Date().toISOString(),
                doctor_informed_via: 'whatsapp_manual'
            }).eq('order_id', orderId);

            setSentSuccess(true);
            setTimeout(() => {
                onClose();
            }, 2000);

        } catch (err: any) {
            console.error('Send Error:', err);
            alert('Failed to send: ' + err.message);
        } finally {
            setIsSending(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">

                <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-green-50">
                    <h3 className="font-bold text-green-800 flex items-center gap-2">
                        <Phone className="w-5 h-5" /> Send to Doctor
                    </h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
                </div>

                <div className="p-6 space-y-4">
                    {sentSuccess ? (
                        <div className="text-center py-8">
                            <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-3">
                                <Check className="w-8 h-8" />
                            </div>
                            <p className="text-lg font-medium text-gray-900">Sent Successfully!</p>
                        </div>
                    ) : (
                        <>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Doctor's WhatsApp Number</label>
                                <input
                                    type="text"
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500"
                                    placeholder="+91..."
                                />
                            </div>

                            {clinicalSummary && (
                                <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                                    <label className="flex items-center space-x-2 mb-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={includeSummary}
                                            onChange={(e) => setIncludeSummary(e.target.checked)}
                                            className="text-green-600 rounded focus:ring-green-500"
                                        />
                                        <span className="text-sm font-medium text-gray-700">Include AI Clinical Summary</span>
                                    </label>

                                    {includeSummary && (
                                        <textarea
                                            value={summaryText}
                                            onChange={(e) => setSummaryText(e.target.value)}
                                            className="w-full p-2 text-xs border rounded-md h-24 text-gray-600 focus:outline-none focus:border-green-400"
                                        />
                                    )}
                                </div>
                            )}

                            <div className="text-xs text-gray-500 bg-blue-50 p-2 rounded">
                                Verify the report URL exists before sending.
                            </div>
                        </>
                    )}
                </div>

                {!sentSuccess && (
                    <div className="px-6 py-4 bg-gray-50 border-t flex justify-end gap-3">
                        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded-lg">Cancel</button>
                        <button
                            onClick={handleSend}
                            disabled={isSending}
                            className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
                        >
                            {isSending ? 'Sending...' : <><Send className="w-4 h-4 mr-2" /> Send via WhatsApp</>}
                        </button>
                    </div>
                )}

            </div>
        </div>
    );
};
