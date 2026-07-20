import React, { useState } from 'react';
import { Building2, Mail, Phone, MapPin, CreditCard, Calendar, ChevronDown, ChevronUp } from 'lucide-react';

interface AccountInfoCardProps {
    account: {
        name: string;
        code?: string;
        type: string;
        billing_email?: string;
        billing_phone?: string;
        address_line1?: string;
        address_line2?: string;
        city?: string;
        state?: string;
        pincode?: string;
        credit_limit: number;
        payment_terms: number;
        default_discount_percent?: number;
        created_at: string;
    };
}

const AccountInfoCard: React.FC<AccountInfoCardProps> = ({ account }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            maximumFractionDigits: 0,
        }).format(amount);
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-IN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });
    };

    const getTypeColor = (type: string) => {
        const colors: Record<string, string> = {
            hospital: 'bg-blue-100 text-blue-800',
            corporate: 'bg-purple-100 text-purple-800',
            clinic: 'bg-green-100 text-green-800',
            doctor: 'bg-orange-100 text-orange-800',
            insurer: 'bg-pink-100 text-pink-800',
            lab_to_lab: 'bg-indigo-100 text-indigo-800',
            collection_center: 'bg-teal-100 text-teal-800',
            other: 'bg-gray-100 text-gray-800',
        };
        return colors[type] || colors.other;
    };

    return (
        <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
            {/* Header - Always Visible */}
            <div
                className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3 min-w-0">
                        <div className="w-9 h-9 shrink-0 bg-blue-600 rounded-full flex items-center justify-center">
                            <Building2 className="h-4 w-4 text-white" />
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-base font-bold text-gray-900 truncate">{account.name}</h2>
                            <div className="flex items-center space-x-2 mt-0.5">
                                {account.code && (
                                    <span className="text-xs text-gray-500">Code: {account.code}</span>
                                )}
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${getTypeColor(account.type)}`}>
                                    {account.type.replace('_', ' ').toUpperCase()}
                                </span>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-gray-400">
                        <span className="hidden sm:inline">{isExpanded ? 'Hide details' : 'Client details'}</span>
                        {isExpanded ? (
                            <ChevronUp className="h-5 w-5 text-gray-500" />
                        ) : (
                            <ChevronDown className="h-5 w-5 text-gray-500" />
                        )}
                    </div>
                </div>
            </div>

            {/* Expandable Details */}
            {isExpanded && (
                <div className="px-4 pb-4 border-t border-gray-200">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                        {/* Contact Information */}
                        <div>
                            <h3 className="text-sm font-semibold text-gray-700 mb-3">Contact Information</h3>
                            <div className="space-y-3">
                                {account.billing_email && (
                                    <div className="flex items-center text-sm">
                                        <Mail className="h-4 w-4 text-gray-400 mr-2" />
                                        <span className="text-gray-900">{account.billing_email}</span>
                                    </div>
                                )}
                                {account.billing_phone && (
                                    <div className="flex items-center text-sm">
                                        <Phone className="h-4 w-4 text-gray-400 mr-2" />
                                        <span className="text-gray-900">{account.billing_phone}</span>
                                    </div>
                                )}
                                {(account.address_line1 || account.city) && (
                                    <div className="flex items-start text-sm">
                                        <MapPin className="h-4 w-4 text-gray-400 mr-2 mt-0.5" />
                                        <div className="text-gray-900">
                                            {account.address_line1 && <div>{account.address_line1}</div>}
                                            {account.address_line2 && <div>{account.address_line2}</div>}
                                            {(account.city || account.state || account.pincode) && (
                                                <div>
                                                    {account.city && `${account.city}, `}
                                                    {account.state && `${account.state} `}
                                                    {account.pincode}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Account Details */}
                        <div>
                            <h3 className="text-sm font-semibold text-gray-700 mb-3">Account Details</h3>
                            <div className="space-y-3">
                                <div className="flex items-center justify-between text-sm">
                                    <div className="flex items-center text-gray-600">
                                        <CreditCard className="h-4 w-4 mr-2" />
                                        Credit Limit
                                    </div>
                                    <span className="font-semibold text-gray-900">{formatCurrency(account.credit_limit || 0)}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-gray-600">Payment Terms</span>
                                    <span className="font-semibold text-gray-900">{account.payment_terms || 0} days</span>
                                </div>
                                {account.default_discount_percent !== undefined && account.default_discount_percent > 0 && (
                                    <div className="flex items-center justify-between text-sm">
                                        <span className="text-gray-600">Default Discount</span>
                                        <span className="font-semibold text-green-600">{account.default_discount_percent}%</span>
                                    </div>
                                )}
                                <div className="flex items-center justify-between text-sm">
                                    <div className="flex items-center text-gray-600">
                                        <Calendar className="h-4 w-4 mr-2" />
                                        Member Since
                                    </div>
                                    <span className="font-medium text-gray-900">{formatDate(account.created_at)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AccountInfoCard;
