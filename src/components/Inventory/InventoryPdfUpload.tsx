import React, { useState, useRef } from 'react';
import { database, supabase } from '../../utils/supabase';
import {
  X,
  Upload,
  FileText,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Edit2,
  Trash2,
  Plus,
  Save,
  Sparkles,
} from 'lucide-react';

interface ParsedItem {
  name: string;
  code?: string;
  type?: string;
  quantity: number;
  unit: string;
  batch_number?: string;
  expiry_date?: string;
  unit_price?: number;
  supplier_name?: string;
  isNew?: boolean; // Will be added after checking existing items
  matchedItemId?: string;
}

interface InventoryPdfUploadProps {
  locationId?: string;
  onClose: () => void;
  onSuccess: () => void;
}

const InventoryPdfUpload: React.FC<InventoryPdfUploadProps> = ({ locationId, onClose, onSuccess }) => {
  const [step, setStep] = useState<'upload' | 'parsing' | 'review' | 'importing' | 'done'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [parsedItems, setParsedItems] = useState<ParsedItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ created: number; updated: number; errors: string[] } | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.type !== 'application/pdf') {
        setError('Please upload a PDF file');
        return;
      }
      setFile(selectedFile);
      setError(null);
    }
  };

  // Handle drag and drop
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      if (droppedFile.type !== 'application/pdf') {
        setError('Please upload a PDF file');
        return;
      }
      setFile(droppedFile);
      setError(null);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  // Parse PDF using vision-ocr and AI
  const handleParsePdf = async () => {
    if (!file) return;

    setStep('parsing');
    setError(null);

    try {
      // Step 1: Upload PDF to storage for processing
      const timestamp = Date.now();
      const filePath = `inventory-imports/${timestamp}_${file.name}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('attachments')
        .upload(filePath, file, { contentType: 'application/pdf' });

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      // Step 2: Get public URL
      const { data: urlData } = supabase.storage
        .from('attachments')
        .getPublicUrl(uploadData.path);

      // Step 3: Call vision-ocr function to extract text
      const { data: ocrResult, error: ocrError } = await supabase.functions.invoke('vision-ocr', {
        body: {
          imageUrl: urlData.publicUrl,
          extractType: 'invoice',
        },
      });

      if (ocrError) throw new Error(`OCR failed: ${ocrError.message}`);

      // Step 4: Parse the OCR text using inventory-ai-input
      const { data: aiResult, error: aiError } = await database.inventory.parseAiInput(
        ocrResult?.text || ocrResult?.fullText || JSON.stringify(ocrResult),
        'ocr'
      );

      if (aiError) throw new Error(`AI parsing failed: ${aiError.message}`);

      // Extract parsed items
      let items: ParsedItem[] = [];

      if (aiResult?.parsed?.order_items) {
        items = aiResult.parsed.order_items.map((item: any) => ({
          name: item.item_name || item.name,
          quantity: item.quantity || 1,
          unit: item.unit || 'pcs',
          batch_number: item.batch_number,
          expiry_date: item.expiry_date,
          unit_price: item.unit_price,
          supplier_name: aiResult.parsed.supplier_name,
        }));
      } else if (aiResult?.parsed?.item_name) {
        // Single item parsed
        items = [{
          name: aiResult.parsed.item_name,
          quantity: aiResult.parsed.quantity || 1,
          unit: aiResult.parsed.unit || 'pcs',
          batch_number: aiResult.parsed.batch_number,
          expiry_date: aiResult.parsed.expiry_date,
          unit_price: aiResult.parsed.unit_price,
          supplier_name: aiResult.parsed.supplier_name,
        }];
      }

      if (items.length === 0) {
        throw new Error('No items could be extracted from the PDF. Please try manual entry.');
      }

      // Step 5: Check which items are new vs existing
      const labId = await database.getCurrentUserLabId();
      const { data: existingItems } = await supabase
        .from('inventory_items')
        .select('id, name, code')
        .eq('lab_id', labId)
        .eq('is_active', true);

      const itemsWithStatus = items.map(item => {
        const match = existingItems?.find(
          existing =>
            existing.name.toLowerCase() === item.name.toLowerCase() ||
            (item.code && existing.code === item.code)
        );

        return {
          ...item,
          isNew: !match,
          matchedItemId: match?.id,
        };
      });

      setParsedItems(itemsWithStatus);
      setStep('review');
    } catch (err: any) {
      console.error('PDF parsing error:', err);
      setError(err.message || 'Failed to parse PDF');
      setStep('upload');
    }
  };

  // Handle item edit
  const handleEditItem = (index: number, field: string, value: any) => {
    setParsedItems(items =>
      items.map((item, i) =>
        i === index ? { ...item, [field]: value } : item
      )
    );
  };

  // Handle item delete
  const handleDeleteItem = (index: number) => {
    setParsedItems(items => items.filter((_, i) => i !== index));
  };

  // Handle add manual item
  const handleAddItem = () => {
    setParsedItems(items => [
      ...items,
      {
        name: '',
        quantity: 1,
        unit: 'pcs',
        isNew: true,
      },
    ]);
    setEditingIndex(parsedItems.length);
  };

  // Handle import
  const handleImport = async () => {
    if (parsedItems.length === 0) return;

    setStep('importing');
    setError(null);

    try {
      // Filter out items without names
      const validItems = parsedItems.filter(item => item.name.trim());

      const { data: result, error: importError } = await database.inventory.bulkCreateOrUpdateItems(validItems, locationId);

      if (importError) throw importError;

      setImportResult(result);
      setStep('done');
    } catch (err: any) {
      console.error('Import error:', err);
      setError(err.message || 'Failed to import items');
      setStep('review');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex-none border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Upload className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">PDF Bulk Import</h2>
              <p className="text-sm text-gray-500">Upload invoice PDF to add/update inventory</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Step: Upload */}
          {step === 'upload' && (
            <div className="space-y-6">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
                  <AlertCircle className="h-5 w-5" />
                  {error}
                </div>
              )}

              <div
                className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
                  file ? 'border-green-300 bg-green-50' : 'border-gray-300 hover:border-blue-400'
                }`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
              >
                {file ? (
                  <div className="space-y-4">
                    <CheckCircle className="h-12 w-12 mx-auto text-green-600" />
                    <div>
                      <p className="font-medium text-gray-900">{file.name}</p>
                      <p className="text-sm text-gray-500">
                        {(file.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    <button
                      onClick={() => setFile(null)}
                      className="text-sm text-gray-500 hover:text-gray-700"
                    >
                      Change file
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <FileText className="h-12 w-12 mx-auto text-gray-400" />
                    <div>
                      <p className="font-medium text-gray-900">
                        Drop your invoice PDF here
                      </p>
                      <p className="text-sm text-gray-500">
                        or click to browse
                      </p>
                    </div>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Select PDF
                    </button>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Sparkles className="h-5 w-5 text-blue-600 mt-0.5" />
                  <div>
                    <p className="font-medium text-blue-800">AI-Powered Extraction</p>
                    <p className="text-sm text-blue-600 mt-1">
                      Our AI will extract item names, quantities, batch numbers, and expiry dates
                      from your invoice. New items will be created, existing items will have stock
                      added.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step: Parsing */}
          {step === 'parsing' && (
            <div className="flex flex-col items-center justify-center py-12">
              <RefreshCw className="h-12 w-12 text-blue-600 animate-spin mb-4" />
              <p className="font-medium text-gray-900">Parsing PDF...</p>
              <p className="text-sm text-gray-500 mt-1">
                Extracting items using AI, this may take a moment
              </p>
            </div>
          )}

          {/* Step: Review */}
          {step === 'review' && (
            <div className="space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
                  <AlertCircle className="h-5 w-5" />
                  {error}
                </div>
              )}

              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  {parsedItems.length} items found.
                  <span className="text-green-600 ml-2">
                    {parsedItems.filter(i => i.isNew).length} new
                  </span>
                  <span className="text-blue-600 ml-2">
                    {parsedItems.filter(i => !i.isNew).length} existing (will update stock)
                  </span>
                </p>
                <button
                  onClick={handleAddItem}
                  className="inline-flex items-center px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Item
                </button>
              </div>

              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Item Name</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Qty</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Unit</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Batch</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Expiry</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Price</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {parsedItems.map((item, index) => (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                            item.isNew
                              ? 'bg-green-100 text-green-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}>
                            {item.isNew ? 'New' : 'Update'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {editingIndex === index ? (
                            <input
                              type="text"
                              value={item.name}
                              onChange={(e) => handleEditItem(index, 'name', e.target.value)}
                              className="w-full px-2 py-1 border border-gray-200 rounded"
                              autoFocus
                            />
                          ) : (
                            <span className="font-medium text-gray-900">{item.name}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {editingIndex === index ? (
                            <input
                              type="number"
                              value={item.quantity}
                              onChange={(e) => handleEditItem(index, 'quantity', Number(e.target.value))}
                              className="w-20 px-2 py-1 border border-gray-200 rounded text-right"
                              min="0"
                            />
                          ) : (
                            <span className="font-semibold">{item.quantity}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {editingIndex === index ? (
                            <select
                              value={item.unit}
                              onChange={(e) => handleEditItem(index, 'unit', e.target.value)}
                              className="px-2 py-1 border border-gray-200 rounded"
                            >
                              <option value="pcs">pcs</option>
                              <option value="box">box</option>
                              <option value="kit">kit</option>
                              <option value="bottle">bottle</option>
                              <option value="ml">ml</option>
                              <option value="L">L</option>
                              <option value="test">test</option>
                            </select>
                          ) : (
                            <span className="text-gray-600">{item.unit}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {editingIndex === index ? (
                            <input
                              type="text"
                              value={item.batch_number || ''}
                              onChange={(e) => handleEditItem(index, 'batch_number', e.target.value)}
                              className="w-28 px-2 py-1 border border-gray-200 rounded"
                              placeholder="Batch #"
                            />
                          ) : (
                            <span className="text-gray-600">{item.batch_number || '-'}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {editingIndex === index ? (
                            <input
                              type="date"
                              value={item.expiry_date || ''}
                              onChange={(e) => handleEditItem(index, 'expiry_date', e.target.value)}
                              className="px-2 py-1 border border-gray-200 rounded"
                            />
                          ) : (
                            <span className="text-gray-600">
                              {item.expiry_date
                                ? new Date(item.expiry_date).toLocaleDateString()
                                : '-'}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {editingIndex === index ? (
                            <input
                              type="number"
                              value={item.unit_price || ''}
                              onChange={(e) => handleEditItem(index, 'unit_price', e.target.value ? Number(e.target.value) : undefined)}
                              className="w-24 px-2 py-1 border border-gray-200 rounded text-right"
                              placeholder="0.00"
                              min="0"
                              step="0.01"
                            />
                          ) : (
                            <span className="text-gray-600">
                              {item.unit_price ? `Rs${item.unit_price.toFixed(2)}` : '-'}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-1">
                            {editingIndex === index ? (
                              <button
                                onClick={() => setEditingIndex(null)}
                                className="p-1.5 hover:bg-green-100 rounded transition-colors"
                                title="Done"
                              >
                                <CheckCircle className="h-4 w-4 text-green-600" />
                              </button>
                            ) : (
                              <button
                                onClick={() => setEditingIndex(index)}
                                className="p-1.5 hover:bg-blue-100 rounded transition-colors"
                                title="Edit"
                              >
                                <Edit2 className="h-4 w-4 text-blue-600" />
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteItem(index)}
                              className="p-1.5 hover:bg-red-100 rounded transition-colors"
                              title="Remove"
                            >
                              <Trash2 className="h-4 w-4 text-red-600" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Step: Importing */}
          {step === 'importing' && (
            <div className="flex flex-col items-center justify-center py-12">
              <RefreshCw className="h-12 w-12 text-blue-600 animate-spin mb-4" />
              <p className="font-medium text-gray-900">Importing items...</p>
              <p className="text-sm text-gray-500 mt-1">
                Creating new items and updating existing stock
              </p>
            </div>
          )}

          {/* Step: Done */}
          {step === 'done' && importResult && (
            <div className="space-y-6 text-center py-8">
              <CheckCircle className="h-16 w-16 mx-auto text-green-600" />
              <div>
                <h3 className="text-xl font-semibold text-gray-900">Import Complete!</h3>
                <p className="text-gray-500 mt-2">
                  Successfully processed {importResult.created + importResult.updated} items
                </p>
              </div>

              <div className="flex justify-center gap-8">
                <div className="text-center">
                  <p className="text-3xl font-bold text-green-600">{importResult.created}</p>
                  <p className="text-sm text-gray-500">New Items Created</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold text-blue-600">{importResult.updated}</p>
                  <p className="text-sm text-gray-500">Items Updated</p>
                </div>
              </div>

              {importResult.errors.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-left">
                  <p className="font-medium text-yellow-800 mb-2">Some items had issues:</p>
                  <ul className="text-sm text-yellow-700 space-y-1">
                    {importResult.errors.map((err, i) => (
                      <li key={i}>- {err}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-none border-t border-gray-100 px-6 py-4 flex justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            {step === 'done' ? 'Close' : 'Cancel'}
          </button>

          {step === 'upload' && file && (
            <button
              onClick={handleParsePdf}
              className="inline-flex items-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Parse PDF with AI
            </button>
          )}

          {step === 'review' && (
            <button
              onClick={handleImport}
              disabled={parsedItems.length === 0}
              className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
            >
              <Save className="h-4 w-4 mr-2" />
              Import {parsedItems.length} Items
            </button>
          )}

          {step === 'done' && (
            <button
              onClick={onSuccess}
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default InventoryPdfUpload;
