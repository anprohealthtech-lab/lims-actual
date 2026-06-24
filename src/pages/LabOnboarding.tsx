import React, { useState } from 'react';
import { Building2, User, Phone, Mail, Lock, CheckCircle, AlertCircle, Loader2, Globe } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { whatsappUserSync } from '../utils/whatsappUserSync';

interface FormData {
    // Lab Info
    lab_name: string;
    address: string;
    city: string;
    state: string;
    pincode: string;
    country_code: string;
    phone: string;
    email: string;
    gstin: string;
    // Admin Info
    admin_name: string;
    admin_email: string;
    admin_password: string;
    confirm_password: string;
}

const initialFormData: FormData = {
    lab_name: '',
    address: '',
    city: '',
    state: '',
    pincode: '',
    country_code: '+91',
    phone: '',
    email: '',
    gstin: '',
    admin_name: '',
    admin_email: '',
    admin_password: '',
    confirm_password: '',
};

const LabOnboarding: React.FC = () => {
    const [formData, setFormData] = useState<FormData>(initialFormData);
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<{ labId: string; adminEmail: string; tempPassword?: string } | null>(null);
    const [autoSignedIn, setAutoSignedIn] = useState(false);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
        setError(null);
    };

    const validateStep1 = () => {
        if (!formData.lab_name.trim()) {
            setError('Lab name is required');
            return false;
        }
        if (!formData.city.trim()) {
            setError('City is required');
            return false;
        }
        return true;
    };

    const validateStep2 = () => {
        if (!formData.admin_name.trim()) {
            setError('Admin name is required');
            return false;
        }
        if (!formData.admin_email.trim()) {
            setError('Admin email is required');
            return false;
        }
        // Proper email validation — must have local@domain.tld
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
        if (!emailRegex.test(formData.admin_email)) {
            setError('Please enter a valid email address (e.g., user@example.com)');
            return false;
        }
        if (formData.admin_password) {
            // Supabase GoTrue requires: 8+ chars, uppercase, lowercase, number, special char
            const pwdRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;
            if (!pwdRegex.test(formData.admin_password)) {
                setError('Password must be at least 8 characters and include uppercase, lowercase, a number, and a special character (e.g., Abcd@1234)');
                return false;
            }
            if (formData.admin_password !== formData.confirm_password) {
                setError('Passwords do not match');
                return false;
            }
        }
        return true;
    };

    const handleNext = () => {
        if (step === 1 && validateStep1()) {
            setStep(2);
        }
    };

    const handleBack = () => {
        setStep(1);
        setError(null);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!validateStep2()) return;

        setLoading(true);
        setError(null);

        try {
            const { data, error: fnError } = await supabase.functions.invoke('create-lab-with-admin', {
                body: {
                    lab_name: formData.lab_name,
                    address: formData.address || null,
                    city: formData.city || null,
                    state: formData.state || null,
                    pincode: formData.pincode || null,
                    country_code: formData.country_code,
                    phone: formData.phone || null,
                    email: formData.email || formData.admin_email,
                    gstin: formData.gstin || null,
                    admin_name: formData.admin_name,
                    admin_email: formData.admin_email,
                    admin_password: formData.admin_password || undefined,
                },
            });

            // data contains the parsed JSON body even on error responses;
            // fnError.message is generic "Edge Function returned a non-2xx status code"
            if (data?.error) {
                throw new Error(data.error);
            }

            if (fnError) throw fnError;

            const tempPassword = data.admin?.temporary_password;
            const finalPassword = formData.admin_password || tempPassword;

            setSuccess({
                labId: data.lab?.id,
                adminEmail: data.admin?.email,
                tempPassword,
            });
            setStep(3);

            // Silently sign in the new admin and sync to WhatsApp (background)
            if (finalPassword) {
                (async () => {
                    try {
                        const { error: signInError } = await supabase.auth.signInWithPassword({
                            email: data.admin.email,
                            password: finalPassword,
                        });
                        if (!signInError) {
                            setAutoSignedIn(true);
                            // Fire-and-forget WhatsApp sync
                            whatsappUserSync.syncUserToWhatsApp(data.admin.id).catch(() => {});
                        }
                    } catch {
                        // Non-critical — user can sign in manually
                    }
                })();
            }
        } catch (err: any) {
            console.error('Error creating lab:', err);
            setError(err.message || 'Failed to create lab. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
            <div className="w-full max-w-2xl">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4">
                        <Building2 className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-3xl font-bold text-gray-900">Register Your Lab</h1>
                    <p className="text-gray-600 mt-2">Get started with AnPro LIMS in just a few steps</p>
                </div>

                {/* Progress Steps */}
                <div className="flex items-center justify-center mb-8">
                    {[1, 2, 3].map((s) => (
                        <React.Fragment key={s}>
                            <div
                                className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold transition-all ${step >= s
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-200 text-gray-500'
                                    }`}
                            >
                                {step > s ? <CheckCircle className="w-5 h-5" /> : s}
                            </div>
                            {s < 3 && (
                                <div
                                    className={`w-16 h-1 mx-2 rounded ${step > s ? 'bg-blue-600' : 'bg-gray-200'
                                        }`}
                                />
                            )}
                        </React.Fragment>
                    ))}
                </div>

                {/* Form Card */}
                <div className="bg-white rounded-2xl shadow-xl p-8">
                    {/* Error Alert */}
                    {error && (
                        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                            <p className="text-red-700">{error}</p>
                        </div>
                    )}

                    {/* Step 1: Lab Information */}
                    {step === 1 && (
                        <form onSubmit={(e) => { e.preventDefault(); handleNext(); }}>
                            <h2 className="text-xl font-semibold text-gray-900 mb-6 flex items-center gap-2">
                                <Building2 className="w-5 h-5 text-blue-600" />
                                Lab Information
                            </h2>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Lab Name <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        name="lab_name"
                                        value={formData.lab_name}
                                        onChange={handleChange}
                                        placeholder="e.g., Spandan Diagnostics"
                                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Address
                                    </label>
                                    <input
                                        type="text"
                                        name="address"
                                        value={formData.address}
                                        onChange={handleChange}
                                        placeholder="Street address"
                                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            City <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="text"
                                            name="city"
                                            value={formData.city}
                                            onChange={handleChange}
                                            placeholder="City"
                                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            State
                                        </label>
                                        <input
                                            type="text"
                                            name="state"
                                            value={formData.state}
                                            onChange={handleChange}
                                            placeholder="State"
                                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            Pincode
                                        </label>
                                        <input
                                            type="text"
                                            name="pincode"
                                            value={formData.pincode}
                                            onChange={handleChange}
                                            placeholder="123456"
                                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            Country Code
                                        </label>
                                        <div className="relative">
                                            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                            <select
                                                name="country_code"
                                                value={formData.country_code}
                                                onChange={(e) => setFormData(prev => ({ ...prev, country_code: e.target.value }))}
                                                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                            >
                                                <option value="+91">🇮🇳 India (+91)</option>
                                                <option value="+92">🇵🇰 Pakistan (+92)</option>
                                                <option value="+94">🇱🇰 Sri Lanka (+94)</option>
                                                <option value="+971">🇦🇪 UAE (+971)</option>
                                                <option value="+880">🇧🇩 Bangladesh (+880)</option>
                                                <option value="+977">🇳🇵 Nepal (+977)</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Phone
                                    </label>
                                    <div className="relative">
                                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                        <input
                                            type="tel"
                                            name="phone"
                                            value={formData.phone}
                                            onChange={handleChange}
                                            placeholder="98765 43210"
                                            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        />
                                    </div>
                                    <p className="text-sm text-gray-500 mt-1">Enter number without country code</p>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            Email
                                        </label>
                                        <div className="relative">
                                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                            <input
                                                type="email"
                                                name="email"
                                                value={formData.email}
                                                onChange={handleChange}
                                                placeholder="lab@example.com"
                                                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            GSTIN
                                        </label>
                                        <input
                                            type="text"
                                            name="gstin"
                                            value={formData.gstin}
                                            onChange={handleChange}
                                            placeholder="29ABCDE1234F1Z5"
                                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="mt-8 flex justify-end">
                                <button
                                    type="submit"
                                    className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
                                >
                                    Next: Admin Account →
                                </button>
                            </div>
                        </form>
                    )}

                    {/* Step 2: Admin Account */}
                    {step === 2 && (
                        <form onSubmit={handleSubmit}>
                            <h2 className="text-xl font-semibold text-gray-900 mb-6 flex items-center gap-2">
                                <User className="w-5 h-5 text-blue-600" />
                                Admin Account
                            </h2>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Admin Name <span className="text-red-500">*</span>
                                    </label>
                                    <div className="relative">
                                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                        <input
                                            type="text"
                                            name="admin_name"
                                            value={formData.admin_name}
                                            onChange={handleChange}
                                            placeholder="Your full name"
                                            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                            required
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Admin Email <span className="text-red-500">*</span>
                                    </label>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                        <input
                                            type="email"
                                            name="admin_email"
                                            value={formData.admin_email}
                                            onChange={handleChange}
                                            placeholder="admin@example.com"
                                            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                            required
                                        />
                                    </div>
                                    <p className="text-sm text-gray-500 mt-1">This will be used to login to the system</p>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Password
                                    </label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                        <input
                                            type="password"
                                            name="admin_password"
                                            value={formData.admin_password}
                                            onChange={handleChange}
                                            placeholder="Choose a password (e.g., Abcd@1234)"
                                            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        />
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">Min 8 chars · uppercase · lowercase · number · special char (e.g., Abcd@1234) · leave empty to auto-generate</p>
                                </div>

                                {formData.admin_password && (
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            Confirm Password
                                        </label>
                                        <div className="relative">
                                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                            <input
                                                type="password"
                                                name="confirm_password"
                                                value={formData.confirm_password}
                                                onChange={handleChange}
                                                placeholder="Confirm your password"
                                                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                                <p className="text-sm text-amber-800">
                                    <strong>Note:</strong> Your lab will be created with <span className="font-semibold">inactive</span> status.
                                    Contact the administrator to activate your subscription after completing registration.
                                </p>
                            </div>

                            <div className="mt-8 flex justify-between">
                                <button
                                    type="button"
                                    onClick={handleBack}
                                    className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
                                >
                                    ← Back
                                </button>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                >
                                    {loading ? (
                                        <>
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                            Creating Lab...
                                        </>
                                    ) : (
                                        'Create Lab'
                                    )}
                                </button>
                            </div>
                        </form>
                    )}

                    {/* Step 3: Success */}
                    {step === 3 && success && (
                        <div className="text-center py-8">
                            <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-6">
                                <CheckCircle className="w-10 h-10 text-green-600" />
                            </div>

                            <h2 className="text-2xl font-bold text-gray-900 mb-2">Lab Created Successfully!</h2>
                            <p className="text-gray-600 mb-6">Your lab has been registered and is pending activation.</p>

                            <div className="bg-gray-50 rounded-lg p-6 text-left space-y-3 mb-6">
                                <div className="flex justify-between">
                                    <span className="text-gray-600">Lab ID:</span>
                                    <span className="font-mono text-sm">{success.labId}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-600">Admin Email:</span>
                                    <span className="font-semibold">{success.adminEmail}</span>
                                </div>
                                {success.tempPassword && (
                                    <div className="flex justify-between items-center pt-3 border-t border-gray-200">
                                        <span className="text-gray-600">Temporary Password:</span>
                                        <span className="font-mono bg-yellow-100 px-3 py-1 rounded text-yellow-800">
                                            {success.tempPassword}
                                        </span>
                                    </div>
                                )}
                            </div>

                            {success.tempPassword && (
                                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
                                    <p className="text-amber-800 text-sm">
                                        <strong>Important:</strong> Please save the temporary password above.
                                        You'll need it to login once your account is activated.
                                    </p>
                                </div>
                            )}

                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                                <p className="text-blue-800">
                                    <strong>7-Day Free Trial Active!</strong><br />
                                    Your lab is ready to use. Explore all features during your trial period.
                                </p>
                            </div>

                            <a
                                href={autoSignedIn ? '/' : '/login'}
                                className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
                            >
                                {autoSignedIn ? 'Go to Dashboard' : 'Go to Login'}
                            </a>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <p className="text-center text-sm text-gray-500 mt-6">
                    Already have an account? <a href="/login" className="text-blue-600 hover:underline">Sign in</a>
                </p>
            </div>
        </div>
    );
};

export default LabOnboarding;
