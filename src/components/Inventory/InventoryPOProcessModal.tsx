import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileText, PackageCheck, Plus, Save, Trash2, Truck, X, XCircle } from 'lucide-react';
import { database, InventoryOrder, InventoryOrderItem } from '../../utils/supabase';

interface InventoryPOProcessModalProps {
  po: InventoryOrder;
  locationId?: string;
  onClose: () => void;
  onUpdated: () => void;
}

const statusBadgeClass = (status: InventoryOrder['status']) => {
  switch (status) {
    case 'requested': return 'bg-blue-100 text-blue-700';
    case 'approved': return 'bg-indigo-100 text-indigo-700';
    case 'ordered': return 'bg-violet-100 text-violet-700';
    case 'received': return 'bg-green-100 text-green-700';
    case 'cancelled': return 'bg-red-100 text-red-700';
    default: return 'bg-gray-100 text-gray-700';
  }
};

const InventoryPOProcessModal: React.FC<InventoryPOProcessModalProps> = ({ po, locationId, onClose, onUpdated }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [supplierName, setSupplierName] = useState(po.supplier_name || '');
  const [taxAmount, setTaxAmount] = useState<number>(Number(po.tax_amount || 0));
  const [notes, setNotes] = useState(po.notes || '');
  const [invoiceNumber, setInvoiceNumber] = useState(po.invoice_number || '');
  const [invoiceDate, setInvoiceDate] = useState(po.invoice_date || new Date().toISOString().split('T')[0]);
  const [draftItems, setDraftItems] = useState<InventoryOrderItem[]>(
    Array.isArray(po.items) ? po.items : []
  );

  const items = useMemo(() => draftItems, [draftItems]);
  const canEditLineItems = po.status !== 'received' && po.status !== 'cancelled';
  const subtotal = useMemo(
    () => items
      .filter(line => line.name?.trim() && Number(line.quantity || 0) > 0)
      .reduce((sum, line) => sum + (Number(line.quantity || 0) * Number(line.unit_price || 0)), 0),
    [items]
  );
  const total = subtotal + Number(taxAmount || 0);
  const originalSignature = useMemo(() => JSON.stringify({
    supplier_name: po.supplier_name || '',
    tax_amount: Number(po.tax_amount || 0),
    notes: po.notes || '',
    items: Array.isArray(po.items) ? po.items : [],
  }), [po]);
  const currentSignature = useMemo(() => JSON.stringify({
    supplier_name: supplierName || '',
    tax_amount: Number(taxAmount || 0),
    notes: notes || '',
    items: draftItems,
  }), [supplierName, taxAmount, notes, draftItems]);
  const hasUnsavedChanges = canEditLineItems && originalSignature !== currentSignature;

  useEffect(() => {
    setSupplierName(po.supplier_name || '');
    setTaxAmount(Number(po.tax_amount || 0));
    setNotes(po.notes || '');
    setInvoiceNumber(po.invoice_number || '');
    setInvoiceDate(po.invoice_date || new Date().toISOString().split('T')[0]);
    setDraftItems(Array.isArray(po.items) ? po.items : []);
  }, [po]);

  const updateLine = (index: number, patch: Partial<InventoryOrderItem>) => {
    setDraftItems(prev => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const addLine = () => {
    setDraftItems(prev => [
      ...prev,
      {
        name: '',
        quantity: 1,
        unit: 'pcs',
        unit_price: 0,
      },
    ]);
  };

  const removeLine = (index: number) => {
    setDraftItems(prev => prev.filter((_, i) => i !== index));
  };

  const saveOrderChanges = async () => {
    setSaving(true);
    setError(null);
    try {
      const { error: updateError } = await database.inventory.updatePurchaseOrder(po.id, {
        supplier_name: supplierName.trim() || undefined,
        items: draftItems,
        tax_amount: Number(taxAmount || 0),
        notes: notes.trim() || undefined,
      });
      if (updateError) throw updateError;
      onUpdated();
    } catch (err: any) {
      setError(err.message || 'Failed to save PO changes');
    } finally {
      setSaving(false);
    }
  };

  const doStatusUpdate = async (status: InventoryOrder['status']) => {
    if (hasUnsavedChanges) {
      setError('Save line-item changes before updating PO status');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { error: updateError } = await database.inventory.updatePurchaseOrderStatus(po.id, status);
      if (updateError) throw updateError;
      onUpdated();
    } catch (err: any) {
      setError(err.message || 'Failed to update PO status');
    } finally {
      setLoading(false);
    }
  };

  const doReceive = async () => {
    if (hasUnsavedChanges) {
      setError('Save line-item changes before receiving this PO');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { error: receiveError } = await database.inventory.receivePurchaseOrder({
        order: po,
        invoiceNumber: invoiceNumber || undefined,
        invoiceDate: invoiceDate || undefined,
        locationId,
      });
      if (receiveError) throw receiveError;
      onUpdated();
    } catch (err: any) {
      setError(err.message || 'Failed to receive PO');
    } finally {
      setLoading(false);
    }
  };

  const renderActions = () => {
    if (po.status === 'requested') {
      return (
        <div className="flex gap-2">
          <button disabled={loading} onClick={() => doStatusUpdate('approved')} className="px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" /> Approve
          </button>
          <button disabled={loading} onClick={() => doStatusUpdate('cancelled')} className="px-3 py-2 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50 inline-flex items-center gap-2">
            <XCircle className="h-4 w-4" /> Cancel
          </button>
        </div>
      );
    }

    if (po.status === 'approved') {
      return (
        <div className="flex gap-2">
          <button disabled={loading} onClick={() => doStatusUpdate('ordered')} className="px-3 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 inline-flex items-center gap-2">
            <Truck className="h-4 w-4" /> Mark Ordered
          </button>
          <button disabled={loading} onClick={() => doStatusUpdate('cancelled')} className="px-3 py-2 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50 inline-flex items-center gap-2">
            <XCircle className="h-4 w-4" /> Cancel
          </button>
        </div>
      );
    }

    if (po.status === 'ordered') {
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Invoice Number</label>
              <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Invoice Date</label>
              <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg" />
            </div>
          </div>
          <div className="flex gap-2">
            <button disabled={loading} onClick={doReceive} className="px-3 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 inline-flex items-center gap-2">
              <PackageCheck className="h-4 w-4" /> Receive + Stock In
            </button>
            <button disabled={loading} onClick={() => doStatusUpdate('cancelled')} className="px-3 py-2 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50 inline-flex items-center gap-2">
              <XCircle className="h-4 w-4" /> Cancel
            </button>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">PO Details</h2>
            <p className="text-sm text-gray-500">View and process purchase order</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4">
          {error && (
            <div className="px-4 py-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm">{error}</div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <p className="text-xs text-gray-500">PO Number</p>
              <p className="font-semibold text-gray-900">{po.order_number || '-'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Supplier</p>
              {canEditLineItems ? (
                <input
                  type="text"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  className="w-full mt-1 px-2 py-1 border border-gray-200 rounded text-sm"
                  placeholder="Optional"
                />
              ) : (
                <p className="font-semibold text-gray-900">{po.supplier_name || '-'}</p>
              )}
            </div>
            <div>
              <p className="text-xs text-gray-500">Status</p>
              <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium capitalize ${statusBadgeClass(po.status)}`}>
                {po.status}
              </span>
            </div>
            <div>
              <p className="text-xs text-gray-500">Total</p>
              <p className="font-semibold text-gray-900">
                {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(total || 0))}
              </p>
            </div>
          </div>

          {canEditLineItems && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Tax Amount</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={taxAmount}
                  onChange={(e) => setTaxAmount(Number(e.target.value || 0))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Notes</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                  placeholder="Optional"
                />
              </div>
            </div>
          )}

          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 text-sm font-medium text-gray-700 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2">
                <FileText className="h-4 w-4" /> Line Items
              </span>
              {canEditLineItems && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={addLine}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-gray-200 rounded hover:bg-white"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Line
                  </button>
                  <button
                    type="button"
                    disabled={!hasUnsavedChanges || saving}
                    onClick={saveOrderChanges}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 text-white rounded disabled:opacity-50 hover:bg-blue-700"
                  >
                    <Save className="h-3.5 w-3.5" />
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              )}
            </div>
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Item</th>
                  <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Qty</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Unit</th>
                  <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Rate</th>
                  <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Total</th>
                  {canEditLineItems && (
                    <th className="text-center px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Action</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.length === 0 ? (
                  <tr><td colSpan={canEditLineItems ? 6 : 5} className="px-4 py-6 text-center text-sm text-gray-500">No line items</td></tr>
                ) : items.map((line, idx) => (
                  <tr key={idx}>
                    <td className="px-4 py-2 text-sm text-gray-800">
                      {canEditLineItems ? (
                        <input
                          type="text"
                          value={line.name}
                          onChange={(e) => updateLine(idx, { name: e.target.value })}
                          className="w-full px-2 py-1 border border-gray-200 rounded"
                        />
                      ) : line.name}
                    </td>
                    <td className="px-4 py-2 text-sm text-right text-gray-800">
                      {canEditLineItems ? (
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={Number(line.quantity || 0)}
                          onChange={(e) => updateLine(idx, { quantity: Number(e.target.value || 0) })}
                          className="w-24 ml-auto block px-2 py-1 border border-gray-200 rounded text-right"
                        />
                      ) : Number(line.quantity || 0)}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-800">
                      {canEditLineItems ? (
                        <input
                          type="text"
                          value={line.unit || 'pcs'}
                          onChange={(e) => updateLine(idx, { unit: e.target.value })}
                          className="w-24 px-2 py-1 border border-gray-200 rounded"
                        />
                      ) : (line.unit || 'pcs')}
                    </td>
                    <td className="px-4 py-2 text-sm text-right text-gray-800">
                      {canEditLineItems ? (
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={Number(line.unit_price || 0)}
                          onChange={(e) => updateLine(idx, { unit_price: Number(e.target.value || 0) })}
                          className="w-28 ml-auto block px-2 py-1 border border-gray-200 rounded text-right"
                        />
                      ) : Number(line.unit_price || 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-2 text-sm text-right font-medium text-gray-900">{(Number(line.quantity || 0) * Number(line.unit_price || 0)).toFixed(2)}</td>
                    {canEditLineItems && (
                      <td className="px-4 py-2 text-center">
                        <button type="button" onClick={() => removeLine(idx)} className="p-1 hover:bg-red-50 rounded">
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {renderActions()}
        </div>
      </div>
    </div>
  );
};

export default InventoryPOProcessModal;
