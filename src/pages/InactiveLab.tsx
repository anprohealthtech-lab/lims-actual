import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Phone, Mail, LogOut, RefreshCw, Clock, Crown } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const InactiveLab: React.FC = () => {
    const { labName, labStatus, labActiveUpto, trialDaysRemaining, signOut, refreshLabStatus, labStatusLoading } = useAuth();
    const navigate = useNavigate();

    const isTrialExpired = labStatus === 'inactive' || labStatus === 'suspended';

    const formatDate = (d: Date | null) => {
        if (!d) return '';
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    };

    const handleRetry = async () => {
        await refreshLabStatus();
    };

    const handleSignOut = async () => {
        await signOut();
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
            <div className="max-w-md w-full space-y-6">
                {/* Warning Card */}
                <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
                    {/* Icon */}
                    <div className={`mx-auto w-20 h-20 rounded-full flex items-center justify-center mb-6 ${
                        isTrialExpired ? 'bg-red-100' : 'bg-amber-100'
                    }`}>
                        {isTrialExpired
                            ? <AlertTriangle className="w-10 h-10 text-red-500" />
                            : <Clock className="w-10 h-10 text-amber-600" />}
                    </div>

                    {/* Title */}
                    <h1 className="text-2xl font-bold text-gray-900 mb-2">
                        {isTrialExpired ? 'Subscription Expired' : 'Lab Account Inactive'}
                    </h1>

                    {/* Lab Name */}
                    {labName && (
                        <p className="text-lg text-gray-600 mb-2">
                            <span className="font-semibold">{labName}</span>
                        </p>
                    )}

                    {/* Expiry date */}
                    {labActiveUpto && (
                        <p className="text-sm text-gray-400 mb-4">
                            {isTrialExpired ? 'Expired on' : 'Expires'} {formatDate(labActiveUpto)}
                        </p>
                    )}

                    {/* Message */}
                    <p className="text-gray-600 mb-6">
                        {isTrialExpired
                            ? 'Your subscription has ended. Subscribe to a plan to restore full access to all LIMS features.'
                            : 'Your account is currently inactive. Please contact your administrator or subscribe to a plan.'}
                    </p>

                    {/* View Plans CTA */}
                    <button
                        onClick={() => navigate('/subscription')}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl font-semibold hover:opacity-90 transition-opacity mb-4"
                    >
                        <Crown className="w-5 h-5" />
                        <span>View Subscription Plans</span>
                    </button>

                    {/* Contact Section */}
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
                        <h3 className="font-semibold text-blue-800 mb-3">Contact Support</h3>
                        <div className="space-y-2">
                            <a
                                href="tel:+919876543210"
                                className="flex items-center justify-center gap-2 text-blue-600 hover:text-blue-800 transition-colors"
                            >
                                <Phone className="w-4 h-4" />
                                <span>+91 78630 57036</span>
                            </a>
                            <a
                                href="mailto:anprohealthtech@gmail.com"
                                className="flex items-center justify-center gap-2 text-blue-600 hover:text-blue-800 transition-colors"
                            >
                                <Mail className="w-4 h-4" />
                                <span>anprohealthtech@gmail.com</span>
                            </a>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-col gap-3">
                        <button
                            onClick={handleRetry}
                            disabled={labStatusLoading}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {labStatusLoading ? (
                                <>
                                    <RefreshCw className="w-5 h-5 animate-spin" />
                                    <span>Checking...</span>
                                </>
                            ) : (
                                <>
                                    <RefreshCw className="w-5 h-5" />
                                    <span>Check Again</span>
                                </>
                            )}
                        </button>

                        <button
                            onClick={handleSignOut}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                        >
                            <LogOut className="w-5 h-5" />
                            <span>Sign Out</span>
                        </button>
                    </div>
                </div>

                {/* Footer Info */}
                <div className="text-center text-sm text-gray-500">
                    <p>
                        Visit{' '}
                        <a
                            href="https://limsapp.in"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                        >
                            limsapp.in
                        </a>
                        {' '}for more information
                    </p>
                </div>
            </div>
        </div>
    );
};

export default InactiveLab;
