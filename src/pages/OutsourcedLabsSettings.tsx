import React, { useEffect, useState } from 'react';
import { supabase, database } from '../utils/supabase';
import {
    Building2,
    Plus,
    Pencil,
    Trash2,
    Loader2,
    Save,
    X,
    Mail,
    Phone,
    User
} from 'lucide-react';

interface OutsourcedLab {
    id: string;
    name: string;
    email: string | null;
    contact_person: string | null;
    phone: string | null;
    is_active: boolean;
}

const OutsourcedLabsSettings: React.FC = () => {
    const [labs, setLabs] = useState<OutsourcedLab[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingLab, setEditingLab] = useState<OutsourcedLab | null>(null);
    const [isNew, setIsNew] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchLabs();
    }, []);

    const fetchLabs = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('outsourced_labs')
            .select('*')
            .order('name');

        if (error) {
            console.error('Error fetching labs:', error);
        } else {
            setLabs(data || []);
        }
        setLoading(false);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingLab) return;

        setSaving(true);
        try {
            const userLabId = await database.getCurrentUserLabId();
            if (!userLabId) throw new Error('Lab ID not found');

            const labData = {
                name: editingLab.name,
                email: editingLab.email,
                contact_person: editingLab.contact_person,
                phone: editingLab.phone,
                is_active: editingLab.is_active,
                lab_id: userLabId
            };

            let error;
            if (isNew) {
                const { error: insertError } = await supabase
                    .from('outsourced_labs')
                    .insert(labData);
                error = insertError;
            } else {
                const { error: updateError } = await supabase
                    .from('outsourced_labs')
                    .update(labData)
                    .eq('id', editingLab.id);
                error = updateError;
            }

            if (error) throw error;

            await fetchLabs();
            setEditingLab(null);
            setIsNew(false);
        } catch (error) {
            console.error('Error saving lab:', error);
            alert('Failed to save lab');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm('Are you sure you want to delete this lab?')) return;

        const { error } = await supabase
            .from('outsourced_labs')
            .delete()
            .eq('id', id);

        if (error) {
            console.error('Error deleting lab:', error);
            alert('Failed to delete lab');
        } else {
            fetchLabs();
        }
    };

    return (
        <div className="p-6 max-w-5xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Outsourced Labs</h1>
                    <p className="text-sm text-gray-500">Manage external laboratories for outsourcing tests</p>
                </div>
                <button
                    onClick={() => {
                        setEditingLab({
                            id: '',
                            name: '',
                            email: '',
                            contact_person: '',
                            phone: '',
                            is_active: true
                        });
                        setIsNew(true);
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                    <Plus className="h-4 w-4" />
                    Add Lab
                </button>
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                </div>
            ) : (
                <div className="grid gap-4">
                    {labs.map((lab) => (
                        <div
                            key={lab.id}
                            className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                        >
                            <div className="flex items-start gap-4">
                                <div className="p-3 bg-blue-50 rounded-lg text-blue-600">
                                    <Building2 className="h-6 w-6" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                                        {lab.name}
                                        {!lab.is_active && (
                                            <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">Inactive</span>
                                        )}
                                    </h3>
                                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-gray-500">
                                        {lab.contact_person && (
                                            <div className="flex items-center gap-1">
                                                <User className="h-3.5 w-3.5" /> {lab.contact_person}
                                            </div>
                                        )}
                                        {lab.email && (
                                            <div className="flex items-center gap-1">
                                                <Mail className="h-3.5 w-3.5" /> {lab.email}
                                            </div>
                                        )}
                                        {lab.phone && (
                                            <div className="flex items-center gap-1">
                                                <Phone className="h-3.5 w-3.5" /> {lab.phone}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 self-end sm:self-center">
                                <button
                                    onClick={() => {
                                        setEditingLab(lab);
                                        setIsNew(false);
                                    }}
                                    className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                    title="Edit"
                                >
                                    <Pencil className="h-4 w-4" />
                                </button>
                                <button
                                    onClick={() => handleDelete(lab.id)}
                                    className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                    title="Delete"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    ))}

                    {labs.length === 0 && (
                        <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed border-gray-300">
                            <Building2 className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                            <p className="text-gray-500 font-medium">No outsourced labs configured</p>
                            <p className="text-sm text-gray-400 mt-1">Add a lab to start tracking outsourced tests</p>
                        </div>
                    )}
                </div>
            )}

            {/* Edit Modal */}
            {editingLab && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
                        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
                            <h3 className="font-semibold text-lg">{isNew ? 'Add Outsourced Lab' : 'Edit Lab'}</h3>
                            <button
                                onClick={() => setEditingLab(null)}
                                className="text-gray-500 hover:text-gray-700"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <form onSubmit={handleSave} className="p-4 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Lab Name *</label>
                                <input
                                    type="text"
                                    required
                                    value={editingLab.name}
                                    onChange={e => setEditingLab({ ...editingLab, name: e.target.value })}
                                    className="w-full rounded-lg border-gray-300 focus:ring-blue-500 focus:border-blue-500"
                                    placeholder="e.g. Metropolis Healthcare"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Person</label>
                                <input
                                    type="text"
                                    value={editingLab.contact_person || ''}
                                    onChange={e => setEditingLab({ ...editingLab, contact_person: e.target.value })}
                                    className="w-full rounded-lg border-gray-300 focus:ring-blue-500 focus:border-blue-500"
                                    placeholder="e.g. Dr. Smith"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                                    <input
                                        type="email"
                                        value={editingLab.email || ''}
                                        onChange={e => setEditingLab({ ...editingLab, email: e.target.value })}
                                        className="w-full rounded-lg border-gray-300 focus:ring-blue-500 focus:border-blue-500"
                                        placeholder="lab@example.com"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                                    <input
                                        type="tel"
                                        value={editingLab.phone || ''}
                                        onChange={e => setEditingLab({ ...editingLab, phone: e.target.value })}
                                        className="w-full rounded-lg border-gray-300 focus:ring-blue-500 focus:border-blue-500"
                                        placeholder="+91..."
                                    />
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="is_active"
                                    checked={editingLab.is_active}
                                    onChange={e => setEditingLab({ ...editingLab, is_active: e.target.checked })}
                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <label htmlFor="is_active" className="text-sm text-gray-700">Active</label>
                            </div>

                            <div className="pt-4 flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setEditingLab(null)}
                                    className="px-4 py-2 text-gray-700 font-medium hover:bg-gray-100 rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                                >
                                    {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                                    Save Lab
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default OutsourcedLabsSettings;
