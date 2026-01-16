import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import {
  X,
  Search,
  Upload,
  CreditCard,
  User,
  Building,
  Briefcase,
  Plus,
  Calendar,
  TestTube,
  Sparkles,
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  Loader,
  Clock as ClockIcon,
  DollarSign
} from 'lucide-react';
import { database, supabase } from '../../utils/supabase';
import { SampleTypeIndicator } from '../Common/SampleTypeIndicator';
import { getLabCurrency } from '../../utils/currency';
import {
  processTRFImage,
  trfToOrderFormData,
  formatConfidence,
  validatePatientData,
  autoCreatePatientFromTRF,
  findDoctorByName,
  type TRFExtractionResult,
  type TRFProcessingProgress
} from '../../utils/trfProcessor';

type PaymentType = 'self' | 'credit' | 'insurance' | 'corporate';

interface Doctor {
  id: string;
  name: string;
  specialization?: string | null;
  default_discount_percent?: number | null;
}

interface Location {
  id: string;
  name: string;
  type: string; // 'hospital' | 'clinic' | 'diagnostic_center' | 'home_collection' | 'walk_in'
  credit_limit?: number | null;
  default_discount_percent?: number | null;
}

interface Account {
  id: string;
  name: string;
  type: 'hospital' | 'corporate' | 'insurer' | 'clinic' | 'doctor' | 'other';
  default_discount_percent?: number | null;
  credit_limit?: number | null;
  payment_terms?: number | null;
  is_active?: boolean | null;
  billing_mode?: 'standard' | 'monthly' | null;
}

interface Patient {
  id: string;
  name: string;
  age?: number | null;
  gender?: string | null;
  phone?: string | null;
  email?: string | null;
  default_doctor_id?: string | null;
  default_location_id?: string | null;
  default_payment_type?: PaymentType | null;
  age_unit?: string | null;
  dob?: string | null;
  date_of_birth?: string | null;
}

interface TestGroup {
  id: string;
  name: string;
  code?: string;
  price: number;
  category?: string | null;
  clinicalPurpose?: string | null;
  sampleType?: string | null;
  turnaroundTime?: string | null;
  requiresFasting?: boolean | null;
  type?: 'test' | 'package';
  is_outsourced?: boolean;
  default_outsourced_lab_id?: string;
  description?: string | null;
  testGroupIds?: string[];
  sample_color?: string | null;
  sample_type?: string | null;
  required_patient_inputs?: string[];
  ref_range_ai_config?: any;
}



interface AccountPrice {
  test_group_id: string;
  price: number;
}

interface OrderFormProps {
  onClose: () => void;
  onSubmit: (orderData: any) => void;
  preSelectedPatientId?: string;
  initialBookingData?: any;
}

const OrderForm: React.FC<OrderFormProps> = ({ onClose, onSubmit, preSelectedPatientId, initialBookingData }) => {
  // Masters
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [testGroups, setTestGroups] = useState<TestGroup[]>([]); // Combined test groups AND packages
  const [outsourcedLabs, setOutsourcedLabs] = useState<any[]>([]);

  // Loading flags
  const [loadingPatients, setLoadingPatients] = useState<boolean>(false);
  const [loadingDoctors, setLoadingDoctors] = useState<boolean>(false);
  const [loadingLocations, setLoadingLocations] = useState<boolean>(false);
  const [loadingAccounts, setLoadingAccounts] = useState<boolean>(false);
  const [loadingTests, setLoadingTests] = useState<boolean>(false);

  // Selecteds / data
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [selectedDoctor, setSelectedDoctor] = useState<string>('');
  const [selectedLocation, setSelectedLocation] = useState<string>('');
  const [selectedAccount, setSelectedAccount] = useState<string>(''); // bill-to account
  const [paymentType, setPaymentType] = useState<PaymentType>('self');
  const [priority, setPriority] = useState<'Normal' | 'Urgent' | 'STAT'>('Normal');
  const [expectedDate, setExpectedDate] = useState<string>(() =>
    new Date().toISOString().split('T')[0]
  );
  const [notes, setNotes] = useState<string>('');

  // Test selection
  const [selectedTests, setSelectedTests] = useState<string[]>([]);
  const [testSearch, setTestSearch] = useState<string>('');
  const [showTestList, setShowTestList] = useState<boolean>(false);

  // Outsourcing config per test: { testId: outsourcedLabId | 'inhouse' | null }
  const [testOutsourcingConfig, setTestOutsourcingConfig] = useState<Record<string, string>>({});

  // Account specific prices: { testGroupId: price }
  const [accountPrices, setAccountPrices] = useState<Record<string, number>>({});

  // AI Reference Range Inputs
  const [additionalInputs, setAdditionalInputs] = useState<Record<string, string>>({});

  // Compute required patient inputs from selected tests
  const requiredInfos = React.useMemo(() => {
    const required = new Set<string>();
    testGroups
      .filter(tg => selectedTests.includes(tg.id))
      .forEach(tg => tg.required_patient_inputs?.forEach(input => required.add(input)));

    // Filter out inputs that don't apply (e.g., pregnancy for Male)
    if (selectedPatient?.gender === 'Male') {
      required.delete('pregnancy_status');
      required.delete('lmp');
    }

    return Array.from(required);
  }, [selectedTests, testGroups, selectedPatient]);

  // Loading and error states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [submissionProgress, setSubmissionProgress] = useState<string>('');

  // Searches / dropdown visibility
  const [patientSearch, setPatientSearch] = useState<string>('');
  const [doctorSearch, setDoctorSearch] = useState<string>('');
  const [locationSearch, setLocationSearch] = useState<string>('');
  const [accountSearch, setAccountSearch] = useState<string>('');

  // Admin features
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [customOrderDate, setCustomOrderDate] = useState<string>('');
  const [showPatientDropdown, setShowPatientDropdown] = useState<boolean>(false);
  const [showDoctorDropdown, setShowDoctorDropdown] = useState<boolean>(false);
  const [showLocationDropdown, setShowLocationDropdown] = useState<boolean>(false);
  const [showAccountDropdown, setShowAccountDropdown] = useState<boolean>(false);

  // Test request form
  const [testRequestFile, setTestRequestFile] = useState<File | null>(null);

  // TRF AI Processing
  const [processingTRF, setProcessingTRF] = useState<boolean>(false);
  const [trfProgress, setTrfProgress] = useState<TRFProcessingProgress | null>(null);
  const [trfExtraction, setTrfExtraction] = useState<TRFExtractionResult | null>(null);
  const [showTRFReview, setShowTRFReview] = useState<boolean>(false);
  const [trfUnmatchedTests, setTrfUnmatchedTests] = useState<string[]>([]);
  const [enableTRFOptimization, setEnableTRFOptimization] = useState<boolean>(true); // Image optimization


  // Currency
  const [currencySymbol, setCurrencySymbol] = useState<string>('₹');

  // Discount & Payment
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed'>('percentage');
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'upi' | 'online'>('cash');
  const [amountPaid, setAmountPaid] = useState<number>(0);


  // Handle TRF modal close and apply edited values
  const handleTRFReviewClose = async () => {
    setShowTRFReview(false);

    console.log('🚀🚀🚀 NEW CODE LOADED - handleTRFReviewClose called 🚀🚀🚀');

    // If we have trfExtraction data, apply it (edited or original)
    if (trfExtraction && trfExtraction.success) {
      console.log('Applying TRF extraction data (including any edits)...');

      // Check if we have a matched patient from the TRF extraction
      if (trfExtraction.matchedPatient && trfExtraction.matchedPatient.matchConfidence >= 0.7) {
        // Use matched patient if confidence is >= 70%
        console.log(`Using matched patient (${Math.round(trfExtraction.matchedPatient.matchConfidence * 100)}% confidence):`, trfExtraction.matchedPatient.name);

        const matched = patients.find(p => p.id === trfExtraction.matchedPatient!.id);
        if (matched) {
          setSelectedPatient(matched);
          setPatientSearch(matched.name);
          onPickPatient(matched);
          console.log('✓ Matched patient selected:', matched.name);
        } else {
          console.warn('Matched patient not found in patients list, will need to refresh');
          // Refresh patients and try again
          const updatedPatients = await database.patients.getAll();
          if (updatedPatients && Array.isArray(updatedPatients)) {
            setPatients(updatedPatients);
            const matched = updatedPatients.find((p: any) => p.id === trfExtraction.matchedPatient!.id);
            if (matched) {
              setSelectedPatient(matched);
              setPatientSearch(matched.name);
              onPickPatient(matched);
              console.log('✓ Matched patient selected after refresh:', matched.name);
            }
          }
        }
      } else if (trfExtraction.patientInfo) {
        // No matched patient or low confidence - create new patient with edited values
        const validation = validatePatientData(trfExtraction.patientInfo);

        if (validation.isValid) {
          console.log('Creating NEW patient with edited values from TRF (no match or low confidence)...');

          // Get current user's lab_id
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const { data: userRecord } = await supabase
              .from('users')
              .select('lab_id')
              .eq('id', user.id)
              .single();

            if (userRecord?.lab_id) {
              // Create new patient with edited data
              const newPatient = await autoCreatePatientFromTRF(
                trfExtraction.patientInfo,
                userRecord.lab_id
              );

              if (newPatient) {
                console.log('✓ Patient created in database:', newPatient);

                // Refresh patients list
                const updatedPatients = await database.patients.getAll();
                if (updatedPatients && Array.isArray(updatedPatients)) {
                  setPatients(updatedPatients);

                  // Try to find in refreshed list
                  const created = updatedPatients.find((p: any) => p.id === newPatient.id);
                  if (created) {
                    setSelectedPatient(created);
                    setPatientSearch(created.name);
                    onPickPatient(created);
                    console.log('✓ Patient selected from refreshed list:', created.name);
                  } else {
                    // Fallback: use the newly created patient directly
                    console.warn('Patient not found in refreshed list, using direct reference');
                    setSelectedPatient(newPatient as any);
                    setPatientSearch(newPatient.name);
                    onPickPatient(newPatient as any);
                    console.log('✓ Patient selected directly:', newPatient.name);
                  }
                } else {
                  console.error('Failed to refresh patient list');
                  // Still use the newly created patient
                  setSelectedPatient(newPatient as any);
                  setPatientSearch(newPatient.name);
                  onPickPatient(newPatient as any);
                  console.log('✓ Patient selected (list refresh failed):', newPatient.name);
                }
              } else {
                console.error('autoCreatePatientFromTRF returned null - check console for errors');
              }
            } else {
              console.error('User lab_id not found');
            }
          }
        } else {
          console.log('Patient data incomplete after editing, missing:', validation.missing);
          // Still show the data in search field
          if (trfExtraction.patientInfo.name) {
            setPatientSearch(trfExtraction.patientInfo.name);
          }
        }
      }

      // Use matched doctor from TRF extraction (already matched in edge function)
      if (trfExtraction.matchedDoctor && trfExtraction.matchedDoctor.matchConfidence >= 0.7) {
        // Use matched doctor if confidence is >= 70%
        console.log(`✓ Using matched doctor (${Math.round(trfExtraction.matchedDoctor.matchConfidence * 100)}% confidence):`, trfExtraction.matchedDoctor.name);
        setSelectedDoctor(trfExtraction.matchedDoctor.id);
      } else if (trfExtraction.doctorInfo?.name) {
        // Fallback: No match or low confidence, try searching manually
        console.log('⚠ No confident doctor match from TRF, trying manual search for:', trfExtraction.doctorInfo.name);
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: userRecord } = await supabase
            .from('users')
            .select('lab_id')
            .eq('id', user.id)
            .single();

          if (userRecord?.lab_id) {
            const matchedDoctor = await findDoctorByName(
              trfExtraction.doctorInfo.name,
              userRecord.lab_id
            );

            if (matchedDoctor) {
              setSelectedDoctor(matchedDoctor.id);
              console.log('✓ Matched doctor with manual search:', matchedDoctor.name);
            } else {
              console.log('⚠ No matching doctor found for:', trfExtraction.doctorInfo.name);
            }
          }
        }
      }

      // Apply edited test selections (only selected tests)
      if (trfExtraction.requestedTests) {
        const selectedTestIds = trfExtraction.requestedTests
          .filter(test => test.isSelected && test.testGroupId)
          .map(test => test.testGroupId!);

        if (selectedTestIds.length > 0) {
          console.log(`✓ Applying ${selectedTestIds.length} test selections from TRF`);
          console.log(`  Test Group IDs from TRF:`, selectedTestIds);
          console.log(`  Available test groups in state:`, testGroups.length);
          console.log(`  First TRF test ID:`, selectedTestIds[0]);
          console.log(`  First testGroup in state:`, testGroups[0]);
          console.log(`  Sample of testGroup IDs in state:`, testGroups.slice(0, 10).map(tg => tg.id));

          // Check how many match
          const matchedGroups = testGroups.filter(tg => selectedTestIds.includes(tg.id));
          console.log(`  ✓ Matched ${matchedGroups.length}/${selectedTestIds.length} tests`);
          if (matchedGroups.length > 0) {
            console.log(`  Matched tests:`, matchedGroups.map(tg => ({ name: tg.name, price: tg.price })));
          } else {
            console.log(`  ❌ NO MATCHES! Checking if IDs exist anywhere...`);
            const firstTrfId = selectedTestIds[0];
            const foundInState = testGroups.find(tg => tg.id === firstTrfId);
            console.log(`  Looking for "${firstTrfId}" in testGroups:`, foundInState ? 'FOUND' : 'NOT FOUND');
          }
          setSelectedTests(selectedTestIds);
        }

        // Track unmatched tests
        const unmatchedTests = trfExtraction.requestedTests.filter(test => !test.matched);
        if (unmatchedTests.length > 0) {
          setTrfUnmatchedTests(unmatchedTests.map(t => t.testName));
          console.log(`⚠ ${unmatchedTests.length} tests still need manual selection`);
        }
      }

      // Apply edited clinical notes
      if (trfExtraction.clinicalNotes) {
        setNotes(trfExtraction.clinicalNotes);
      }

      // Apply edited urgency
      if (trfExtraction.urgency) {
        setPriority(trfExtraction.urgency);
      }
    }
  };

  // Credit validation (either Location or Account, whichever is chosen)
  const [creditInfo, setCreditInfo] = useState<{
    kind: 'location' | 'account';
    allowed: boolean;
    currentBalance: number;
    creditLimit: number;
    availableCredit: number;
    name: string;
  } | null>(null);

  // New patient modal
  const [showNewPatientModal, setShowNewPatientModal] = useState<boolean>(false);
  const [creatingPatient, setCreatingPatient] = useState<boolean>(false);
  const [newPatient, setNewPatient] = useState<{
    name: string;
    age: string;
    gender: string;
    phone: string;
    email: string;
  }>({ name: '', age: '', gender: 'Male', phone: '', email: '' });

  // Pre-fill from Booking Data
  useEffect(() => {
    if (initialBookingData) {
      console.log('Pre-filling Order Form from Booking:', initialBookingData);

      // 1. Patient Info (Loose text -> manual entry mode primarily)
      if (initialBookingData.patient_info) {
        // We set newPatientName/etc directly as if user typed them
        setNewPatientName(initialBookingData.patient_info.name || '');
        setNewPatientPhone(initialBookingData.patient_info.phone || '');
        setNewPatientGender(initialBookingData.patient_info.gender || 'Male');
        setNewPatientAge(initialBookingData.patient_info.age?.toString() || '');

        // Also set search so it looks like a manual entry
        setPatientSearch(initialBookingData.patient_info.name || '');
      }

      // 2. Tests
      if (initialBookingData.test_details && Array.isArray(initialBookingData.test_details)) {
        const testIds = initialBookingData.test_details.filter((t: any) => t.id).map((t: any) => t.id);
        setSelectedTests(testIds);
      }

      // 3. Collection Type
      if (initialBookingData.collection_type === 'home_collection' && initialBookingData.home_collection_address) {
        // You might set a note or handle home collection specific logic here if fields exist
        setNotes(`Home Collection Address: ${initialBookingData.home_collection_address.address}, ${initialBookingData.home_collection_address.city}`);
      }
    }
  }, [initialBookingData]);

  // Initial loads
  useEffect(() => {
    const fetchMasters = async () => {
      try {
        setLoadingDoctors(true);
        setLoadingLocations(true);
        setLoadingAccounts(true);
        setLoadingPatients(true);
        setLoadingTests(true);

        const [
          doctorsRes,
          locationsRes,
          accountsRes,
          patientsRes,
          testsRes,
          packagesRes,
          outsourcedLabsRes
        ] = await Promise.all([
          (database as any).doctors?.getAll?.() ?? Promise.resolve({ data: [] }),
          (database as any).locations?.getAll?.() ?? Promise.resolve({ data: [] }),
          (database as any).accounts?.getAll?.() ?? Promise.resolve({ data: [] }),
          (database as any).patients?.getAll?.() ?? Promise.resolve({ data: [] }),
          (database as any).testGroups?.getAll?.() ?? Promise.resolve({ data: [] }),
          (database as any).packages?.getAll?.() ?? Promise.resolve({ data: [] }),
          supabase.from('outsourced_labs').select('*').eq('is_active', true).order('name')
        ]);

        setDoctors(doctorsRes?.data ?? []);
        setLocations(locationsRes?.data ?? []);
        setAccounts(accountsRes?.data ?? []);
        setPatients(patientsRes?.data ?? []);

        // Combine test groups and packages into a single list
        const testGroupsList = (testsRes?.data ?? []).map((tg: any) => ({
          ...tg,
          type: 'test' as const
        }));

        const packagesList = (packagesRes?.data ?? []).map((pkg: any) => ({
          id: pkg.id,
          name: pkg.name,
          price: pkg.price,
          category: pkg.category || 'Package',
          description: pkg.description,
          type: 'package' as const,
          testGroupIds: pkg.package_test_groups?.map((ptg: any) => ptg.test_group_id) || [],
          clinicalPurpose: pkg.description,
          sampleType: 'Various',
          turnaroundTime: null,
          requiresFasting: false,
          is_outsourced: false,
          default_outsourced_lab_id: undefined
        }));

        // Set combined list - packages first, then test groups
        setTestGroups([...packagesList, ...testGroupsList]);
        setOutsourcedLabs(outsourcedLabsRes?.data ?? []);

        // Auto-select user's primary location if no patient is pre-selected
        if (!preSelectedPatientId) {
          const primaryLocation = await database.getCurrentUserPrimaryLocation();
          if (primaryLocation) {
            setSelectedLocation(primaryLocation);
          }
        }
      } catch (err) {
        console.error('Error loading masters:', err);
      } finally {
        setLoadingDoctors(false);
        setLoadingLocations(false);
        setLoadingAccounts(false);
        setLoadingPatients(false);
        setLoadingTests(false);
      }
    };

    fetchMasters();
  }, []);

  // Pre-select patient (if provided)
  useEffect(() => {
    const loadPatient = async (patientId: string) => {
      try {
        const { data, error } = await (database as any).patients?.getById?.(patientId);
        if (error) throw error;
        if (data) {
          setSelectedPatient(data as Patient);
          if (data.default_doctor_id) setSelectedDoctor(data.default_doctor_id);
          if (data.default_location_id) setSelectedLocation(data.default_location_id);
          if (data.default_payment_type) setPaymentType(data.default_payment_type);
        }
      } catch (err) {
        console.error('Error loading patient:', err);
      }
    };

    if (preSelectedPatientId) loadPatient(preSelectedPatientId);
  }, [preSelectedPatientId]);

  // Re-check credit when bill-to changes under non-self payment types
  useEffect(() => {
    const check = async () => {
      if (paymentType === 'self') {
        setCreditInfo(null);
        return;
      }
      if (selectedAccount && (database as any).accounts?.checkCreditLimit) {
        try {
          const res = await (database as any).accounts.checkCreditLimit(selectedAccount, 0);
          if (res) {
            setCreditInfo({
              kind: 'account',
              allowed: !!res.allowed,
              currentBalance: Number(res.currentBalance ?? 0),
              creditLimit: Number(res.creditLimit ?? 0),
              availableCredit: Number(res.availableCredit ?? 0),
              name:
                res.name ||
                (accounts.find((a) => a.id === selectedAccount)?.name ?? 'Account')
            });
            return;
          }
        } catch (e) {
          console.error('Error checking account credit limit:', e);
        }
      }
      if (selectedLocation && (database as any).locations?.checkCreditLimit) {
        try {
          const res = await (database as any).locations.checkCreditLimit(selectedLocation, 0);
          if (res) {
            setCreditInfo({
              kind: 'location',
              allowed: !!res.allowed,
              currentBalance: Number(res.currentBalance ?? 0),
              creditLimit: Number(res.creditLimit ?? 0),
              availableCredit: Number(res.availableCredit ?? 0),
              name:
                res.name ||
                (locations.find((l) => l.id === selectedLocation)?.name ?? 'Location')
            });
            return;
          }
        } catch (e) {
          console.error('Error checking location credit limit:', e);
        }
      }
      setCreditInfo(null);
    };

    check();
  }, [selectedAccount, selectedLocation, paymentType, accounts, locations]);

  // Fetch account prices when bill-to account changes
  useEffect(() => {
    const fetchAccountPrices = async () => {
      if (!selectedAccount) {
        setAccountPrices({});
        return;
      }

      try {
        const { data, error } = await supabase
          .from('account_prices')
          .select('test_group_id, price')
          .eq('account_id', selectedAccount);

        if (error) throw error;

        const priceMap: Record<string, number> = {};
        if (data) {
          data.forEach((item: any) => {
            priceMap[item.test_group_id] = item.price;
          });
        }
        setAccountPrices(priceMap);
      } catch (err) {
        console.error('Error fetching account prices:', err);
      }
    };

    fetchAccountPrices();
  }, [selectedAccount]);

  // Check for Admin Role
  useEffect(() => {
    const checkRole = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        console.log('OrderForm: Current User Check', user?.email, user?.user_metadata);

        let role = user?.user_metadata?.role;

        // Fallback: Check public users table if metadata missing
        if (!role && user?.email) {
          const { data: dbUser } = await supabase
            .from('users')
            .select('role')
            .eq('email', user.email)
            .eq('status', 'Active')
            .single();

          console.log('OrderForm: DB User Role Check', dbUser);
          if (dbUser?.role) role = dbUser.role;
        }

        console.log('OrderForm: Resolved Role', role);

        // Allow Admin, Lab Manager, Super Admin, Owner
        if (role) {
          const lowerRole = String(role).toLowerCase();
          const authorizedRoles = ['admin', 'administrator', 'super admin', 'lab_manager', 'owner', 'manager'];

          if (authorizedRoles.some(r => lowerRole.includes(r))) {
            console.log('OrderForm: Access GRANTED for role:', role);
            setIsAdmin(true);
          } else {
            console.log('OrderForm: Access DENIED for role:', role);
          }
        }
      } catch (err) {
        console.error('OrderForm: Role check failed', err);
      }
    };
    checkRole();
  }, []);

  // Debug: Monitor isAdmin state
  useEffect(() => {
    console.log('OrderForm: isAdmin state changed to:', isAdmin);
  }, [isAdmin]);

  // Filtering helpers
  const filteredPatients = patients.filter((p) => {
    const q = patientSearch.toLowerCase().trim();
    return (
      !q ||
      p.name?.toLowerCase().includes(q) ||
      (p.phone ?? '').includes(q) ||
      p.id?.includes(q)
    );
  });

  const filteredDoctors = doctors.filter((d) => {
    const q = doctorSearch.toLowerCase().trim();
    return !q || (d.name + ' ' + (d.specialization ?? '')).toLowerCase().includes(q);
  });

  const filteredLocations = locations.filter((l) => {
    const q = locationSearch.toLowerCase().trim();
    return !q || (l.name + ' ' + l.type).toLowerCase().includes(q);
  });

  const filteredAccounts = accounts.filter((a) => {
    const q = accountSearch.toLowerCase().trim();
    return !q || (a.name + ' ' + a.type).toLowerCase().includes(q);
  });

  // Handlers
  const onPickPatient = (p: Patient) => {
    setSelectedPatient(p);
    setShowPatientDropdown(false);
    // Prefill defaults
    if (p.default_doctor_id) setSelectedDoctor(p.default_doctor_id);
    if (p.default_location_id) setSelectedLocation(p.default_location_id);
    if (p.default_payment_type) setPaymentType(p.default_payment_type);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      alert('File size must be less than 10MB');
      return;
    }

    setTestRequestFile(file);

    // Auto-process TRF with AI
    if (file.type.startsWith('image/') || file.type === 'application/pdf') {
      setProcessingTRF(true);
      setTrfExtraction(null);
      setTrfProgress(null);

      try {
        const result = await processTRFImage(file, (progress) => {
          setTrfProgress(progress);
        }, {
          enableOptimization: enableTRFOptimization
        });

        if (result.success) {
          setTrfExtraction(result);
          setShowTRFReview(true);

          // Auto-populate form if confidence is high
          const formData = trfToOrderFormData(result);

          // Patient handling: auto-match or auto-create
          if (formData.matchedPatientId && formData.matchConfidence >= 0.7) {
            // High confidence match (≥70%) - auto-select existing patient
            const matched = patients.find(p => p.id === formData.matchedPatientId);
            if (matched) {
              setSelectedPatient(matched);
              setPatientSearch(matched.name);
              onPickPatient(matched);
              console.log('✓ Auto-selected matched patient (confidence:', formData.matchConfidence, '):', matched.name);
            }
          } else if (result.patientInfo && formData.patientData) {
            // Low confidence match (<70%) or no match - create new patient
            console.log('Creating new patient (no match or confidence <70%):', {
              hasMatch: !!formData.matchedPatientId,
              confidence: formData.matchConfidence,
              trfName: result.patientInfo?.name
            });

            const validation = validatePatientData(result.patientInfo);

            if (validation.isValid) {
              console.log('Auto-creating new patient from TRF...');

              // Get current user's lab_id
              const { data: { user } } = await supabase.auth.getUser();
              if (user) {
                const { data: userRecord } = await supabase
                  .from('users')
                  .select('lab_id')
                  .eq('id', user.id)
                  .single();

                if (userRecord?.lab_id) {
                  const newPatient = await autoCreatePatientFromTRF(
                    result.patientInfo,
                    userRecord.lab_id
                  );

                  if (newPatient) {
                    // Refresh patients list
                    const updatedPatients = await database.patients.getAll();
                    if (updatedPatients && Array.isArray(updatedPatients)) {
                      setPatients(updatedPatients);

                      // Select the new patient
                      const created = updatedPatients.find((p: any) => p.id === newPatient.id);
                      if (created) {
                        setSelectedPatient(created);
                        setPatientSearch(created.name);
                        onPickPatient(created);
                        console.log('✓ Auto-created new patient:', created.name);
                      }
                    }
                  } else {
                    console.warn('Failed to auto-create patient, user will need to select manually');
                  }
                }
              }
            } else {
              console.log('Patient data incomplete, user will need to create manually');
              console.log('Missing:', validation.missing);
              // Show patient data in form for manual completion
              setPatientSearch(formData.patientData.name);
            }
          }

          // Doctor handling: find existing doctor (don't create new)
          if (result.doctorInfo?.name) {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
              const { data: userRecord } = await supabase
                .from('users')
                .select('lab_id')
                .eq('id', user.id)
                .single();

              if (userRecord?.lab_id) {
                const matchedDoctor = await findDoctorByName(
                  result.doctorInfo.name,
                  userRecord.lab_id
                );

                if (matchedDoctor) {
                  setSelectedDoctor(matchedDoctor.id);
                  console.log('✓ Matched existing doctor:', matchedDoctor.name);
                } else {
                  console.log('⚠ No matching doctor found for:', result.doctorInfo.name);
                  console.log('User will need to select doctor manually');
                }
              }
            }
          }

          // Auto-select matched tests (only tests with isSelected: true from AI)
          if (formData.selectedTestIds.length > 0) {
            setSelectedTests(formData.selectedTestIds);
            console.log(`✓ Auto-selected ${formData.selectedTestIds.length} tests from TRF checkboxes`);
          }

          // Set unmatched tests for manual review
          if (formData.unmatchedTests.length > 0) {
            setTrfUnmatchedTests(formData.unmatchedTests);
            console.log(`⚠ ${formData.unmatchedTests.length} tests need manual selection`);
          }

          // Set clinical notes
          if (formData.clinicalNotes) {
            setNotes(formData.clinicalNotes);
          }

          // Set priority/urgency
          if (formData.urgency) {
            setPriority(formData.urgency);
          }

        } else {
          alert(`Failed to process TRF: ${result.error}`);
        }
      } catch (error: any) {
        console.error('TRF processing error:', error);
        alert(`Error processing TRF: ${error.message}`);
      } finally {
        setProcessingTRF(false);
      }
    }
  };

  const handleToggleTest = (id: string) => {
    setSelectedTests((prev) => {
      const test = testGroups.find(t => t.id === id);
      const isSelecting = !prev.includes(id);

      let newTests = isSelecting ? [...prev, id] : prev.filter((x) => x !== id);

      // Package selection logic
      if (test?.type === 'package' && isSelecting) {
        // When selecting a package, remove any individual tests that are part of this package
        // to avoid double-charging
        const packageTestGroupIds = test.testGroupIds || [];
        newTests = newTests.filter(testId => {
          if (testId === id) return true; // Keep the package itself
          const t = testGroups.find(tg => tg.id === testId);
          return t?.type === 'package' || !packageTestGroupIds.includes(testId);
        });
      } else if (test?.type !== 'package' && isSelecting) {
        // When selecting an individual test, check if it's already in a selected package
        const selectedPackages = testGroups.filter(
          tg => tg.type === 'package' && prev.includes(tg.id)
        );
        const isInSelectedPackage = selectedPackages.some(
          pkg => pkg.testGroupIds?.includes(id)
        );
        if (isInSelectedPackage) {
          // Don't add this test - it's already included in a package
          return prev; // No change
        }
      }

      // When adding a test, check if it has default outsourced lab
      if (isSelecting && test) {
        if (test.is_outsourced && test.default_outsourced_lab_id) {
          setTestOutsourcingConfig(config => ({
            ...config,
            [id]: test.default_outsourced_lab_id!
          }));
        } else {
          // Default to in-house
          setTestOutsourcingConfig(config => ({
            ...config,
            [id]: 'inhouse'
          }));
        }
      } else if (!isSelecting) {
        // Remove outsourcing config when test is deselected
        setTestOutsourcingConfig(config => {
          const newConfig = { ...config };
          delete newConfig[id];
          return newConfig;
        });
      }

      return newTests;
    });

    // UX Improvement: Clear search & Refocus
    if (testSearch) {
      setTestSearch('');
    }
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Clear previous errors
    setValidationErrors([]);
    const errors: string[] = [];

    // Comprehensive validation
    if (!selectedPatient?.id) {
      errors.push('❌ Patient: Please select a patient');
    }

    if (!selectedDoctor) {
      errors.push('❌ Referring Doctor: Please select or enter a referring doctor');
    }

    if (selectedTests.length === 0) {
      errors.push('❌ Tests: Please select at least one test');
    }

    if (
      (paymentType === 'credit' || paymentType === 'corporate' || paymentType === 'insurance') &&
      !selectedAccount &&
      !selectedLocation
    ) {
      errors.push('❌ Payment: For non-self payments, choose a Bill-to Account or Location');
    }

    if (creditInfo && !creditInfo.allowed) {
      errors.push(
        `❌ Credit Limit: ${creditInfo.kind === 'account' ? 'Account' : 'Location'} credit limit exceeded. Available: ₹${creditInfo.availableCredit}`
      );
    }

    if (!selectedPatient) {
      errors.push('❌ Patient is required');
    }

    // Validate Required Inputs
    requiredInfos.forEach(info => {
      if (!additionalInputs[info]) {
        errors.push(`❌ Missing required information: ${info.replace(/_/g, ' ')}`);
      }
    });

    // If validation fails, show errors and stop
    if (errors.length > 0) {
      setValidationErrors(errors);
      // Scroll to top to show errors
      document.querySelector('.overflow-y-auto')?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    // Start submission with loading state
    setIsSubmitting(true);
    setSubmissionProgress('Preparing order data...');

    try {
      // Build selected tests payload (if any)
      setSubmissionProgress('Processing test selections...');
      const selectedTestDetails = testGroups.filter((t) => selectedTests.includes(t.id));

      const testsPayload =
        selectedTestDetails.length > 0
          ? selectedTestDetails.map((t) => {
            const outsourcedLabId = testOutsourcingConfig[t.id] === 'inhouse' ? null : testOutsourcingConfig[t.id] || null;
            const finalPrice = accountPrices[t.id] ?? t.price ?? 0;
            return {
              id: t.id,
              name: t.name,
              type: t.type ?? 'test',
              price: finalPrice,
              outsourced_lab_id: outsourcedLabId
            };
          })
          : undefined;

      // Compose order payload (account layer included)
      setSubmissionProgress('Creating order record...');

      // Calculate total from selected tests (respects package prices and account prices)
      const calculatedTotal = selectedTestDetails.reduce((sum, t) => {
        const price = accountPrices[t.id] ?? t.price ?? 0;
        return sum + price;
      }, 0);

      // Calculate default expected date (24 hours from now/order date)
      const orderDateObj = customOrderDate ? new Date(customOrderDate) : new Date();
      const expectedDateObj = new Date(orderDateObj.getTime() + 24 * 60 * 60 * 1000);
      const computedExpectedDate = expectedDateObj.toISOString();

      const orderData: any = {
        patient_id: selectedPatient!.id,
        patient_name: selectedPatient!.name,
        referring_doctor_id: selectedDoctor || null,
        location_id: selectedLocation || null, // collection/origin
        collected_at_location_id: selectedLocation || null, // for intra-lab transit tracking
        account_id: selectedAccount || null, // B2B bill-to
        payment_type: paymentType,
        priority,
        expected_date: computedExpectedDate,
        doctor: doctors.find((d) => d.id === selectedDoctor)?.name || null,
        notes: notes || null,
        total_amount: calculatedTotal, // Subtotal before discount
        final_amount: finalAmount, // Total after discount
        ...(isAdmin && customOrderDate ? {
          created_at: new Date(customOrderDate).toISOString(),
          order_date: new Date(customOrderDate).toISOString().split('T')[0]
        } : {}),
        // AI Patient Context
        patient_context: {
          age: selectedPatient!.age,
          age_unit: selectedPatient!.age_unit || 'years',
          gender: selectedPatient!.gender,
          weight: additionalInputs.weight,
          height: additionalInputs.height,
          pregnancy_status: additionalInputs.pregnancy_status,
          lmp: additionalInputs.lmp,
          date_of_birth: selectedPatient!.dob || selectedPatient!.date_of_birth || null,
          additional_inputs: additionalInputs // Catch-all
        }
      };

      if (testsPayload) orderData.tests = testsPayload;
      if (testRequestFile) orderData.testRequestFile = testRequestFile;

      setSubmissionProgress('Saving order...');
      const result = await onSubmit(orderData);
      // Auto-create invoice and payment if discount or payment is provided
      if (discountValue > 0 || amountPaid > 0) {
        try {
          setSubmissionProgress('Creating invoice and payment...');

          // Get order ID from result - it's the full order object with {id, ...}
          const orderId = result?.id || result;

          if (!orderId) {
            console.error('No order ID returned from order creation. Result:', result);
            throw new Error('Order created but ID not available');
          }

          console.log('📝 Creating invoice for order:', orderId);
          // Create invoice
          const invoiceData = {
            order_id: orderId,
            patient_id: selectedPatient!.id,
            patient_name: selectedPatient!.name,
            lab_id: await database.getCurrentUserLabId(),
            subtotal: calculatedTotal,
            total_before_discount: calculatedTotal,
            discount: discountValue > 0 ? discountValue : 0,
            total_discount: discountAmount,
            total_after_discount: finalAmount,
            total: finalAmount,
            amount_paid: amountPaid,
            tax: 0,
            due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            status: amountPaid >= finalAmount ? 'Paid' : (amountPaid > 0 ? 'Partial' : 'Draft'),
            // Use Order Number if available, else generate one
            invoice_number: (result as any)?.order_number ? `INV-${(result as any).order_number}` : `INV-${Date.now().toString().slice(-6)}`,
          };

          const { data: invoice, error: invoiceError } = await supabase
            .from('invoices')
            .insert(invoiceData)
            .select()
            .single();

          if (invoiceError) {
            console.error('Invoice creation failed:', invoiceError);
            throw invoiceError;
          }

          console.log('✅ Invoice created:', invoice.id);

          // Update order billing status
          const { error: updateOrderError } = await supabase
            .from('orders')
            .update({
              billing_status: 'billed',
              is_billed: true
            })
            .eq('id', orderId);

          if (updateOrderError) console.error('Failed to update order billing status:', updateOrderError);

          // Create invoice items
          const invoiceItemsData = selectedTestDetails.map(t => {
            const price = accountPrices[t.id] ?? t.price ?? 0;
            return {
              invoice_id: invoice.id,
              test_name: t.name,
              price: price,
              quantity: 1,
              total: price,
              lab_id: invoice.lab_id,
              order_id: orderId
            };
          });

          if (invoiceItemsData.length > 0) {
            const { error: itemsError } = await supabase
              .from('invoice_items')
              .insert(invoiceItemsData);

            if (itemsError) {
              console.error('Error creating invoice items:', itemsError);
            } else {
              console.log(`✅ Added ${invoiceItemsData.length} invoice items`);
            }
          } else {
            console.warn('⚠️ No invoice items to add');
          }

          // Create payment record if amount was paid
          if (amountPaid > 0 && invoice) {
            const { data: authUser } = await supabase.auth.getUser();

            const paymentData = {
              invoice_id: invoice.id,
              amount: amountPaid,
              payment_method: paymentMethod,
              received_by: authUser.user?.id,
              lab_id: await database.getCurrentUserLabId(),
              location_id: selectedLocation || null,
              payment_reference: `PAY-${Date.now()}`,
            };

            const { data: payment, error: paymentError } = await supabase
              .from('payments')
              .insert(paymentData)
              .select()
              .single();

            if (paymentError) {
              console.error('Payment creation failed:', paymentError);
              throw paymentError;
            }

            console.log('✅ Payment created:', payment.id);
          }

          setSubmissionProgress('Order, invoice, and payment created successfully!');

          // Close after short delay
          setTimeout(() => {
            onClose();
          }, 1000);
        } catch (err: any) {
          console.error('Post-order creation error:', err);
          alert(`Order created but failed to create invoice/payment: ${err.message}`);
          onClose();
        }
      } else {
        setSubmissionProgress('Order created successfully!');
        setTimeout(() => {
          onClose();
        }, 1000);
      }

      // OrderForm will be unmounted by onClose
    } catch (error: any) {
      console.error('Order submission error:', error);
      setValidationErrors([`❌ Submission Failed: ${error.message || 'Unknown error occurred'}`]);
      setIsSubmitting(false);
      setSubmissionProgress('');
    }
  };

  // Totals (for UI display only)
  const selectedTestRows = testGroups.filter((t) => selectedTests.includes(t.id));
  const totalAmount = selectedTestRows.reduce((sum, t) => {
    const price = accountPrices[t.id] ?? t.price ?? 0;
    return sum + price;
  }, 0);

  // Calculate discount
  const discountAmount = discountValue > 0
    ? (discountType === 'percentage' ? (totalAmount * discountValue) / 100 : Math.min(discountValue, totalAmount))
    : 0;
  const finalAmount = totalAmount - discountAmount;
  const balanceDue = finalAmount - amountPaid;


  return ReactDOM.createPortal(
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Create New Order</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded">
            <X className="h-6 w-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-8">
          {/* Validation Errors Display */}
          {validationErrors.length > 0 && (
            <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2 text-red-800 font-semibold">
                <AlertCircle className="h-5 w-5" />
                <span>Please fix the following errors:</span>
              </div>
              <ul className="space-y-1 ml-7">
                {validationErrors.map((error, idx) => (
                  <li key={idx} className="text-sm text-red-700">{error}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Loading Overlay */}
          {isSubmitting && (
            <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <Loader className="h-5 w-5 text-blue-600 animate-spin" />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-blue-900">Creating Order...</div>
                  <div className="text-xs text-blue-700 mt-1">{submissionProgress}</div>
                </div>
              </div>
              <div className="mt-3 h-2 bg-blue-200 rounded-full overflow-hidden">
                <div className="h-full bg-blue-600 animate-pulse" style={{ width: '100%' }} />
              </div>
            </div>
          )}

          {/* 🚀 TRF Upload Section - AT TOP */}
          <section className="space-y-3 bg-gradient-to-r from-purple-50 to-blue-50 p-4 rounded-lg border-2 border-dashed border-purple-300">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-5 w-5 text-purple-600" />
              <h3 className="text-lg font-medium text-gray-900">AI-Powered TRF Extraction</h3>
              <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                Quick Start
              </span>
            </div>
            <p className="text-sm text-gray-600 mb-3">
              Upload a Test Request Form to automatically extract patient info, doctor details, and test selections
            </p>

            <div className="space-y-3">
              <input
                type="file"
                id="trf-upload-top"
                accept="image/*,.pdf"
                onChange={handleFileChange}
                className="hidden"
              />
              <label
                htmlFor="trf-upload-top"
                className="block cursor-pointer border-2 border-dashed border-purple-300 bg-white rounded-lg p-6 text-center hover:border-purple-400 hover:bg-purple-50 transition-colors"
              >
                {processingTRF && trfProgress ? (
                  <>
                    <Loader className="w-8 h-8 text-purple-600 mb-2 mx-auto animate-spin" />
                    <span className="text-sm font-medium text-purple-700">
                      {trfProgress.stage || 'Processing TRF...'}
                    </span>
                    {trfProgress.progress !== undefined && (
                      <div className="mt-2 max-w-xs mx-auto">
                        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-purple-600 transition-all duration-300"
                            style={{ width: `${trfProgress.progress}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-600 mt-1 block">
                          {Math.round(trfProgress.progress || 0)}%
                        </span>
                      </div>
                    )}
                  </>
                ) : processingTRF ? (
                  <div className="flex flex-col items-center">
                    <Loader className="w-8 h-8 text-purple-600 mb-2 animate-spin" />
                    <span className="text-sm font-medium text-purple-700">Initializing...</span>
                  </div>
                ) : trfExtraction?.success ? (
                  <>
                    <CheckCircle className="w-8 h-8 text-green-600 mb-2 mx-auto" />
                    <span className="text-sm font-medium text-green-700">
                      TRF Processed Successfully!
                    </span>
                    <span className="text-xs text-gray-600 mt-1 block">
                      {testRequestFile?.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowTRFReview(true)}
                      className="mt-3 px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 font-medium text-sm flex items-center gap-2 mx-auto"
                    >
                      <Sparkles className="w-4 h-4" />
                      Review Extracted Data
                    </button>
                  </>
                ) : (
                  <>
                    <Upload className="w-10 h-10 text-purple-500 mb-3 mx-auto" />
                    <span className="text-base font-medium text-gray-700 flex items-center justify-center gap-2">
                      <Sparkles className="w-5 h-5 text-purple-500" />
                      {testRequestFile ? testRequestFile.name : 'Click to Upload TRF or Drag & Drop'}
                    </span>
                    <span className="text-xs text-gray-500 mt-2 block">
                      Supports: JPG, PNG, PDF (Max 10MB)
                    </span>
                    <span className="text-xs text-purple-600 mt-1 block font-medium">
                      ⚡ Auto-extracts patient, doctor, and test details
                    </span>
                  </>
                )}
              </label>

              {/* Unmatched Tests Warning */}
              {trfUnmatchedTests.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-yellow-800">
                        ⚠ {trfUnmatchedTests.length} tests need manual selection
                      </p>
                      <p className="text-xs text-yellow-700 mt-1">
                        {trfUnmatchedTests.join(', ')}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Validation Errors Display */}
          {validationErrors.length > 0 && (
            <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2 text-red-800 font-semibold">
                <AlertCircle className="h-5 w-5" />
                <span>Please fix the following errors:</span>
              </div>
              <ul className="space-y-1 ml-7">
                {validationErrors.map((error, idx) => (
                  <li key={idx} className="text-sm text-red-700">{error}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Loading Overlay */}
          {isSubmitting && (
            <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <Loader className="h-5 w-5 text-blue-600 animate-spin" />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-blue-900">Creating Order...</div>
                  <div className="text-xs text-blue-700 mt-1">{submissionProgress}</div>
                </div>
              </div>
              <div className="mt-3 h-2 bg-blue-200 rounded-full overflow-hidden">
                <div className="h-full bg-blue-600 animate-pulse" style={{ width: '100%' }} />
              </div>
            </div>
          )}

          {/* Patient Section */}
          <section className="space-y-3 pb-6">
            <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
              <User className="h-5 w-5" />
              Patient Information
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4" style={{ minHeight: '320px' }}>
              <div className="relative">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Select Patient *
                </label>
                <div className="relative">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="w-4 h-4 text-gray-400 absolute left-2 top-2.5 pointer-events-none z-10" />
                      <input
                        type="text"
                        value={patientSearch}
                        onChange={(e) => {
                          setPatientSearch(e.target.value);
                          setShowPatientDropdown(true);
                        }}
                        onFocus={() => setShowPatientDropdown(true)}
                        onBlur={() => setTimeout(() => setShowPatientDropdown(false), 200)}
                        placeholder="Search by name, phone, or ID…"
                        className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 relative z-0"
                      />
                      {showPatientDropdown && filteredPatients.length > 0 && (
                        <div className="absolute z-[100] w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-2xl max-h-64 overflow-y-auto">
                          {filteredPatients.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => onPickPatient(p)}
                              className="w-full px-4 py-3 text-left hover:bg-blue-50 border-b border-gray-100 last:border-b-0 transition-colors"
                            >
                              <div className="font-semibold text-gray-900 text-sm">{p.name}</div>
                              <div className="text-xs text-gray-600 mt-0.5">
                                {(p.age ?? '-') + 'y'}, {p.gender ?? '-'} • {p.phone ?? '-'} • ID: {p.id.slice(-8)}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {!selectedPatient && (
                      <button
                        type="button"
                        onClick={() => setShowNewPatientModal(true)}
                        className="px-3 py-2 text-sm bg-blue-50 text-blue-700 rounded-md hover:bg-blue-100 whitespace-nowrap"
                      >
                        <span className="inline-flex items-center gap-1">
                          <Plus className="h-4 w-4" /> Add Patient
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {selectedPatient && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="text-sm">
                    <div className="font-medium text-blue-900">{selectedPatient.name}</div>
                    <div className="text-blue-700">
                      {(selectedPatient.age ?? '-') + 'y'}, {selectedPatient.gender ?? '-'}
                    </div>
                    {selectedPatient.phone && (
                      <div className="text-blue-700">Phone: {selectedPatient.phone}</div>
                    )}
                    {selectedPatient.email && (
                      <div className="text-blue-700">Email: {selectedPatient.email}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Test Selection */}
          <section className="space-y-3">
            <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
              <TestTube className="h-5 w-5" />
              Test Selection
            </h3>

            {loadingTests ? (
              <div className="p-4 text-center text-gray-500">Loading tests…</div>
            ) : (
              <div className="space-y-3">
                {/* Test Search */}
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3 pointer-events-none" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={testSearch}
                    placeholder="Search tests or packages... (Press Enter to select)"
                    onChange={(e) => {
                      setTestSearch(e.target.value);
                      setShowTestList(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && testSearch) {
                        e.preventDefault(); // Prevent form submission
                        const search = testSearch.toLowerCase();
                        const match = testGroups.find(t =>
                          t.name.toLowerCase().includes(search) ||
                          (t.category && t.category.toLowerCase().includes(search)) ||
                          (t.code && t.code.toLowerCase().includes(search)) ||
                          (t.type === 'package' && 'package'.includes(search))
                        );
                        if (match) handleToggleTest(match.id);
                      }
                    }}
                    onFocus={() => setShowTestList(true)}
                    className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Collapsible Test List */}
                {showTestList && (
                  <div className="border border-gray-200 rounded-lg divide-y max-h-80 overflow-y-auto bg-white shadow-lg">
                    {testGroups.length === 0 ? (
                      <div className="p-4 text-gray-500 text-sm">No tests or packages found.</div>
                    ) : (
                      testGroups
                        .filter((t) => {
                          if (!testSearch) return true;
                          const search = testSearch.toLowerCase();
                          return (
                            t.name.toLowerCase().includes(search) ||
                            (t.category && t.category.toLowerCase().includes(search)) ||
                            (t.code && t.code.toLowerCase().includes(search)) ||
                            (t.type === 'package' && 'package'.includes(search))
                          );
                        })
                        .map((t) => (
                          <label
                            key={t.id}
                            className={`flex items-center justify-between p-3 hover:bg-blue-50 cursor-pointer transition-colors ${t.type === 'package' ? 'bg-purple-50' : ''}`}
                          >
                            <div className="flex items-center gap-3">
                              <input
                                type="checkbox"
                                checked={selectedTests.includes(t.id)}
                                onChange={() => handleToggleTest(t.id)}
                                className="w-4 h-4 text-blue-600 flex-shrink-0"
                              />
                              <SampleTypeIndicator
                                sampleType={t.sample_type || 'Blood'}
                                sampleColor={t.sample_color || undefined}
                                size="sm"
                              />
                              <div>
                                <div className="text-sm font-medium text-gray-900 flex items-center gap-2">
                                  {t.name}
                                  {t.type === 'package' && (
                                    <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                                      📦 Package
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-gray-500">
                                  {t.type === 'package'
                                    ? `${t.testGroupIds?.length || 0} tests included`
                                    : (t.category ?? 'General') + (t.requiresFasting ? ' • Fasting' : '')}
                                </div>
                              </div>
                            </div>
                            <div className="text-sm font-semibold text-gray-900">₹{t.price ?? 0}</div>
                          </label>
                        ))
                    )}
                  </div>
                )}

                {/* Show selected count when collapsed */}
                {!showTestList && selectedTests.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowTestList(true)}
                    className="w-full p-3 bg-blue-50 border border-blue-200 rounded-lg text-left hover:bg-blue-100 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-blue-900">
                        {selectedTests.length} test{selectedTests.length !== 1 ? 's' : ''} selected
                      </span>
                      <span className="text-xs text-blue-700">Click to view/edit</span>
                    </div>
                  </button>
                )}
              </div>
            )}

            {selectedTests.length > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h4 className="font-medium text-green-900 mb-2 flex items-center gap-2">
                  <TestTube className="h-4 w-4" />
                  Selected Tests & Packages ({selectedTests.length})
                </h4>
                <div className="space-y-2 text-sm">
                  {testGroups
                    .filter((t) => selectedTests.includes(t.id))
                    .map((t) => {
                      const outsourcingStatus = testOutsourcingConfig[t.id] || 'inhouse';
                      const isOutsourced = outsourcingStatus !== 'inhouse';
                      const outsourcedLab = isOutsourced ? outsourcedLabs.find(lab => lab.id === outsourcingStatus) : null;
                      const isPackage = t.type === 'package';

                      return (
                        <div key={t.id} className={`flex items-center justify-between gap-2 p-2 bg-white rounded border ${isPackage ? 'border-purple-200' : 'border-green-100'}`}>
                          <div className="flex-1">
                            <div className="flex items-center gap-3">
                              <SampleTypeIndicator
                                sampleType={t.sample_type || 'Blood'}
                                sampleColor={t.sample_color || undefined}
                                size="sm"
                              />
                              <span className={`${isPackage ? 'text-purple-800' : 'text-green-800'} font-medium`}>{t.name}</span>
                              {isPackage && (
                                <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                                  📦 Package
                                </span>
                              )}
                              {isOutsourced && (
                                <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">
                                  Outsourced
                                </span>
                              )}
                            </div>
                            {/* Show included tests for packages */}
                            {isPackage && t.testGroupIds && t.testGroupIds.length > 0 && (
                              <div className="text-xs text-purple-600 mt-1">
                                {t.testGroupIds.length} tests included
                              </div>
                            )}
                            {/* Outsource Lab Selector - only for non-packages */}
                            {!isPackage && (
                              <div className="mt-1 flex items-center gap-2">
                                <select
                                  value={outsourcingStatus}
                                  onChange={(e) => setTestOutsourcingConfig(config => ({
                                    ...config,
                                    [t.id]: e.target.value
                                  }))}
                                  className="text-xs px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                >
                                  <option value="inhouse">🏠 In-house</option>
                                  {outsourcedLabs.map((lab) => (
                                    <option key={lab.id} value={lab.id}>
                                      🏥 {lab.name}
                                    </option>
                                  ))}
                                </select>
                                {isOutsourced && outsourcedLab && (
                                  <span className="text-xs text-orange-600">
                                    → {outsourcedLab.name}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="flex flex-col items-end">
                              <span className={`font-medium ${isPackage ? 'text-purple-900' : 'text-green-900'} whitespace-nowrap`}>
                                {currencySymbol}{accountPrices[t.id] ?? t.price ?? 0}
                              </span>
                              {accountPrices[t.id] !== undefined && (
                                <span className="text-[10px] text-indigo-600 font-medium bg-indigo-50 px-1 rounded border border-indigo-100">
                                  Account Price
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedTests(prev => prev.filter(id => id !== t.id));
                              }}
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                              title="Remove"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
                <div className="border-t border-green-200 mt-2 pt-2 flex justify-between font-semibold text-green-900">
                  <span>Total Amount:</span>
                  <span>₹{totalAmount}</span>
                </div>
                {/* Monthly Billing Indicator */}
                {selectedAccount && accounts.find(a => a.id === selectedAccount)?.billing_mode === 'monthly' && (
                  <div className="mt-2 bg-purple-50 border border-purple-200 p-3 rounded-lg">
                    <div className="flex items-center gap-2 text-purple-900">
                      <Briefcase className="h-4 w-4" />
                      <span className="font-semibold">Monthly Billing Account</span>
                    </div>
                    <p className="text-xs text-purple-700 mt-1">
                      This order will be included in consolidated monthly billing for {accounts.find(a => a.id === selectedAccount)?.name}. No individual invoice will be generated.
                    </p>
                  </div>
                )}
                <div className="mt-2 text-xs text-green-700 bg-green-100 p-2 rounded">
                  💡 Tip: Select "In-house" for tests performed in your lab, or choose an outsourced lab if test is sent externally
                </div>
              </div>
            )}
          </section>

          {/* Required Patient Inputs (AI Context) */}
          {requiredInfos.length > 0 && (
            <section className="space-y-4 bg-purple-50 p-4 rounded-lg border border-purple-200">
              <h3 className="text-lg font-medium text-purple-900 flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Additional Patient Information
              </h3>
              <p className="text-sm text-purple-700 -mt-2">
                Required for accurate reference range calculation for selected tests.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {requiredInfos.map(info => (
                  <div key={info}>
                    <label className="block text-sm font-medium text-purple-900 mb-1 capitalize">
                      {info.replace(/_/g, ' ')} <span className="text-red-500">*</span>
                    </label>

                    {info === 'pregnancy_status' ? (
                      <select
                        value={additionalInputs[info] || ''}
                        onChange={e => setAdditionalInputs(prev => ({ ...prev, [info]: e.target.value }))}
                        className="w-full px-3 py-2 border border-purple-300 rounded-md focus:ring-2 focus:ring-purple-500 bg-white"
                      >
                        <option value="">Select Status</option>
                        <option value="Not Pregnant">Not Pregnant</option>
                        <option value="Trimester 1">First Trimester (1-12 weeks)</option>
                        <option value="Trimester 2">Second Trimester (13-26 weeks)</option>
                        <option value="Trimester 3">Third Trimester (27+ weeks)</option>
                        <option value="Lactating">Lactating</option>
                      </select>
                    ) : info === 'lmp' ? (
                      <input
                        type="date"
                        value={additionalInputs[info] || ''}
                        onChange={e => setAdditionalInputs(prev => ({ ...prev, [info]: e.target.value }))}
                        className="w-full px-3 py-2 border border-purple-300 rounded-md focus:ring-2 focus:ring-purple-500"
                      />
                    ) : (
                      <input
                        type="text"
                        value={additionalInputs[info] || ''}
                        onChange={e => setAdditionalInputs(prev => ({ ...prev, [info]: e.target.value }))}
                        className="w-full px-3 py-2 border border-purple-300 rounded-md focus:ring-2 focus:ring-purple-500"
                        placeholder={`Enter ${info.replace(/_/g, ' ')}...`}
                      />
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Order Details */}
          <section className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Order Details
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Priority */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as any)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {['Normal', 'Urgent', 'STAT'].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              {/* Expected Date */}


              {/* Admin: Backdated Order */}
              {isAdmin && (
                <div>
                  <label className="block text-sm font-medium text-purple-700 mb-1 flex items-center gap-1">
                    <ClockIcon className="w-3.5 h-3.5" />
                    Order Date (Admin)
                  </label>
                  <input
                    type="datetime-local"
                    value={customOrderDate}
                    onChange={(e) => setCustomOrderDate(e.target.value)}
                    max={new Date().toISOString().slice(0, 16)}
                    className="w-full px-3 py-2 border border-purple-300 bg-purple-50 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                  />
                  <p className="text-[10px] text-purple-600 mt-0.5">Leave empty for today (now)</p>
                </div>
              )}

              {/* Expected Date */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Expected Date
                </label>
                <input
                  type="date"
                  value={expectedDate}
                  onChange={(e) => setExpectedDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Expected TAT Display */}
              {selectedTests.length > 0 && (
                <div className="md:col-span-3 bg-gray-50 p-3 rounded-md border border-gray-200 flex items-center gap-2">
                  <ClockIcon className="w-4 h-4 text-gray-500" />
                  <span className="text-sm text-gray-700">
                    <span className="font-medium">Expected TAT:</span>{' '}
                    {(() => {
                      const selectedDetails = testGroups.filter(t => selectedTests.includes(t.id));
                      const tats = selectedDetails.map(t => t.turnaroundTime).filter(Boolean);
                      if (tats.length === 0) return 'Not specified';
                      // Simple logic: return the longest string or just list them if few
                      // For now, just join unique ones
                      const uniqueTats = Array.from(new Set(tats));
                      return uniqueTats.join(', ');
                    })()}
                  </span>
                </div>
              )}

              {/* Payment Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Payment Type
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['self', 'credit', 'insurance', 'corporate'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setPaymentType(type)}
                      className={`px-3 py-2 rounded-md text-sm font-medium ${paymentType === type
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                    >
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Referring Doctor */}
              <div className="md:col-span-3 relative" style={{ minHeight: showDoctorDropdown && filteredDoctors.length > 0 ? '230px' : 'auto' }}>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Referring Doctor <span className="text-red-500 text-lg" title="Required field">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search doctor…"
                    value={doctorSearch}
                    onChange={(e) => {
                      setDoctorSearch(e.target.value);
                      setShowDoctorDropdown(true);
                      // Clear doctor error when user starts typing
                      if (validationErrors.some(e => e.includes('Referring Doctor'))) {
                        setValidationErrors(prev => prev.filter(e => !e.includes('Referring Doctor')));
                      }
                    }}
                    onFocus={() => setShowDoctorDropdown(true)}
                    onBlur={() => setTimeout(() => setShowDoctorDropdown(false), 200)}
                    className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 transition-colors ${validationErrors.some(e => e.includes('Referring Doctor'))
                      ? 'border-red-400 bg-red-50 focus:ring-red-200 focus:border-red-500'
                      : 'border-gray-300 focus:ring-blue-500'
                      }`}
                  />
                  {showDoctorDropdown && filteredDoctors.length > 0 && (
                    <div className="absolute z-[100] w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-2xl max-h-48 overflow-y-auto">
                      {filteredDoctors.map((doctor) => (
                        <button
                          key={doctor.id}
                          type="button"
                          onClick={() => {
                            setSelectedDoctor(doctor.id);
                            setDoctorSearch(doctor.name);
                            setShowDoctorDropdown(false);
                          }}
                          className="w-full px-4 py-2 text-left hover:bg-blue-50 transition-colors"
                        >
                          <div className="font-medium text-gray-900">{doctor.name}</div>
                          {doctor.specialization && (
                            <div className="text-xs text-gray-500">{doctor.specialization}</div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Location (collection/origin) */}
              <div className="md:col-span-3 relative" style={{ minHeight: showLocationDropdown && filteredLocations.length > 0 ? '230px' : 'auto' }}>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Location {paymentType !== 'self' && '(required if no Account)'}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search location…"
                    value={locationSearch}
                    onChange={(e) => {
                      setLocationSearch(e.target.value);
                      setShowLocationDropdown(true);
                    }}
                    onFocus={() => setShowLocationDropdown(true)}
                    onBlur={() => setTimeout(() => setShowLocationDropdown(false), 200)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {showLocationDropdown && filteredLocations.length > 0 && (
                    <div className="absolute z-[100] w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-2xl max-h-48 overflow-y-auto">
                      {filteredLocations.map((location) => (
                        <button
                          key={location.id}
                          type="button"
                          onClick={() => {
                            setSelectedLocation(location.id);
                            setLocationSearch(location.name);
                            setShowLocationDropdown(false);
                          }}
                          className="w-full px-4 py-2 text-left hover:bg-blue-50 flex items-center gap-2 transition-colors"
                        >
                          <Building className="w-4 h-4 text-gray-400" />
                          <div>
                            <div className="font-medium text-gray-900">{location.name}</div>
                            <div className="text-xs text-gray-500">
                              {location.type.replace(/_/g, ' ')}
                              {location.credit_limit ? ` • Credit: ₹${location.credit_limit}` : ''}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Bill-to Account (optional, used for B2B) */}
              <div className="md:col-span-3 relative" style={{ minHeight: showAccountDropdown && filteredAccounts.length > 0 ? '230px' : 'auto' }}>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Bill-to Account (optional for credit/corporate/insurance)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search account (hospital / corporate / insurer)…"
                    value={accountSearch}
                    onChange={(e) => {
                      setAccountSearch(e.target.value);
                      setShowAccountDropdown(true);
                    }}
                    onFocus={() => setShowAccountDropdown(true)}
                    onBlur={() => setTimeout(() => setShowAccountDropdown(false), 200)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {showAccountDropdown && filteredAccounts.length > 0 && (
                    <div className="absolute z-[100] w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-2xl max-h-48 overflow-y-auto">
                      {filteredAccounts.map((account) => (
                        <button
                          key={account.id}
                          type="button"
                          onClick={() => {
                            setSelectedAccount(account.id);
                            setAccountSearch(account.name);
                            setShowAccountDropdown(false);
                          }}
                          className="w-full px-4 py-2 text-left hover:bg-blue-50 flex items-center gap-2 transition-colors"
                        >
                          <Briefcase className="w-4 h-4 text-gray-400" />
                          <div>
                            <div className="font-medium text-gray-900">{account.name}</div>
                            <div className="text-xs text-gray-500">
                              {account.type}
                              {account.credit_limit ? ` • Credit: ₹${account.credit_limit}` : ''}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-gray-500 mt-1">
                    If selected, the invoice and credit tracking will be under this Account. Otherwise they remain location-based.
                  </p>
                </div>
              </div>
            </div>

            {/* Credit Info */}
            {creditInfo && paymentType !== 'self' && (
              <div
                className={`p-4 rounded-lg ${creditInfo.allowed
                  ? 'bg-green-50 border border-green-200'
                  : 'bg-red-50 border border-red-200'
                  }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <CreditCard
                    className={`w-5 h-5 ${creditInfo.allowed ? 'text-green-600' : 'text-red-600'}`}
                  />
                  <h4
                    className={`font-medium ${creditInfo.allowed ? 'text-green-900' : 'text-red-900'
                      }`}
                  >
                    {creditInfo.kind === 'account' ? 'Account' : 'Location'} Credit
                  </h4>
                </div>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">Name:</span>
                    <div className="font-medium">{creditInfo.name}</div>
                  </div>
                  <div>
                    <span className="text-gray-600">Credit Limit:</span>
                    <div className="font-medium">₹{creditInfo.creditLimit.toLocaleString()}</div>
                  </div>
                  <div>
                    <span className="text-gray-600">Current Balance:</span>
                    <div className="font-medium">
                      ₹{creditInfo.currentBalance.toLocaleString()}
                    </div>
                  </div>
                  <div className="col-span-3">
                    <span className="text-gray-600">Available Credit:</span>{' '}
                    <span
                      className={`font-medium ${creditInfo.allowed ? 'text-green-600' : 'text-red-600'
                        }`}
                    >
                      ₹{creditInfo.availableCredit.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Notes */}
          <section>
            <label className="block text-sm font-medium text-gray-700 mb-1">Clinical Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Any special instructions or clinical notes…"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </section>

          {/* Discount & Payment Section */}
          {selectedTests.length > 0 && (
            <section className="space-y-4 border-t pt-4">
              <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Billing & Payment
              </h3>

              {/* Amount Breakdown */}
              <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Subtotal ({selectedTests.length} tests)</span>
                  <span className="font-medium">{currencySymbol}{totalAmount.toLocaleString()}</span>
                </div>

                {/* Discount Input */}
                <div className="flex items-center gap-3 border-t pt-2">
                  <label className="text-sm font-medium text-gray-700 min-w-[80px]">Discount</label>
                  <div className="flex gap-2 flex-1">
                    <button
                      type="button"
                      onClick={() => setDiscountType(discountType === 'percentage' ? 'fixed' : 'percentage')}
                      className="px-3 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-100 bg-white"
                    >
                      {discountType === 'percentage' ? '%' : currencySymbol}
                    </button>
                    <input
                      type="number"
                      min="0"
                      max={discountType === 'percentage' ? 100 : totalAmount}
                      value={discountValue}
                      onChange={(e) => setDiscountValue(Number(e.target.value))}
                      placeholder={`Enter discount${discountType === 'percentage' ? ' %' : ''}`}
                      className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {discountAmount > 0 && (
                  <div className="flex justify-between text-sm text-green-600">
                    <span>Discount ({discountType === 'percentage' ? `${discountValue}%` : `${currencySymbol}${discountValue}`})</span>
                    <span>-{currencySymbol}{discountAmount.toLocaleString()}</span>
                  </div>
                )}

                <div className="flex justify-between text-base font-semibold border-t pt-2">
                  <span>Final Amount</span>
                  <span className="text-blue-600">{currencySymbol}{finalAmount.toLocaleString()}</span>
                </div>
              </div>

              {/* Payment Collection */}
              <div className="border-t pt-3">
                <label className="block text-sm font-medium text-gray-700 mb-2">Collect Payment (Optional)</label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value as any)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="upi">UPI</option>
                      <option value="online">Online</option>
                    </select>
                  </div>
                  <div>
                    <input
                      type="number"
                      min="0"
                      max={finalAmount}
                      value={amountPaid}
                      onChange={(e) => setAmountPaid(Number(e.target.value))}
                      placeholder="Amount received"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {amountPaid > 0 && (
                  <div className="mt-2 p-2 bg-blue-50 rounded text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Paid:</span>
                      <span className="font-medium text-green-600">{currencySymbol}{amountPaid.toLocaleString()}</span>
                    </div>
                    {balanceDue > 0 && (
                      <div className="flex justify-between mt-1">
                        <span className="text-gray-600">Balance Due:</span>
                        <span className="font-medium text-red-600">{currencySymbol}{balanceDue.toLocaleString()}</span>
                      </div>
                    )}
                    {balanceDue < 0 && (
                      <div className="flex justify-between mt-1">
                        <span className="text-gray-600">Change:</span>
                        <span className="font-medium text-orange-600">{currencySymbol}{Math.abs(balanceDue).toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                )}

                <p className="text-xs text-gray-500 mt-2">
                  💡 Leave empty to collect payment later via invoice
                </p>
              </div>
            </section>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between border-t pt-6">
            <div className="text-sm text-gray-600">
              {selectedTests.length > 0 ? (
                <span className="font-medium">Total: {currencySymbol}{totalAmount}</span>
              ) : (
                <span>Select tests now or continue—tests can be added later.</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader className="h-4 w-4 animate-spin" />
                    <span>Creating Order...</span>
                  </>
                ) : (
                  <span>Create Order{selectedTests.length > 0 ? ` – ${currencySymbol}${totalAmount}` : ''}</span>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* New Patient Modal */}
      {showNewPatientModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Add New Patient</h3>
              <button onClick={() => setShowNewPatientModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newPatient.name || !newPatient.age || !newPatient.gender || !newPatient.phone) return;
                try {
                  setCreatingPatient(true);
                  const payload: any = {
                    name: newPatient.name.trim(),
                    age: parseInt(newPatient.age, 10),
                    gender: newPatient.gender,
                    phone: newPatient.phone.trim(),
                    email: newPatient.email?.trim() || null,
                    // sensible defaults
                    address: '',
                    city: '',
                    state: '',
                    pincode: '',
                    emergency_contact: null,
                    emergency_phone: null,
                    blood_group: null,
                    allergies: null,
                    medical_history: null,
                    total_tests: 0,
                    is_active: true,
                    referring_doctor: null,
                    default_doctor_id: selectedDoctor || null,
                    default_location_id: selectedLocation || null,
                    default_payment_type: paymentType || 'self'
                  };

                  const { data, error } = await (database as any).patients?.create?.(payload);
                  if (error) {
                    console.error(error);
                    alert('Failed to create patient');
                    return;
                  }
                  if (data) {
                    setPatients((prev) => [...prev, data]);
                    setSelectedPatient(data);
                    setShowNewPatientModal(false);
                    setNewPatient({ name: '', age: '', gender: 'Male', phone: '', email: '' });
                  }
                } catch (err) {
                  console.error(err);
                  alert('Error creating patient');
                } finally {
                  setCreatingPatient(false);
                }
              }}
              className="p-6 space-y-4"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                  <input
                    type="text"
                    required
                    value={newPatient.name}
                    onChange={(e) => setNewPatient((p) => ({ ...p, name: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Age *</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={newPatient.age}
                    onChange={(e) => setNewPatient((p) => ({ ...p, age: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Gender *</label>
                  <select
                    value={newPatient.gender}
                    onChange={(e) => setNewPatient((p) => ({ ...p, gender: e.target.value }))}
                    className="w-full rounded-md border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  >
                    <option>Male</option>
                    <option>Female</option>
                    <option>Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone *</label>
                  <input
                    type="tel"
                    required
                    value={newPatient.phone}
                    onChange={(e) => setNewPatient((p) => ({ ...p, phone: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={newPatient.email}
                    onChange={(e) => setNewPatient((p) => ({ ...p, email: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewPatientModal(false)}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                  disabled={creatingPatient}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    creatingPatient || !newPatient.name || !newPatient.age || !newPatient.phone
                  }
                  className="px-5 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  {creatingPatient ? 'Saving…' : 'Save Patient'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TRF Review Modal */}
      {showTRFReview && trfExtraction && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-600" />
                <h3 className="text-lg font-semibold text-gray-900">
                  AI Extracted Data Review & Edit
                </h3>
                <span className="text-xs text-gray-500 bg-blue-50 px-2 py-1 rounded">
                  Click fields to edit
                </span>
              </div>
              <button onClick={handleTRFReviewClose} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Patient Information */}
              {trfExtraction.patientInfo && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-gray-900 flex items-center gap-2">
                      <User className="w-4 h-4" />
                      Patient Information
                    </h4>
                    <span className={`text-xs px-2 py-1 rounded-full ${formatConfidence(trfExtraction.patientInfo.confidence).bgColor
                      } ${formatConfidence(trfExtraction.patientInfo.confidence).color}`}>
                      {formatConfidence(trfExtraction.patientInfo.confidence).label}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded-lg">
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Name</label>
                      <input
                        type="text"
                        value={trfExtraction.patientInfo.name || ''}
                        onChange={(e) => setTrfExtraction({
                          ...trfExtraction,
                          patientInfo: { ...trfExtraction.patientInfo!, name: e.target.value }
                        })}
                        className="w-full text-sm font-medium border border-gray-300 rounded px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Enter name"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Age</label>
                      <input
                        type="number"
                        value={trfExtraction.patientInfo.age || ''}
                        onChange={(e) => setTrfExtraction({
                          ...trfExtraction,
                          patientInfo: { ...trfExtraction.patientInfo!, age: parseInt(e.target.value) || 0 }
                        })}
                        className="w-full text-sm font-medium border border-gray-300 rounded px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Enter age"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Gender</label>
                      <select
                        value={trfExtraction.patientInfo.gender || 'Male'}
                        onChange={(e) => setTrfExtraction({
                          ...trfExtraction,
                          patientInfo: { ...trfExtraction.patientInfo!, gender: e.target.value as 'Male' | 'Female' | 'Other' }
                        })}
                        className="w-full text-sm font-medium border border-gray-300 rounded px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Phone</label>
                      <input
                        type="tel"
                        value={trfExtraction.patientInfo.phone || ''}
                        onChange={(e) => setTrfExtraction({
                          ...trfExtraction,
                          patientInfo: { ...trfExtraction.patientInfo!, phone: e.target.value }
                        })}
                        className="w-full text-sm font-medium border border-gray-300 rounded px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Enter phone"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs text-gray-500 block mb-1">Email (optional)</label>
                      <input
                        type="email"
                        value={trfExtraction.patientInfo.email || ''}
                        onChange={(e) => setTrfExtraction({
                          ...trfExtraction,
                          patientInfo: { ...trfExtraction.patientInfo!, email: e.target.value }
                        })}
                        className="w-full text-sm font-medium border border-gray-300 rounded px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Enter email"
                      />
                    </div>
                  </div>

                  {/* Matched Patient */}
                  {trfExtraction.matchedPatient && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-green-600" />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-green-800">
                            Matched Existing Patient
                          </p>
                          <p className="text-xs text-green-700">
                            {trfExtraction.matchedPatient.name} • {trfExtraction.matchedPatient.phone}
                            {' '} • {Math.round(trfExtraction.matchedPatient.matchConfidence * 100)}% match
                          </p>
                          {trfExtraction.matchedPatient.matchReason && (
                            <p className="text-xs text-green-600 mt-1">
                              {trfExtraction.matchedPatient.matchReason === 'phone_and_name' && '✓ Matched by phone and name'}
                              {trfExtraction.matchedPatient.matchReason === 'phone_only' && '⚠ Matched by phone only (no name in TRF)'}
                              {trfExtraction.matchedPatient.matchReason === 'phone_only_name_mismatch' && '⚠ Phone matches but name differs - please verify'}
                              {trfExtraction.matchedPatient.matchReason === 'name_only' && '✓ Matched by name only'}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* New Patient Warning */}
                  {!trfExtraction.matchedPatient && trfExtraction.patientInfo.name && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-blue-600" />
                        <div>
                          <p className="text-sm font-medium text-blue-800">
                            New Patient
                          </p>
                          <p className="text-xs text-blue-700">
                            No existing patient found. A new patient record will be created.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Requested Tests */}
              {trfExtraction.requestedTests && trfExtraction.requestedTests.length > 0 && (
                <div className="space-y-3">
                  <h4 className="font-medium text-gray-900 flex items-center gap-2">
                    <TestTube className="w-4 h-4" />
                    Requested Tests ({trfExtraction.requestedTests.filter(t => t.isSelected).length} selected)
                  </h4>

                  <div className="space-y-2">
                    {trfExtraction.requestedTests.map((test, idx) => (
                      <div
                        key={idx}
                        className={`p-3 rounded-lg border ${test.matched
                          ? 'bg-green-50 border-green-200'
                          : 'bg-yellow-50 border-yellow-200'
                          }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 flex-1">
                            <input
                              type="checkbox"
                              checked={test.isSelected}
                              onChange={(e) => {
                                const updatedTests = [...trfExtraction.requestedTests!];
                                updatedTests[idx] = { ...updatedTests[idx], isSelected: e.target.checked };
                                setTrfExtraction({
                                  ...trfExtraction,
                                  requestedTests: updatedTests
                                });
                              }}
                              className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-2 focus:ring-blue-500"
                            />
                            <div className="flex-1">
                              <input
                                type="text"
                                value={test.testName}
                                onChange={(e) => {
                                  const updatedTests = [...trfExtraction.requestedTests!];
                                  updatedTests[idx] = { ...updatedTests[idx], testName: e.target.value };
                                  setTrfExtraction({
                                    ...trfExtraction,
                                    requestedTests: updatedTests
                                  });
                                }}
                                className="text-sm font-medium bg-transparent border-0 border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:ring-0 w-full"
                              />
                              {test.matched && test.matchedTestName && (
                                <p className="text-xs text-gray-600 mt-1">
                                  Matched to: {test.matchedTestName}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {test.matched ? (
                              <CheckCircle className="w-4 h-4 text-green-600" />
                            ) : (
                              <AlertTriangle className="w-4 h-4 text-yellow-600" />
                            )}
                            <span className="text-xs text-gray-500">
                              {Math.round((test.matchConfidence || test.confidence) * 100)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Doctor Information */}
              {trfExtraction.doctorInfo && trfExtraction.doctorInfo.name && (
                <div className="space-y-3">
                  <h4 className="font-medium text-gray-900">Referring Doctor</h4>
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <input
                      type="text"
                      value={trfExtraction.doctorInfo.name}
                      onChange={(e) => setTrfExtraction({
                        ...trfExtraction,
                        doctorInfo: { ...trfExtraction.doctorInfo!, name: e.target.value }
                      })}
                      className="w-full text-sm font-medium border border-gray-300 rounded px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Enter doctor name"
                    />
                    {trfExtraction.doctorInfo.specialization && (
                      <input
                        type="text"
                        value={trfExtraction.doctorInfo.specialization}
                        onChange={(e) => setTrfExtraction({
                          ...trfExtraction,
                          doctorInfo: { ...trfExtraction.doctorInfo!, specialization: e.target.value }
                        })}
                        className="w-full text-xs text-gray-600 mt-2 border border-gray-300 rounded px-2 py-1 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Enter specialization"
                      />
                    )}
                  </div>
                </div>
              )}

              {/* Clinical Notes */}
              {trfExtraction.clinicalNotes && (
                <div className="space-y-3">
                  <h4 className="font-medium text-gray-900">Clinical Notes</h4>
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <textarea
                      value={trfExtraction.clinicalNotes}
                      onChange={(e) => setTrfExtraction({
                        ...trfExtraction,
                        clinicalNotes: e.target.value
                      })}
                      rows={3}
                      className="w-full text-sm text-gray-700 border border-gray-300 rounded px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Enter clinical notes"
                    />
                  </div>
                </div>
              )}

              {/* Additional Info */}
              <div className="grid grid-cols-2 gap-4">
                {trfExtraction.location !== undefined && (
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Location</label>
                    <input
                      type="text"
                      value={trfExtraction.location || ''}
                      onChange={(e) => setTrfExtraction({
                        ...trfExtraction,
                        location: e.target.value
                      })}
                      className="w-full text-sm font-medium border border-gray-300 rounded px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Enter location"
                    />
                  </div>
                )}
                {trfExtraction.urgency !== undefined && (
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Urgency</label>
                    <select
                      value={trfExtraction.urgency || 'Normal'}
                      onChange={(e) => setTrfExtraction({
                        ...trfExtraction,
                        urgency: e.target.value as 'Normal' | 'Urgent' | 'STAT'
                      })}
                      className="w-full text-sm font-medium border border-gray-300 rounded px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="Normal">Normal</option>
                      <option value="Urgent">Urgent</option>
                      <option value="STAT">STAT</option>
                    </select>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-gray-200 p-4 flex items-center justify-between bg-gray-50">
              <p className="text-xs text-gray-600">
                ✓ Changes saved automatically. Click "Continue" to create patient and apply values to order form.
              </p>
              <button
                onClick={handleTRFReviewClose}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium"
              >
                Continue with Order
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
};

export default OrderForm;
