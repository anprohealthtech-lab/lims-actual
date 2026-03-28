import React, { useState, useEffect } from 'react';
import { X, Info, Briefcase, ChevronDown, ChevronRight } from 'lucide-react';
import { database, supabase } from '../../utils/supabase';

interface CreateInvoiceModalProps {
  orderId: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface OrderTest {
  id: string;
  test_group_id: string;
  test_name: string;
  price: number;
  is_billed: boolean;
  invoice_id?: string;
  package_id?: string; // If this test is part of a package
  isPackageEntry?: boolean; // True if this is a package line item (📦)
  isTestInPackage?: boolean; // True if this is an individual test inside a package
  outsourced_lab_id?: string | null; // If test is outsourced
}

type DiscountSource = 'manual' | 'doctor' | 'location' | 'account';
interface DiscountInfo {
  type: 'percent' | 'flat';
  value: number;
  reason: string;
  source: DiscountSource;
}

const CreateInvoiceModal: React.FC<CreateInvoiceModalProps> = ({ orderId, onClose, onSuccess }) => {
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<any>(null);
  const [tests, setTests] = useState<OrderTest[]>([]);
  const [selectedTests, setSelectedTests] = useState<string[]>([]);
  const [discounts, setDiscounts] = useState<Record<string, DiscountInfo>>({});
  const [globalDiscount] = useState<DiscountInfo | null>(null);
  const [notes, setNotes] = useState('');
  const [creating, setCreating] = useState(false);

  // NEW: Dual invoice system state
  const [invoiceType, setInvoiceType] = useState<'patient' | 'account'>('patient');
  const [billingPeriod, setBillingPeriod] = useState('');

  // Package display state - track which packages are expanded
  const [expandedPackages, setExpandedPackages] = useState<Set<string>>(new Set());

  // Extra charges (lab billing items)
  interface OrderBillingItem {
    id: string;
    name: string;
    amount: number;
    is_shareable_with_doctor: boolean;
    is_shareable_with_phlebotomist: boolean;
    is_invoiced: boolean;
    lab_billing_item_type_id: string | null;
  }
  const [orderBillingItems, setOrderBillingItems] = useState<OrderBillingItem[]>([]);
  const [selectedChargeIds, setSelectedChargeIds] = useState<string[]>([]);
  const [chargeDiscounts, setChargeDiscounts] = useState<Record<string, { type: 'percent' | 'flat'; value: number; reason: string }>>({});

  // Helpers: numeric coercion and currency formatting (null-safe)
  const toNum = (v: any, fallback = 0): number => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const money = (v: any): string => toNum(v).toFixed(2);

  useEffect(() => { loadOrderDetails(); }, [orderId]);

  useEffect(() => {
    // Auto-set invoice type based on order properties
    if (order) {
      if (order.account_id) {
        setInvoiceType('account');
        // Set default billing period to current month
        const now = new Date();
        setBillingPeriod(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
      } else {
        setInvoiceType('patient');
      }
    }
  }, [order]);

  const loadOrderDetails = async () => {
    try {
      setLoading(true);
      // Load order with relateds (ensure getById returns account_id, location_id, referring_doctor_id)
      const { data: orderData, error: orderError } = await database.orders.getById(orderId);
      if (orderError) throw orderError;
      setOrder(orderData);

      // Unbilled tests
      const { data: orderTests, error: testsError } = await (database as any).orderTests?.getUnbilledByOrder?.(orderId) ||
        // Fallback to direct query if method doesn't exist
        supabase
          .from('order_tests')
          .select('id, test_group_id, test_name, price, is_billed, invoice_id, package_id, outsourced_lab_id')
          .eq('order_id', orderId)
          .eq('is_billed', false);

      if (testsError) throw testsError;

      // Fetch location-specific prices if order has a location
      let locationPricesMap: Record<string, number> = {};
      if (orderData?.location_id) {
        const testGroupIds = (orderTests || [])
          .filter((t: any) => t.test_group_id)
          .map((t: any) => t.test_group_id);

        if (testGroupIds.length > 0) {
          const { data: locPrices } = await supabase
            .from('location_test_prices')
            .select('test_group_id, patient_price')
            .eq('location_id', orderData.location_id)
            .eq('is_active', true)
            .in('test_group_id', testGroupIds);

          if (locPrices) {
            locPrices.forEach((lp: any) => {
              if (lp.patient_price !== null && lp.patient_price !== undefined) {
                locationPricesMap[lp.test_group_id] = Number(lp.patient_price);
              }
            });
          }
        }
      }

      // Normalize tests and handle package pricing
      // Tests that belong to a package (have package_id) but are NOT the package entry
      // (have test_group_id) should have price = 0 since they're included in package price
      const normalizedTests: OrderTest[] = (orderTests || []).map((t: any) => {
        const isPackageEntry = t.test_name?.startsWith('📦') || (t.package_id && !t.test_group_id);
        const isTestInPackage = t.package_id && t.test_group_id;

        // Use location price if available, otherwise use stored price
        let effectivePrice = toNum(t.price);
        if (t.test_group_id && locationPricesMap[t.test_group_id] !== undefined) {
          effectivePrice = locationPricesMap[t.test_group_id];
        }

        return {
          ...t,
          // For tests inside a package, force price to 0 (included in package)
          // Package entry keeps its price (with location adjustment if applicable)
          price: isTestInPackage ? 0 : effectivePrice,
          isPackageEntry,
          isTestInPackage,
        };
      });

      // Only show billable items (packages and standalone tests, NOT tests inside packages)
      // Tests inside packages are shown under their parent package
      const billableTests = normalizedTests.filter(t => !t.isTestInPackage);

      setTests(normalizedTests); // Keep all for reference
      setSelectedTests(billableTests.map(t => t.id)); // Only select billable items

      // Default discounts (Account > Location > Doctor) — manual always wins when user applies
      await applyDefaultDiscounts(orderData, normalizedTests || []);

      // Load uninvoiced extra charges for this order
      const { data: charges } = await supabase
        .from('order_billing_items')
        .select('id, name, amount, is_shareable_with_doctor, is_shareable_with_phlebotomist, is_invoiced, lab_billing_item_type_id')
        .eq('order_id', orderId)
        .eq('is_invoiced', false)
        .order('created_at');
      const chargeList = charges || [];
      setOrderBillingItems(chargeList);
      setSelectedChargeIds(chargeList.map((c: OrderBillingItem) => c.id));
    } catch (error) {
      console.error('Error loading order details:', error);
    } finally {
      setLoading(false);
    }
  };

  const applyDefaultDiscounts = async (ord: any, tList: OrderTest[]) => {
    const newDiscounts: Record<string, DiscountInfo> = {};

    // Doctor %
    let doctorPct: number | undefined;
    if (ord.referring_doctor_id) {
      const { data: doctor } = await (database as any).doctors?.getById?.(ord.referring_doctor_id) || { data: null };
      if (doctor?.default_discount_percent) doctorPct = doctor.default_discount_percent;
    }

    // Location %
    let locationPct: number | undefined;
    if (ord.location_id) {
      const { data: location } = await (database as any).locations?.getById?.(ord.location_id) || { data: null };
      if (location?.default_discount_percent) locationPct = location.default_discount_percent;
    }

    // Account %
    let accountPct: number | undefined;
    if (ord.account_id) {
      const { data: account } = await (database as any).accounts?.getById?.(ord.account_id) || { data: null };
      if (account?.default_discount_percent) accountPct = account.default_discount_percent;
    }

    // Account Fixed Prices (B2B)
    const accountPricesMap = new Map<string, number>();
    if (ord.account_id) {
      const { data: prices } = await supabase
        .from('account_prices')
        .select('test_group_id, price')
        .eq('account_id', ord.account_id);

      if (prices) {
        prices.forEach((ap: any) => accountPricesMap.set(ap.test_group_id, parseFloat(ap.price)));
      }
    }

    // Choose best default per test: account price > account % > location > doctor
    tList.forEach(test => {
      // Check for fixed price override first
      if (test.test_group_id && accountPricesMap.has(test.test_group_id)) {
        const fixedPrice = accountPricesMap.get(test.test_group_id)!;
        const originalPrice = toNum(test.price);
        const discountAmount = Math.max(0, originalPrice - fixedPrice);

        if (discountAmount >= 0) {
          newDiscounts[test.id] = {
            type: 'flat',
            value: discountAmount,
            reason: `Account Fixed Price (₹${fixedPrice})`,
            source: 'account_fixed'
          };
          return; // Stop processing other discounts
        }
      }

      if (accountPct) {
        newDiscounts[test.id] = { type: 'percent', value: accountPct!, reason: 'Account default discount', source: 'account' };
      } else if (locationPct) {
        newDiscounts[test.id] = { type: 'percent', value: locationPct!, reason: 'Location default discount', source: 'location' };
      } else if (doctorPct) {
        newDiscounts[test.id] = { type: 'percent', value: doctorPct!, reason: 'Doctor default discount', source: 'doctor' };
      }
    });

    setDiscounts(newDiscounts);
  };

  const calcLineTotal = (test: OrderTest) => {
    const disc = discounts[test.id];
    let total = toNum(test.price);
    if (disc) {
      total = disc.type === 'percent' ? (total - total * toNum(disc.value) / 100) : (total - toNum(disc.value));
    }
    return Math.max(0, total);
  };

  const calcChargeLineTotal = (charge: { id: string; amount: number }) => {
    const d = chargeDiscounts[charge.id];
    if (!d) return charge.amount;
    return Math.max(0, d.type === 'percent'
      ? charge.amount - charge.amount * toNum(d.value) / 100
      : charge.amount - toNum(d.value));
  };

  const calcTotals = () => {
    const rows = tests.filter(t => selectedTests.includes(t.id));
    const testSubtotal = rows.reduce((s, t) => s + toNum(t.price), 0);
    let totalDiscount = 0;
    rows.forEach(t => {
      const d = discounts[t.id];
      if (!d) return;
      totalDiscount += d.type === 'percent' ? (toNum(t.price) * toNum(d.value) / 100) : toNum(d.value);
    });
    if (globalDiscount) {
      totalDiscount += globalDiscount.type === 'percent' ? ((testSubtotal - totalDiscount) * toNum(globalDiscount.value) / 100) : toNum(globalDiscount.value);
    }
    // Extra charges
    const selectedCharges = orderBillingItems.filter(c => selectedChargeIds.includes(c.id));
    const chargesSubtotal = selectedCharges.reduce((s, c) => s + toNum(c.amount), 0);
    selectedCharges.forEach(c => {
      const d = chargeDiscounts[c.id];
      if (!d) return;
      totalDiscount += d.type === 'percent' ? (toNum(c.amount) * toNum(d.value) / 100) : toNum(d.value);
    });
    const subtotal = testSubtotal + chargesSubtotal;
    const total = Math.max(0, subtotal - totalDiscount);
    return { subtotal, testSubtotal, chargesSubtotal, totalDiscount, total };
  };

  const handleDiscountChange = (testId: string, type: 'percent' | 'flat', value: number, reason: string) => {
    setDiscounts(prev => ({
      ...prev,
      [testId]: { type, value, reason, source: 'manual' }
    }));
  };

  const handleCreate = async () => {
    if (selectedTests.length === 0) {
      alert('Please select at least one test');
      return;
    }

    // Validation for account invoices
    if (invoiceType === 'account') {
      if (!order.account_id) {
        alert('Account invoice type requires an account to be selected on the order');
        return;
      }
      if (!billingPeriod) {
        alert('Please specify a billing period for account invoices');
        return;
      }
    }

    setCreating(true);
    try {
      const totals = calcTotals();
      const rows = tests.filter(t => selectedTests.includes(t.id));
      const lab_id = await database.getCurrentUserLabId();

      // Create invoice with dual type support
      const invoiceData = {
        lab_id,
        patient_id: order.patient_id,
        order_id: orderId,
        patient_name: order.patient_name,
        subtotal: totals.subtotal,
        total_before_discount: totals.subtotal,
        total_discount: totals.totalDiscount,
        total_after_discount: totals.total,
        discount: totals.totalDiscount,
        tax: 0,
        total: totals.total,
        status: invoiceType === 'account' ? 'Sent' : 'Unpaid', // Account invoices auto-sent for credit
        invoice_date: new Date().toISOString(),
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        payment_type: order.payment_type || 'self',
        location_id: order.location_id || null,
        referring_doctor_id: order.referring_doctor_id || null,
        account_id: order.account_id || null,

        // NEW: Dual invoice system fields
        invoice_type: invoiceType,
        billing_period: invoiceType === 'account' ? billingPeriod : null,
        consolidated_invoice_id: null, // Will be set later during monthly consolidation

        notes,
        is_partial: rows.length < tests.length,
      };

      const { data: invoice, error: invoiceError } = await database.invoices.create(invoiceData);
      if (invoiceError) throw invoiceError;

      // Items + mark billed
      // First fetch location details if we have a location
      let locationDetails: { collection_percentage?: number; receivable_type?: string } | null = null;
      if (order.location_id) {
        const { data: loc } = await (database as any).locations?.getById?.(order.location_id) || { data: null };
        if (loc) {
          locationDetails = {
            collection_percentage: loc.collection_percentage,
            receivable_type: loc.receivable_type
          };
        }
      }
      
      for (const test of rows) {
        const d = discounts[test.id];
        const lineTotal = calcLineTotal(test);

        // Get outsourced cost if applicable
        let outsourcedCost: number | null = null;
        if (test.outsourced_lab_id) {
          const { data: costData } = await database.outsourcedLabPrices.getCost(test.outsourced_lab_id, test.test_group_id);
          outsourcedCost = costData?.cost || null;
        }

        // Calculate location_receivable if location is set
        let locationReceivable: number | null = null;
        if (order.location_id && locationDetails) {
          // Check for test-specific lab_receivable in location_test_prices
          const { data: locPrice } = await supabase
            .from('location_test_prices')
            .select('lab_receivable')
            .eq('location_id', order.location_id)
            .eq('test_group_id', test.test_group_id)
            .eq('is_active', true)
            .maybeSingle();
          
          if (locPrice?.lab_receivable !== null && locPrice?.lab_receivable !== undefined) {
            // Use explicitly set test-wise price
            locationReceivable = locPrice.lab_receivable;
          } else if (locationDetails.receivable_type === 'own_center') {
            // Own center: lab gets 100%
            locationReceivable = toNum(test.price);
          } else if (locationDetails.collection_percentage) {
            // Calculate from percentage
            locationReceivable = toNum(test.price) * (locationDetails.collection_percentage / 100);
          }
        }

        await supabase.from('invoice_items').insert({
          lab_id,
          invoice_id: invoice.id,
          order_test_id: test.id,
          test_name: test.test_name,
          price: toNum(test.price),
          quantity: 1,
          total: lineTotal,
          discount_type: d?.type || null,
          discount_value: d?.value || null,
          discount_amount: toNum(test.price) - lineTotal,
          discount_reason: d?.reason || null,
          outsourced_lab_id: test.outsourced_lab_id || null,
          outsourced_cost: outsourcedCost,
          location_receivable: locationReceivable,
          order_id: orderId,
        });

        await supabase
          .from('order_tests')
          .update({
            is_billed: true,
            invoice_id: invoice.id,
            billed_at: new Date().toISOString(),
            billed_amount: lineTotal,
          })
          .eq('id', test.id);
      }

      // Extra charges → insert as lab_charge invoice_items and mark invoiced
      const selectedCharges = orderBillingItems.filter(c => selectedChargeIds.includes(c.id));
      for (const charge of selectedCharges) {
        const d = chargeDiscounts[charge.id];
        const lineTotal = calcChargeLineTotal(charge);
        const { data: chargeItem } = await supabase.from('invoice_items').insert({
          lab_id,
          invoice_id: invoice.id,
          order_billing_item_id: charge.id,
          test_name: charge.name,
          price: toNum(charge.amount),
          quantity: 1,
          total: lineTotal,
          item_type: 'lab_charge',
          discount_type: d?.type || null,
          discount_value: d?.value || null,
          discount_amount: toNum(charge.amount) - lineTotal,
          discount_reason: d?.reason || null,
          is_shareable_with_doctor: charge.is_shareable_with_doctor,
          is_shareable_with_phlebotomist: charge.is_shareable_with_phlebotomist,
          order_id: orderId,
        }).select('id').single();

        if (chargeItem?.id) {
          await supabase.from('order_billing_items')
            .update({ is_invoiced: true, invoice_item_id: chargeItem.id, updated_at: new Date().toISOString() })
            .eq('id', charge.id);
        }
      }

      // Order billing flags
      const billableTests = tests.filter(t => !t.isTestInPackage);
      const remainingUnbilled = billableTests.length - rows.length;
      const billingStatus = remainingUnbilled === 0 ? 'billed' : 'partial';
      await database.orders.update(orderId, { billing_status: billingStatus, is_billed: billingStatus === 'billed' });

      // Credit posting:
      // If the order is credit/corporate/insurance, post a credit transaction
      // Prefer Account if present; else Location.
      if (['credit', 'corporate', 'insurance'].includes(order.payment_type)) {
        const creditPayload: any = {
          lab_id,
          patient_id: order.patient_id,
          invoice_id: invoice.id,
          amount: totals.total,
          transaction_type: 'credit',
          notes: `Invoice ${invoice.id} for Order ${orderId}`,
        };
        if (order.account_id) creditPayload.account_id = order.account_id;
        else if (order.location_id) creditPayload.location_id = order.location_id;

        await (database as any).creditTransactions?.create?.(creditPayload);
      }

      onSuccess();
    } catch (error) {
      console.error('Error creating invoice:', error);
      alert('Failed to create invoice. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  const totals = calcTotals();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Create Invoice</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Order Info */}
        <div className="bg-gray-50 p-4 rounded-lg mb-6">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div><span className="text-gray-600">Order ID:</span><div className="font-medium">{order?.id.slice(0, 8)}</div></div>
            <div><span className="text-gray-600">Patient:</span><div className="font-medium">{order?.patient_name}</div></div>
            <div><span className="text-gray-600">Payment Type:</span><div className="font-medium capitalize">{order?.payment_type || 'Self'}</div></div>
            {!!order?.referring_doctor_id && <div><span className="text-gray-600">Doctor:</span><div className="font-medium">{order?.doctor}</div></div>}
            {!!order?.location_id && <div><span className="text-gray-600">Location:</span><div className="font-medium">{order?.location?.name || ''}</div></div>}
            {!!order?.account_id && <div className="col-span-3"><span className="text-gray-600">Bill-to Account:</span><div className="font-medium flex items-center gap-2"><Briefcase className="w-4 h-4" /> {order?.account?.name || '(selected)'}</div></div>}
          </div>
        </div>

        {/* NEW: Invoice Type Selector */}
        <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg mb-6">
          <h3 className="font-medium text-blue-900 mb-3">Invoice Type</h3>
          <div className="space-y-3">
            <div className="flex gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  value="patient"
                  checked={invoiceType === 'patient'}
                  onChange={(e) => setInvoiceType(e.target.value as 'patient')}
                  className="text-blue-600"
                />
                <span className="font-medium">Patient Invoice</span>
                <span className="text-sm text-gray-600">(Direct bill to patient)</span>
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  value="account"
                  checked={invoiceType === 'account'}
                  onChange={(e) => setInvoiceType(e.target.value as 'account')}
                  disabled={!order?.account_id}
                  className="text-blue-600"
                />
                <span className={`font-medium ${!order?.account_id ? 'text-gray-400' : ''}`}>
                  B2B Credit Invoice
                </span>
                <span className="text-sm text-gray-600">(Post to account ledger)</span>
              </label>
            </div>

            {invoiceType === 'account' && (
              <div className="mt-3 p-3 bg-white rounded border">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Billing Period
                </label>
                <input
                  type="month"
                  value={billingPeriod}
                  onChange={(e) => setBillingPeriod(e.target.value)}
                  className="w-40 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Credit invoices will be grouped by this period for monthly consolidation
                </p>
              </div>
            )}

            {!order?.account_id && invoiceType === 'account' && (
              <div className="text-sm text-amber-700 bg-amber-100 p-2 rounded">
                <Info className="w-4 h-4 inline mr-1" />
                Account invoice requires an account to be selected on the order
              </div>
            )}
          </div>
        </div>

        {/* Test Selection Table */}
        <div className="border rounded-lg mb-6">
          <div className="bg-gray-50 px-4 py-2 border-b">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">Unbilled Tests</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    // Select all billable items (not tests inside packages)
                    const billableIds = tests.filter(t => !t.isTestInPackage).map(t => t.id);
                    setSelectedTests(billableIds);
                  }}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  Select All
                </button>
                <span className="text-gray-300">|</span>
                <button
                  onClick={() => setSelectedTests([])}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  Clear All
                </button>
              </div>
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto">
            {/* Only show billable items (packages and standalone tests) */}
            {tests.filter(t => !t.isTestInPackage).map((test) => {
              const isSelected = selectedTests.includes(test.id);
              const isPackage = test.isPackageEntry;

              // Get tests included in this package
              const includedTests = isPackage
                ? tests.filter(t => t.package_id === test.package_id && t.isTestInPackage)
                : [];
              const isExpanded = expandedPackages.has(test.id);
              const discount = discounts[test.id];
              const lineTotal = calcLineTotal(test);

              return (
                <div key={test.id} className="border-b">
                  <div className={`p-4 ${isSelected ? 'bg-blue-50' : 'bg-white'} hover:bg-gray-50`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedTests(prev => [...prev, test.id]);
                            } else {
                              setSelectedTests(prev => prev.filter(id => id !== test.id));
                            }
                          }}
                          className="rounded"
                        />
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            {isPackage && (
                              <span className="px-1.5 py-0.5 bg-purple-100 text-purple-800 text-xs rounded">Package</span>
                            )}
                            {test.test_name.replace('📦 ', '')}
                          </div>
                          <div className="text-sm text-gray-500">Test ID: {test.id.slice(0, 8)}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        {/* Show included tests toggle for packages */}
                        {isPackage && includedTests.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedPackages(prev => {
                                const next = new Set(prev);
                                if (next.has(test.id)) {
                                  next.delete(test.id);
                                } else {
                                  next.add(test.id);
                                }
                                return next;
                              });
                            }}
                            className="flex items-center gap-1 text-sm text-purple-600 hover:text-purple-800"
                          >
                            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            {includedTests.length} tests included
                          </button>
                        )}

                        <div className="text-right">
                          <div className="font-bold text-lg">₹{money(lineTotal)}</div>
                          {discount && (
                            <div className="text-sm text-green-600">
                              -{discount.type === 'percent' ? `${discount.value}%` : `₹${discount.value}`} ({discount.source})
                            </div>
                          )}
                          {discount && <div className="text-sm text-gray-500">Original: ₹{money(test.price)}</div>}
                        </div>
                      </div>
                    </div>

                    {/* Expanded: Show included tests */}
                    {isPackage && isExpanded && includedTests.length > 0 && (
                      <div className="mt-3 ml-8 p-3 bg-purple-50 rounded-lg border border-purple-100">
                        <div className="text-xs font-medium text-purple-700 mb-2">Included in this package:</div>
                        <div className="space-y-1">
                          {includedTests.map((incTest) => (
                            <div key={incTest.id} className="flex items-center justify-between text-sm">
                              <span className="text-gray-700">• {incTest.test_name}</span>
                              <span className="text-purple-600 font-medium">Included</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Discount Controls */}
                    {isSelected && (
                      <div className="mt-3 pt-3 border-t bg-gray-50 rounded p-3">
                        <div className="grid grid-cols-4 gap-3 items-end">
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">Discount Type</label>
                            <select
                              value={discount?.type || 'percent'}
                              onChange={(e) => {
                                const type = e.target.value as 'percent' | 'flat';
                                handleDiscountChange(test.id, type, discount?.value || 0, discount?.reason || 'Manual discount');
                              }}
                              className="w-full px-2 py-1 text-sm border rounded"
                            >
                              <option value="percent">Percentage</option>
                              <option value="flat">Fixed Amount</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">Value</label>
                            <input
                              type="number"
                              min="0"
                              max={discount?.type === 'percent' ? 100 : test.price}
                              step={discount?.type === 'percent' ? 1 : 0.01}
                              value={discount?.value || 0}
                              onChange={(e) => {
                                const value = parseFloat(e.target.value) || 0;
                                handleDiscountChange(test.id, discount?.type || 'percent', value, discount?.reason || 'Manual discount');
                              }}
                              className="w-full px-2 py-1 text-sm border rounded"
                            />
                          </div>
                          <div className="col-span-2">
                            <label className="block text-xs text-gray-600 mb-1">Reason</label>
                            <input
                              type="text"
                              value={discount?.reason || 'Manual discount'}
                              onChange={(e) => {
                                handleDiscountChange(test.id, discount?.type || 'percent', discount?.value || 0, e.target.value);
                              }}
                              className="w-full px-2 py-1 text-sm border rounded"
                              placeholder="Discount reason"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Extra Charges (lab billing items) */}
        {orderBillingItems.length > 0 && (
          <div className="border rounded-lg mb-6">
            <div className="bg-amber-50 px-4 py-2 border-b border-amber-200">
              <h3 className="font-medium text-amber-800 flex items-center gap-2">
                Billing Items
                <span className="text-xs text-amber-600 font-normal">({orderBillingItems.length} pending)</span>
              </h3>
            </div>
            <div className="divide-y">
              {orderBillingItems.map(charge => {
                const isSelected = selectedChargeIds.includes(charge.id);
                const cd = chargeDiscounts[charge.id];
                const lineTotal = calcChargeLineTotal(charge);
                return (
                  <div key={charge.id} className={`p-4 ${isSelected ? 'bg-amber-50/40' : 'bg-white'} hover:bg-gray-50`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={e => setSelectedChargeIds(prev =>
                            e.target.checked ? [...prev, charge.id] : prev.filter(id => id !== charge.id)
                          )}
                          className="rounded"
                        />
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            {charge.name}
                            {charge.is_shareable_with_doctor && (
                              <span className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">Doctor</span>
                            )}
                            {charge.is_shareable_with_phlebotomist && (
                              <span className="text-xs text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">Phlebotomist</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-lg">₹{money(lineTotal)}</div>
                        {cd && <div className="text-sm text-green-600">
                          -{cd.type === 'percent' ? `${cd.value}%` : `₹${cd.value}`}
                        </div>}
                        {cd && <div className="text-sm text-gray-500">Original: ₹{money(charge.amount)}</div>}
                      </div>
                    </div>
                    {/* Discount Controls for charge */}
                    {isSelected && (
                      <div className="mt-3 pt-3 border-t bg-gray-50 rounded p-3">
                        <div className="grid grid-cols-4 gap-3 items-end">
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">Discount Type</label>
                            <select
                              value={cd?.type || 'percent'}
                              onChange={e => setChargeDiscounts(prev => ({
                                ...prev,
                                [charge.id]: { type: e.target.value as 'percent' | 'flat', value: cd?.value || 0, reason: cd?.reason || 'Discount' }
                              }))}
                              className="w-full px-2 py-1 text-sm border rounded"
                            >
                              <option value="percent">Percentage</option>
                              <option value="flat">Fixed Amount</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">Value</label>
                            <input
                              type="number"
                              min="0"
                              value={cd?.value || 0}
                              onChange={e => setChargeDiscounts(prev => ({
                                ...prev,
                                [charge.id]: { type: cd?.type || 'percent', value: parseFloat(e.target.value) || 0, reason: cd?.reason || 'Discount' }
                              }))}
                              className="w-full px-2 py-1 text-sm border rounded"
                            />
                          </div>
                          <div className="col-span-2">
                            <label className="block text-xs text-gray-600 mb-1">Reason</label>
                            <input
                              type="text"
                              value={cd?.reason || ''}
                              onChange={e => setChargeDiscounts(prev => ({
                                ...prev,
                                [charge.id]: { type: cd?.type || 'percent', value: cd?.value || 0, reason: e.target.value }
                              }))}
                              className="w-full px-2 py-1 text-sm border rounded"
                              placeholder="Discount reason"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Totals */}
        <div className="border-t pt-4">
          <div className="space-y-2 max-w-md ml-auto">
            <div className="flex justify-between text-sm">
              <span>Tests Subtotal:</span>
              <span>₹{money(totals.testSubtotal)}</span>
            </div>
            {totals.chargesSubtotal > 0 && (
              <div className="flex justify-between text-sm text-amber-700">
                <span>Billing Items:</span>
                <span>+₹{money(totals.chargesSubtotal)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-medium border-t pt-1">
              <span>Subtotal:</span>
              <span>₹{money(totals.subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm text-green-600">
              <span>Total Discount:</span>
              <span>-₹{money(totals.totalDiscount)}</span>
            </div>
            <div className="flex justify-between text-lg font-bold">
              <span>Total Amount:</span>
              <span>₹{money(totals.total)}</span>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="mt-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes (Optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Add any notes for this invoice..."
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
            disabled={creating}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            disabled={creating || selectedTests.length === 0}
          >
            {creating ? 'Creating...' : `Create ${invoiceType === 'account' ? 'B2B Credit' : 'Patient'} Invoice`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateInvoiceModal;