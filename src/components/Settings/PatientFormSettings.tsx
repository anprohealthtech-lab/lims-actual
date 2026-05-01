import React, { useState, useEffect } from 'react';
import { Save, Loader2, Plus, X, GripVertical, ToggleLeft, ToggleRight } from 'lucide-react';
import { database, DEFAULT_PATIENT_FORM_SETTINGS, type LabPatientFormSettings } from '../../utils/supabase';

interface Props {
  labId: string;
}

const Toggle: React.FC<{ value: boolean; onChange: (v: boolean) => void; label: string; sub?: string }> = ({
  value, onChange, label, sub,
}) => (
  <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
    <div>
      <p className="text-sm font-medium text-gray-800">{label}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${value ? 'bg-blue-600' : 'bg-gray-300'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${value ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  </div>
);

const TagEditor: React.FC<{ values: string[]; onChange: (v: string[]) => void; placeholder: string }> = ({
  values, onChange, placeholder,
}) => {
  const [input, setInput] = useState('');

  const add = () => {
    const v = input.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setInput('');
  };

  const remove = (i: number) => onChange(values.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {values.map((v, i) => (
          <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full border border-blue-200">
            {v}
            <button type="button" onClick={() => remove(i)} className="text-blue-400 hover:text-blue-700">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={placeholder}
          className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
        <button
          type="button"
          onClick={add}
          className="px-3 py-1.5 bg-blue-50 text-blue-700 text-sm rounded-md hover:bg-blue-100 border border-blue-200"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

const PatientFormSettings: React.FC<Props> = ({ labId }) => {
  const [settings, setSettings] = useState<LabPatientFormSettings>(DEFAULT_PATIENT_FORM_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    database.patientFormSettings.get().then(({ data }) => {
      if (data) setSettings(s => ({ ...s, ...data }));
      setLoading(false);
    });
  }, [labId]);

  const set = <K extends keyof LabPatientFormSettings>(key: K, value: LabPatientFormSettings[K]) =>
    setSettings(s => ({ ...s, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    const { error } = await database.patientFormSettings.upsert(settings);
    setSaving(false);
    if (!error) { setSaved(true); setTimeout(() => setSaved(false), 2500); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Patient Registration Form</h2>
          <p className="text-sm text-gray-500 mt-0.5">Choose which fields appear when registering a new patient (applies to both the Order Form quick-add and the full Patient Form).</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${saved ? 'bg-green-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'} disabled:opacity-60`}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saved ? 'Saved!' : 'Save Changes'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── Name ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-1">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Patient Name</h3>
          <Toggle
            value={settings.show_salutation}
            onChange={v => set('show_salutation', v)}
            label="Show Salutation prefix"
            sub="Mr. / Mrs. / Ms. / Dr. etc."
          />
          {settings.show_salutation && (
            <div className="pt-2 pb-1">
              <p className="text-xs font-medium text-gray-600 mb-2">Salutation options (edit / reorder)</p>
              <TagEditor
                values={settings.salutation_options}
                onChange={v => set('salutation_options', v)}
                placeholder="Add salutation e.g. Prof."
              />
            </div>
          )}
          <Toggle
            value={settings.show_middle_name}
            onChange={v => set('show_middle_name', v)}
            label="Show Middle Name field"
          />
        </div>

        {/* ── Age / DOB ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-1">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Age / Date of Birth</h3>
          <p className="text-xs text-gray-500 mb-3">Choose how patient age is collected.</p>
          <div className="space-y-2">
            {([
              ['age', 'Age only', 'Enter a number (years / months / days)'],
              ['dob', 'Date of Birth only', 'DOB picker — age is auto-calculated'],
              ['both', 'Both (DOB + Age)', 'DOB auto-fills age; age can still be edited'],
            ] as const).map(([val, label, sub]) => (
              <label key={val} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${settings.age_mode === val ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                <input
                  type="radio"
                  name="age_mode"
                  value={val}
                  checked={settings.age_mode === val}
                  onChange={() => set('age_mode', val)}
                  className="mt-0.5 accent-blue-600"
                />
                <div>
                  <p className="text-sm font-medium text-gray-800">{label}</p>
                  <p className="text-xs text-gray-500">{sub}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* ── Gender ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-1">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Gender</h3>
          <Toggle
            value={settings.show_gender}
            onChange={v => set('show_gender', v)}
            label="Show Gender field"
          />
          {settings.show_gender && (
            <div className="pt-2 pb-1">
              <p className="text-xs font-medium text-gray-600 mb-2">Gender options</p>
              <TagEditor
                values={settings.gender_options}
                onChange={v => set('gender_options', v)}
                placeholder="Add option e.g. Non-binary"
              />
            </div>
          )}
        </div>

        {/* ── Contact ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-1">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Contact Details</h3>
          <Toggle
            value={settings.phone_required}
            onChange={v => set('phone_required', v)}
            label="Phone number is required"
            sub="Phone is always shown; toggle whether it must be filled"
          />
          <Toggle
            value={settings.show_email}
            onChange={v => set('show_email', v)}
            label="Show Email field"
          />
          {settings.show_email && (
            <Toggle
              value={settings.email_required}
              onChange={v => set('email_required', v)}
              label="Email is required"
            />
          )}
        </div>

        {/* ── Address ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-1">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Address</h3>
          <p className="text-xs text-gray-500 mb-2">Address fields appear in the full Patient Form. They are not shown in the quick Order Form modal.</p>
          <Toggle value={settings.show_address} onChange={v => set('show_address', v)} label="Street Address" />
          <Toggle value={settings.show_city} onChange={v => set('show_city', v)} label="City" />
          <Toggle value={settings.show_state} onChange={v => set('show_state', v)} label="State" />
          <Toggle value={settings.show_pincode} onChange={v => set('show_pincode', v)} label="PIN Code" />
        </div>

        {/* ── Medical / Other ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-1">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Medical & Other</h3>
          <Toggle
            value={settings.show_referring_doctor}
            onChange={v => set('show_referring_doctor', v)}
            label="Referring Doctor"
          />
          <Toggle
            value={settings.show_emergency_contact}
            onChange={v => set('show_emergency_contact', v)}
            label="Emergency Contact"
          />
          <Toggle
            value={settings.show_blood_group}
            onChange={v => set('show_blood_group', v)}
            label="Blood Group"
          />
          <Toggle
            value={settings.show_allergies}
            onChange={v => set('show_allergies', v)}
            label="Known Allergies"
          />
          <Toggle
            value={settings.show_medical_history}
            onChange={v => set('show_medical_history', v)}
            label="Medical History"
          />
        </div>
      </div>

      {/* Bottom save */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${saved ? 'bg-green-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'} disabled:opacity-60`}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saved ? 'Saved!' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
};

export default PatientFormSettings;
