import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, X, Download } from 'lucide-react';

export interface ImportedPatient {
  salutation: string;
  name: string;
  age: number;
  age_unit: 'years' | 'months' | 'days';
  gender: 'Male' | 'Female' | 'Other';
  phone: string;
  email: string;
  sample_id: string;
  corporate_employee_id: string;
}

interface ColumnMap {
  salutation: string;
  name: string;
  age: string;
  age_unit: string;
  gender: string;
  phone: string;
  email: string;
  sample_id: string;
  corporate_employee_id: string;
}

const FIELD_LABELS: Record<keyof ColumnMap, string> = {
  salutation: 'Salutation',
  name: 'Patient Name *',
  age: 'Age *',
  age_unit: 'Age Unit',
  gender: 'Gender *',
  phone: 'Phone',
  email: 'Email',
  sample_id: 'Sample ID',
  corporate_employee_id: 'Employee ID',
};

const AUTO_DETECT: Record<keyof ColumnMap, string[]> = {
  salutation: ['salutation', 'title', 'prefix', 'sal', 'mr/mrs', 'sal.'],
  name: ['name', 'patient name', 'full name', 'patient_name', 'fullname'],
  age: ['age'],
  age_unit: ['age unit', 'age_unit', 'unit'],
  gender: ['gender', 'sex'],
  phone: ['phone', 'mobile', 'contact', 'phone no', 'mobile no'],
  email: ['email', 'email id', 'email address'],
  sample_id: ['sample id', 'sample_id', 'barcode', 'sample no'],
  corporate_employee_id: ['employee id', 'emp id', 'employee_id', 'staff id', 'emp no', 'employee no'],
};

const downloadSampleExcel = () => {
  const sampleData = [
    { Salutation: 'Mr.', 'Patient Name': 'Ramesh Kumar', Age: 35, 'Age Unit': 'years', Gender: 'Male', Phone: '9876543210', Email: 'ramesh@example.com', 'Employee ID': 'EMP001', 'Sample ID': 'S001' },
    { Salutation: 'Mrs.', 'Patient Name': 'Priya Sharma', Age: 28, 'Age Unit': 'years', Gender: 'Female', Phone: '9876543211', Email: 'priya@example.com', 'Employee ID': 'EMP002', 'Sample ID': 'S002' },
    { Salutation: 'Mr.', 'Patient Name': 'Suresh Patel', Age: 45, 'Age Unit': 'years', Gender: 'Male', Phone: '9876543212', Email: '', 'Employee ID': 'EMP003', 'Sample ID': '' },
  ];
  const ws = XLSX.utils.json_to_sheet(sampleData);
  // Set column widths
  ws['!cols'] = [12, 20, 6, 12, 10, 14, 24, 12, 12].map((w) => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Patients');
  XLSX.writeFile(wb, 'bulk_registration_sample.xlsx');
};

function normalizeGender(val: string): 'Male' | 'Female' | 'Other' {
  const v = String(val).toLowerCase().trim();
  if (v === 'm' || v === 'male') return 'Male';
  if (v === 'f' || v === 'female') return 'Female';
  return 'Other';
}

interface ExcelImportPanelProps {
  onImport: (patients: ImportedPatient[]) => void;
  onClose: () => void;
}

const ExcelImportPanel: React.FC<ExcelImportPanelProps> = ({ onImport, onClose }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [columnMap, setColumnMap] = useState<ColumnMap>({
    salutation: '', name: '', age: '', age_unit: '', gender: '', phone: '',
    email: '', sample_id: '', corporate_employee_id: '',
  });
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [step, setStep] = useState<'upload' | 'map' | 'preview'>('upload');

  const handleFile = (file: File) => {
    setError('');
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' });

        if (!json.length) { setError('Sheet is empty'); return; }

        const cols = Object.keys(json[0]);
        setHeaders(cols);
        setRawRows(json);

        // Auto-detect column mapping
        const detected: ColumnMap = { salutation: '', name: '', age: '', age_unit: '', gender: '', phone: '', email: '', sample_id: '', corporate_employee_id: '' };
        for (const [field, patterns] of Object.entries(AUTO_DETECT)) {
          for (const col of cols) {
            if (patterns.includes(col.toLowerCase().trim())) {
              detected[field as keyof ColumnMap] = col;
              break;
            }
          }
        }
        setColumnMap(detected);
        setStep('map');
      } catch {
        setError('Could not parse file. Please use .xlsx, .xls, or .csv format.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleConfirmMapping = () => {
    if (!columnMap.name) { setError('Patient Name column is required'); return; }
    if (!columnMap.age) { setError('Age column is required'); return; }
    if (!columnMap.gender) { setError('Gender column is required'); return; }
    setError('');
    setStep('preview');
  };

  const parsedPatients: ImportedPatient[] = rawRows.map((row) => ({
    salutation: String(row[columnMap.salutation] || 'Mr.').trim() || 'Mr.',
    name: String(row[columnMap.name] || '').trim(),
    age: parseInt(String(row[columnMap.age] || '0'), 10) || 0,
    age_unit: (['years', 'months', 'days'].includes(String(row[columnMap.age_unit] || '').toLowerCase())
      ? String(row[columnMap.age_unit]).toLowerCase()
      : 'years') as 'years' | 'months' | 'days',
    gender: normalizeGender(String(row[columnMap.gender] || '')),
    phone: String(row[columnMap.phone] || '').trim(),
    email: String(row[columnMap.email] || '').trim(),
    sample_id: String(row[columnMap.sample_id] || '').trim(),
    corporate_employee_id: String(row[columnMap.corporate_employee_id] || '').trim(),
  })).filter((p) => p.name && p.age > 0);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-green-600" />
            <h2 className="text-lg font-semibold">Import from Excel</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 rounded-lg p-3 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Step 1: Upload */}
          {step === 'upload' && (
            <div className="space-y-3">
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
              >
                <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600 font-medium">Drop Excel / CSV file here</p>
                <p className="text-gray-400 text-sm mt-1">or click to browse</p>
                <p className="text-gray-400 text-xs mt-2">Supports .xlsx, .xls, .csv</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
                />
              </div>
              <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-green-800">Need a template?</p>
                  <p className="text-xs text-green-600 mt-0.5">Download sample file with all required columns filled</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); downloadSampleExcel(); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 whitespace-nowrap"
                >
                  <Download className="w-4 h-4" /> Download Sample
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Map Columns */}
          {step === 'map' && (
            <div>
              <p className="text-sm text-gray-500 mb-3">
                File: <span className="font-medium text-gray-700">{fileName}</span>
                {' '}({rawRows.length} rows detected)
              </p>
              <p className="text-sm font-medium text-gray-700 mb-3">Map columns from your file:</p>
              <div className="grid grid-cols-2 gap-3">
                {(Object.keys(FIELD_LABELS) as (keyof ColumnMap)[]).map((field) => (
                  <div key={field}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      {FIELD_LABELS[field]}
                    </label>
                    <select
                      value={columnMap[field]}
                      onChange={(e) => setColumnMap((prev) => ({ ...prev, [field]: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">(skip)</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Preview */}
          {step === 'preview' && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <p className="text-sm font-medium text-green-700">
                  {parsedPatients.length} patients ready to import
                </p>
              </div>
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      {['Name', 'Age', 'Gender', 'Phone', 'Emp ID', 'Sample ID'].map((h) => (
                        <th key={h} className="text-left px-3 py-2 text-gray-600 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedPatients.slice(0, 10).map((p, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-medium">{p.name}</td>
                        <td className="px-3 py-2">{p.age} {p.age_unit !== 'years' ? p.age_unit : 'y'}</td>
                        <td className="px-3 py-2">{p.gender}</td>
                        <td className="px-3 py-2">{p.phone || '-'}</td>
                        <td className="px-3 py-2">{p.corporate_employee_id || '-'}</td>
                        <td className="px-3 py-2">{p.sample_id || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsedPatients.length > 10 && (
                  <p className="text-center text-xs text-gray-500 py-2 bg-gray-50 border-t">
                    ...and {parsedPatients.length - 10} more patients
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t flex items-center justify-between gap-3">
          {step !== 'upload' && (
            <button
              onClick={() => { setStep(step === 'preview' ? 'map' : 'upload'); setError(''); }}
              className="text-sm text-gray-600 hover:text-gray-800"
            >
              ← Back
            </button>
          )}
          <div className="flex gap-2 ml-auto">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            {step === 'map' && (
              <button
                onClick={handleConfirmMapping}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Preview →
              </button>
            )}
            {step === 'preview' && (
              <button
                onClick={() => onImport(parsedPatients)}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                Import {parsedPatients.length} Patients
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExcelImportPanel;
