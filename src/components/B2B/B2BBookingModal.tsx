import React, { useState, useEffect } from 'react';
import { X, Search, Calendar, User, Phone, Save, Loader } from 'lucide-react';
import { database } from '../../utils/supabase';
import { supabase } from '../../utils/supabase';

interface B2BBookingModalProps {
    accountId: string;
    onClose: () => void;
    onSuccess: () => void;
}

const B2BBookingModal: React.FC<B2BBookingModalProps> = ({ accountId, onClose, onSuccess }) => {
    const [loading, setLoading] = useState(false);
    const [searchTest, setSearchTest] = useState('');
    const [testResults, setTestResults] = useState<any[]>([]);
    const [selectedTests, setSelectedTests] = useState<any[]>([]);

    // Patient Details
    const [patient, setPatient] = useState({
        name: '',
        age: '',
        gender: 'Male',
        phone: '',
        email: ''
    });

    const [scheduledDate, setScheduledDate] = useState('');

    // Search Tests
    useEffect(() => {
        const search = async () => {
            if (searchTest.length < 2) {
                setTestResults([]);
                return;
            }
            const { data } = await database.testGroups.search(searchTest);
            setTestResults(data || []);
        };
        const debounce = setTimeout(search, 300);
        return () => clearTimeout(debounce);
    }, [searchTest]);

    const handleAddTest = (test: any) => {
        if (!selectedTests.find(t => t.id === test.id)) {
            setSelectedTests([...selectedTests, test]);
        }
        setSearchTest('');
        setTestResults([]);
    };

    const handleRemoveTest = (id: string) => {
        setSelectedTests(selectedTests.filter(t => t.id !== id));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            const bookingPayload = {
                lab_id: await database.getCurrentUserLabId(), // Edge function or trigger handles this usually, but here we might need it
                // Actually, for B2B, the RLS policy I wrote assumes 'b2b_account' role.
                // Does B2B user have access to 'test_groups'? 
                // They need access to search tests. I should check policy for test_groups.

                status: 'pending',
                booking_source: 'b2b_portal',
                account_id: accountId,
                patient_info: {
                    name: patient.name,
                    age: patient.age,
                    gender: patient.gender,
                    phone: patient.phone,
                    email: patient.email
                },
                test_details: selectedTests.map(t => ({
                    id: t.id,
                    name: t.name,
                    price: t.price
                })),
                scheduled_at: scheduledDate ? new Date(scheduledDate).toISOString() : null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };

            // We need to fetch lab_id somehow. 
            // The B2B user belongs to a lab. The account has a lab_id.
            // When we fetch the account in B2BPortal, we have lab_id.
            // But here we just have accountId props.
            // We should fetch account details or pass labId.
            // For now, let's fetch account to get lab_id.

            const { data: accountData } = await supabase.from('accounts').select('lab_id').eq('id', accountId).single();
            if (!accountData) throw new Error("Account not found");

            // Override lab_id
            const finalPayload = { ...bookingPayload, lab_id: accountData.lab_id };

            const { error } = await supabase.from('bookings').insert([finalPayload]);

            if (error) throw error;

            onSuccess();
            onClose();
        } catch (error: any) {
            console.error('Error creating booking:', error);
            alert('Failed to create booking: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
                <div className="flex justify-between items-center p-6 border-b border-gray-100">
                    <h2 className="text-xl font-bold text-gray-900">Book New Test</h2>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-500">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* Patient Info */}
                    <div className="space-y-4">
                        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                            <User className="w-4 h-4" /> Patient Details
                        </h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="col-span-2 md:col-span-1">
                                <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
                                <input
                                    type="text"
                                    required
                                    value={patient.name}
                                    onChange={e => setPatient({ ...patient, name: e.target.value })}
                                    className="w-full border rounded-lg p-2.5 focus:ring-2 focus:ring-blue-100 outline-none border-gray-300"
                                    placeholder="Patient Name"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Phone</label>
                                <input
                                    type="tel"
                                    required
                                    value={patient.phone}
                                    onChange={e => setPatient({ ...patient, phone: e.target.value })}
                                    className="w-full border rounded-lg p-2.5 focus:ring-2 focus:ring-blue-100 outline-none border-gray-300"
                                    placeholder="Mobile Number"
                                />
                            </div>
                            <div className="flex gap-4">
                                <div className="flex-1">
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Age</label>
                                    <input
                                        type="number"
                                        required
                                        value={patient.age}
                                        onChange={e => setPatient({ ...patient, age: e.target.value })}
                                        className="w-full border rounded-lg p-2.5 focus:ring-2 focus:ring-blue-100 outline-none border-gray-300"
                                        placeholder="Age"
                                    />
                                </div>
                                <div className="flex-1">
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Gender</label>
                                    <select
                                        value={patient.gender}
                                        onChange={e => setPatient({ ...patient, gender: e.target.value })}
                                        className="w-full border rounded-lg p-2.5 focus:ring-2 focus:ring-blue-100 outline-none border-gray-300"
                                    >
                                        <option value="Male">Male</option>
                                        <option value="Female">Female</option>
                                        <option value="Other">Other</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Schedule */}
                    <div className="space-y-4 pt-4 border-t border-gray-100">
                        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                            <Calendar className="w-4 h-4" /> Schedule (Optional)
                        </h3>
                        <div>
                            <input
                                type="datetime-local"
                                value={scheduledDate}
                                onChange={e => setScheduledDate(e.target.value)}
                                className="w-full md:w-1/2 border rounded-lg p-2.5 focus:ring-2 focus:ring-blue-100 outline-none border-gray-300"
                            />
                        </div>
                    </div>

                    {/* Test Selection */}
                    <div className="space-y-4 pt-4 border-t border-gray-100">
                        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                            <Search className="w-4 h-4" /> Add Tests
                        </h3>
                        <div className="relative">
                            <input
                                type="text"
                                value={searchTest}
                                onChange={e => setSearchTest(e.target.value)}
                                className="w-full border rounded-lg p-2.5 pl-9 focus:ring-2 focus:ring-blue-100 outline-none border-gray-300"
                                placeholder="Search for tests..."
                            />
                            <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />

                            {testResults.length > 0 && (
                                <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 mt-1 rounded-lg shadow-lg max-h-48 overflow-y-auto z-10">
                                    {testResults.map(test => (
                                        <button
                                            key={test.id}
                                            type="button"
                                            onClick={() => handleAddTest(test)}
                                            className="w-full text-left px-4 py-2 hover:bg-gray-50 text-sm flex justify-between"
                                        >
                                            <span className="font-medium text-gray-700">{test.name}</span>
                                            <span className="text-gray-500">₹{test.price}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {selectedTests.length > 0 && (
                            <div className="space-y-2 mt-2">
                                {selectedTests.map(test => (
                                    <div key={test.id} className="flex items-center justify-between bg-gray-50 p-2 rounded-lg border border-gray-100">
                                        <span className="text-sm font-medium text-gray-700">{test.name}</span>
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveTest(test.id)}
                                            className="text-red-500 hover:text-red-700"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </form>

                <div className="p-6 border-t border-gray-100 bg-gray-50 rounded-b-xl flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={loading || selectedTests.length === 0 || !patient.name || !patient.phone}
                        className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                    >
                        {loading && <Loader className="w-4 h-4 animate-spin" />}
                        Submit Booking
                    </button>
                </div>
            </div>
        </div>
    );
};

export default B2BBookingModal;
