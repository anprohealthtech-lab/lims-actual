import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Stethoscope, Phone, KeyRound, LogIn, AlertCircle, ArrowLeft, CheckCircle } from 'lucide-react';
import { isPatientUser, resolvePatientByPhone, patientSignIn } from '../utils/patientAuth';

type Step = 'phone' | 'pin';

const PatientLogin: React.FC = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolved from step 1 — used for step 2 sign-in
  const [resolvedEmail, setResolvedEmail] = useState('');
  const [patientName, setPatientName] = useState('');
  const [labName, setLabName] = useState('');

  // Redirect if already logged in as patient
  useEffect(() => {
    const checkExistingSession = async () => {
      const isPatient = await isPatientUser();
      if (isPatient) navigate('/patient/portal');
    };
    checkExistingSession();
  }, [navigate]);

  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await resolvePatientByPhone(phone);

      if (!result) {
        setError('No portal access found for this mobile number. Please contact your lab to activate access.');
        setLoading(false);
        return;
      }

      setResolvedEmail(result.email);
      setPatientName(result.patient_name);
      setLabName(result.lab_name);
      setStep('pin');
    } catch {
      setError('Unable to verify mobile number. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await patientSignIn(resolvedEmail, pin);
      navigate('/patient/portal');
    } catch {
      setError('Invalid PIN. Please check the PIN sent to your mobile and try again.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-white to-cyan-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-teal-600 rounded-full mb-4">
            <Stethoscope className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Patient Portal</h1>
          <p className="text-gray-600">View your lab reports anytime</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className={`flex items-center gap-1.5 text-sm font-medium ${step === 'phone' ? 'text-teal-700' : 'text-teal-500'}`}>
            {step === 'pin' ? (
              <CheckCircle className="h-4 w-4" />
            ) : (
              <span className="w-5 h-5 rounded-full bg-teal-600 text-white text-xs flex items-center justify-center">1</span>
            )}
            Mobile Number
          </div>
          <div className="h-px w-8 bg-gray-300" />
          <div className={`flex items-center gap-1.5 text-sm font-medium ${step === 'pin' ? 'text-teal-700' : 'text-gray-400'}`}>
            <span className={`w-5 h-5 rounded-full text-xs flex items-center justify-center ${step === 'pin' ? 'bg-teal-600 text-white' : 'bg-gray-200 text-gray-500'}`}>2</span>
            Enter PIN
          </div>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl p-8">

          {/* Error */}
          {error && (
            <div className="mb-5 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start">
              <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 mr-3 flex-shrink-0" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {/* Step 1: Phone */}
          {step === 'phone' && (
            <form onSubmit={handlePhoneSubmit} className="space-y-6">
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">
                  Registered Mobile Number
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Phone className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition-colors"
                    placeholder="Enter your mobile number"
                    disabled={loading}
                    autoComplete="tel"
                  />
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  Use the mobile number registered with your lab.
                </p>
              </div>

              <button
                type="submit"
                disabled={loading || !phone.trim()}
                className="w-full flex items-center justify-center px-4 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500 disabled:bg-teal-300 disabled:cursor-not-allowed transition-colors font-medium"
              >
                {loading ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2" />
                    Checking...
                  </>
                ) : (
                  <>
                    Continue
                    <ArrowLeft className="h-5 w-5 ml-2 rotate-180" />
                  </>
                )}
              </button>
            </form>
          )}

          {/* Step 2: PIN */}
          {step === 'pin' && (
            <form onSubmit={handlePinSubmit} className="space-y-6">
              {/* Patient greeting */}
              <div className="bg-teal-50 rounded-lg p-4 border border-teal-100">
                <p className="text-sm text-teal-800">
                  Welcome, <span className="font-semibold">{patientName}</span>
                </p>
                <p className="text-xs text-teal-600 mt-1">{labName}</p>
              </div>

              <div>
                <label htmlFor="pin" className="block text-sm font-medium text-gray-700 mb-2">
                  6-Digit PIN
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <KeyRound className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="pin"
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    pattern="[0-9]{6}"
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                    className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition-colors tracking-widest text-center text-lg font-mono"
                    placeholder="• • • • • •"
                    disabled={loading}
                    autoFocus
                    autoComplete="one-time-code"
                  />
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  Enter the 6-digit PIN sent to your mobile by the lab.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => { setStep('phone'); setPin(''); setError(null); }}
                  className="flex items-center px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back
                </button>
                <button
                  type="submit"
                  disabled={loading || pin.length !== 6}
                  className="flex-1 flex items-center justify-center px-4 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500 disabled:bg-teal-300 disabled:cursor-not-allowed transition-colors font-medium"
                >
                  {loading ? (
                    <>
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2" />
                      Signing in...
                    </>
                  ) : (
                    <>
                      <LogIn className="h-5 w-5 mr-2" />
                      View My Reports
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-500">
            Need help?{' '}
            <span className="text-teal-600 font-medium">Contact your lab for support.</span>
          </p>
        </div>
      </div>
    </div>
  );
};

export default PatientLogin;
