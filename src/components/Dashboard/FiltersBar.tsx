import React, { useState } from "react";
import { Calendar, Filter, Search, X } from "lucide-react";
import { DashboardFilters } from "@/hooks/useDashboardData";

type Props = {
  value: DashboardFilters;
  onChange: (next: DashboardFilters) => void;
};

const FiltersBar: React.FC<Props> = ({ value, onChange }) => {
  const [showDatePicker, setShowDatePicker] = useState(false);

  const toDateString = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const today = toDateString(new Date());
  const daysAgo = (days: number) => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return toDateString(date);
  };
  const last5Days = daysAgo(4);
  const last30Days = daysAgo(29);

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 sm:p-4 flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex-1 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          value={value.q || ""}
          onChange={(e) => onChange({ ...value, q: e.target.value })}
          className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
          placeholder="Search patient / order / id…"
        />
      </div>

      <div className="flex gap-2">
        <select
          value={value.status || "all"}
          onChange={(e) => onChange({ ...value, status: e.target.value as any })}
          className="px-3 py-2 border border-gray-300 rounded-md"
        >
          {["all","pending","for_approval","approved","report_ready","delivered","overdue","balance_due"].map(s =>
            <option key={s} value={s}>{s.replace("_"," ")}</option>
          )}
        </select>

        <div className="relative">
          <button 
            onClick={() => setShowDatePicker(!showDatePicker)}
            className="px-3 py-2 border border-gray-300 rounded-md inline-flex items-center"
          >
            <Calendar className="h-4 w-4 mr-2" /> 
            {value.from ? `${value.from} to ${value.to || today}` : 'All dates'}
          </button>
          
          {showDatePicker && (
            <div className="absolute top-full mt-1 right-0 bg-white border border-gray-300 rounded-lg shadow-lg p-4 z-10 min-w-[300px]">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-medium">Select Date Range</h4>
                <button onClick={() => setShowDatePicker(false)}>
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-sm text-gray-600">From:</label>
                  <input
                    type="date"
                    value={value.from || today}
                    onChange={(e) => onChange({ ...value, from: e.target.value })}
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-600">To:</label>
                  <input
                    type="date"
                    value={value.to || today}
                    onChange={(e) => onChange({ ...value, to: e.target.value })}
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      onChange({ ...value, from: today, to: today });
                      setShowDatePicker(false);
	                    }}
	                    className="px-3 py-1 text-sm bg-blue-600 text-white rounded-md"
	                  >
	                    Today
	                  </button>
                  <button
                    onClick={() => {
                      onChange({ ...value, from: last5Days, to: today });
                      setShowDatePicker(false);
                    }}
                    className="px-3 py-1 text-sm bg-gray-600 text-white rounded-md"
                  >
                    Last 5 days
                  </button>
                  <button
                    onClick={() => {
                      onChange({ ...value, from: last30Days, to: today });
                      setShowDatePicker(false);
                    }}
                    className="px-3 py-1 text-sm bg-purple-600 text-white rounded-md"
                  >
                    Last 30 days
                  </button>
                  <button
                    onClick={() => {
                      onChange({ ...value, from: undefined, to: undefined });
                      setShowDatePicker(false);
                    }}
                    className="px-3 py-1 text-sm bg-white border border-gray-300 text-gray-700 rounded-md"
                  >
                    All dates
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <button className="px-3 py-2 border border-gray-300 rounded-md inline-flex items-center">
          <Filter className="h-4 w-4 mr-2" /> More
        </button>
      </div>
    </div>
  );
};

export default FiltersBar;
