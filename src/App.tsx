import { useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { parseWorkbookRows, REQUIRED_FIELDS, buildDefaultMapping, FIELD_OPTIONS, safeNumber, toDateValue, validateRows, getTrendSeries } from './utils/excel';
import { KPI_CONFIG, MENU_ITEMS } from './kpiDefinitions';
import { saveReportingData } from './services/reportingApi';
import type { ModuleDataState, ModuleId, ModuleFilterState, StatusTone } from './types';

const makeInitialFilter = (): ModuleFilterState => ({
  startDate: '',
  endDate: '',
  startTime: '',
  endTime: '',
});

const makeModuleState = (): ModuleDataState => ({
  fileName: '',
  rows: [],
  mapping: {},
  validation: null,
  uploadedAt: null,
  filters: makeInitialFilter(),
});

const initialModuleData: Record<Exclude<ModuleId, 'overview'>, ModuleDataState> = {
  stockEmpty: makeModuleState(),
  longstay107: makeModuleState(),
  longstayTransporindo: makeModuleState(),
  containerInOut: makeModuleState(),
  solar: makeModuleState(),
  yor: makeModuleState(),
  tcm: makeModuleState(),
  repair: makeModuleState(),
};

const getFieldValue = (row: Record<string, unknown>, mapping: Record<string, string>, field: string) => {
  const matched = Object.entries(mapping).find(([, systemField]) => systemField === field);
  const sourceColumn = matched?.[0];
  if (sourceColumn) {
    return row[sourceColumn] ?? '';
  }

  const directValue = row[field] ?? row[field.toLowerCase()] ?? row[field.replace(/\s+/g, '').toLowerCase()];
  return directValue ?? '';
};

const filterRowsForModule = (rows: Record<string, unknown>[], mapping: Record<string, string>, filters: ModuleFilterState) => {
  return rows.filter((row) => {
    const dateStr = String(getFieldValue(row, mapping, 'Date') ?? '').trim();
    if (!dateStr && !filters.startDate && !filters.endDate) return true;

    const baseDate = toDateValue(dateStr);
    if (!baseDate) return true;

    const startDate = filters.startDate ? new Date(`${filters.startDate}T00:00:00`) : null;
    const endDate = filters.endDate ? new Date(`${filters.endDate}T23:59:59`) : null;
    const startTime = filters.startTime ? filters.startTime : '00:00';
    const endTime = filters.endTime ? filters.endTime : '23:59';

    const currentTime = String(getFieldValue(row, mapping, 'Time') ?? startTime).trim() || startTime;
    const rowDateTime = new Date(`${dateStr}T${currentTime}`);

    if (startDate && rowDateTime < startDate) return false;
    if (endDate && rowDateTime > endDate) return false;

    if (filters.startTime && rowDateTime < new Date(`${dateStr}T${filters.startTime}`)) return false;
    if (filters.endTime && rowDateTime > new Date(`${dateStr}T${filters.endTime}`)) return false;

    return true;
  });
};

const formatCompactNumber = (value: number) => {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return `${value.toFixed(0)}`;
};

const statusValue = (value: number, mode: 'stock' | 'longstay' | 'yor' | 'usage' | 'repair' | 'default') => {
  if (mode === 'stock') {
    if (value >= 41) return 'green';
    if (value >= 20) return 'yellow';
    return 'red';
  }
  if (mode === 'longstay') {
    if (value <= 1) return 'green';
    if (value >= 6 && value <= 10) return 'yellow';
    return 'red';
  }
  if (mode === 'yor') {
    if (value < 65) return 'green';
    if (value <= 70) return 'yellow';
    return 'red';
  }
  if (mode === 'usage') {
    if (value >= 90) return 'green';
    if (value >= 60) return 'yellow';
    return 'red';
  }
  if (mode === 'repair') {
    if (value >= 85) return 'green';
    if (value >= 60) return 'yellow';
    return 'red';
  }
  return 'neutral';
};

const getToneClasses = (tone: StatusTone) => {
  switch (tone) {
    case 'green':
      return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'yellow':
      return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'red':
      return 'bg-rose-100 text-rose-700 border-rose-200';
    default:
      return 'bg-slate-100 text-slate-600 border-slate-200';
  }
};

const getStatusLabel = (tone: StatusTone) => {
  if (tone === 'green') return 'Good';
  if (tone === 'yellow') return 'Watch';
  if (tone === 'red') return 'Critical';
  return 'Neutral';
};

const toDateOnly = (value: string) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString().slice(0, 10);
};

const aggregateByKey = (items: Record<string, unknown>[], key: string, valueKey?: string, mapping?: Record<string, string>) => {
  const map = new Map<string, number>();
  items.forEach((item) => {
    const bucket = mapping ? String(getFieldValue(item, mapping, key) ?? 'Unknown') : String(item[key] ?? 'Unknown');
    const val = valueKey ? (mapping ? safeNumber(getFieldValue(item, mapping, valueKey)) : safeNumber(item[valueKey])) : 1;
    map.set(bucket, (map.get(bucket) ?? 0) + val);
  });
  return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
};

const getMappedTrendData = (rows: Record<string, unknown>[], mapping: Record<string, string>, dateField: string, valueField: string) => {
  const map = new Map<string, number>();
  rows.forEach((row) => {
    const dateValue = String(getFieldValue(row, mapping, dateField) || '').trim();
    if (!dateValue) return;
    const dateKey = toDateOnly(dateValue);
    const numberValue = safeNumber(getFieldValue(row, mapping, valueField));
    map.set(dateKey, (map.get(dateKey) ?? 0) + numberValue);
  });
  return Array.from(map.entries()).map(([date, value]) => ({ date, value }));
};

const buildOverviewCard = (config: any, value: number, status: StatusTone, lastUpdate: string) => ({
  id: config.id,
  title: config.title,
  value,
  status,
  lastUpdate,
  trend: status === 'green' ? 'Up' : status === 'yellow' ? 'Stable' : 'Down',
});

const exportAsImage = async (element: HTMLElement | null, format: 'png' | 'jpg' | 'pdf') => {
  if (!element) return;
  const canvas = await html2canvas(element, { backgroundColor: '#f8fafc', scale: 2 });
  const imgData = canvas.toDataURL('image/png');

  if (format === 'png' || format === 'jpg') {
    const link = document.createElement('a');
    link.href = imgData;
    link.download = `tanto-kpi-${Date.now()}.${format}`;
    link.click();
    return;
  }

  const imgWidth = canvas.width / 2;
  const imgHeight = canvas.height / 2;
  const pdf = new jsPDF('landscape', 'pt', [imgWidth, imgHeight]);
  pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
  pdf.save(`tanto-kpi-${Date.now()}.pdf`);
};

function App() {
  const [activeModule, setActiveModule] = useState<ModuleId>('overview');
  const [moduleData, setModuleData] = useState<Record<Exclude<ModuleId, 'overview'>, ModuleDataState>>(initialModuleData);
  const exportRef = useRef<HTMLDivElement | null>(null);

  const uploadFile = async (moduleId: Exclude<ModuleId, 'overview'>, file: File | null) => {
    if (!file) return;
    const workbook = await parseWorkbookRows(file);
    const requiredFields = REQUIRED_FIELDS[moduleId];
    const validation = validateRows(workbook.rows, requiredFields);
    const defaultMapping = buildDefaultMapping(workbook.columns, FIELD_OPTIONS);
    const uploadedAt = new Date().toISOString();

    setModuleData((previous) => ({
      ...previous,
      [moduleId]: {
        ...previous[moduleId],
        fileName: file.name,
        rows: workbook.rows,
        mapping: defaultMapping,
        validation,
        uploadedAt,
        filters: { ...makeInitialFilter() },
      },
    }));

    try {
      await saveReportingData(moduleId, {
        fileName: file.name,
        rows: workbook.rows,
        mapping: defaultMapping,
        validation,
        uploadedAt,
      });
    } catch (error) {
      console.warn('Reporting API unavailable. Dashboard data remains in memory only until the API is connected.', error);
    }
  };

  const updateMapping = (moduleId: Exclude<ModuleId, 'overview'>, column: string, systemField: string) => {
    setModuleData((previous) => {
      const current = previous[moduleId];
      const nextMapping = { ...current.mapping };

      const previousField = Object.keys(nextMapping).find((key) => nextMapping[key] === systemField && key !== column);
      if (previousField) delete nextMapping[previousField];

      if (!systemField) {
        delete nextMapping[column];
      } else {
        nextMapping[column] = systemField;
      }

      return {
        ...previous,
        [moduleId]: {
          ...current,
          mapping: nextMapping,
        },
      };
    });
  };

  const saveMapping = async (moduleId: Exclude<ModuleId, 'overview'>) => {
    const current = moduleData[moduleId];
    if (!current.fileName || !current.rows.length) return;

    try {
      await saveReportingData(moduleId, {
        fileName: current.fileName,
        rows: current.rows,
        mapping: current.mapping,
        validation: current.validation,
        uploadedAt: current.uploadedAt ?? new Date().toISOString(),
      });
    } catch (error) {
      console.warn('Could not persist mapping to API.', error);
    }
  };

  const currentModuleState = activeModule === 'overview' ? null : moduleData[activeModule];

  const overviewCards = useMemo(() => {
    const cards = MENU_ITEMS.filter((menu) => menu.id !== 'overview').map((menu) => {
      const state = moduleData[menu.id as Exclude<ModuleId, 'overview'>];
      if (!state.fileName || !state.rows.length) {
        return buildOverviewCard(menu, 0, 'neutral', 'No upload');
      }

      const filtered = filterRowsForModule(state.rows, state.mapping, state.filters);
      let value = 0;
      let tone: StatusTone = 'neutral';

      if (menu.id === 'stockEmpty') {
        value = filtered.length;
        tone = getToneForValue(value, 'stock');
      } else if (menu.id === 'longstay107' || menu.id === 'longstayTransporindo') {
        const dwellValues = filtered.map((row) => {
          const dwell = safeNumber(getFieldValue(row, state.mapping, 'Dwell Days')) || Math.max(1, Math.min(30, Math.round((Date.now() - new Date(String(getFieldValue(row, state.mapping, 'Date') || new Date())).getTime()) / 86400000)));
          return dwell;
        });
        value = dwellValues.length ? dwellValues.reduce((sum, next) => sum + next, 0) / dwellValues.length : 0;
        tone = getToneForValue(value, 'longstay');
      } else if (menu.id === 'containerInOut') {
        value = filtered.reduce((sum, row) => sum + (String(getFieldValue(row, state.mapping, 'Direction')).toUpperCase() === 'IN' ? safeNumber(getFieldValue(row, state.mapping, 'Quantity')) : 0), 0);
        tone = getToneForValue(value, 'usage');
      } else if (menu.id === 'solar') {
        value = filtered.reduce((sum, row) => sum + safeNumber(getFieldValue(row, state.mapping, 'Usage')), 0);
        tone = getToneForValue(value, 'usage');
      } else if (menu.id === 'yor') {
        const capacity = filtered.reduce((sum, row) => sum + safeNumber(getFieldValue(row, state.mapping, 'Capacity')), 0);
        const occupied = filtered.reduce((sum, row) => sum + safeNumber(getFieldValue(row, state.mapping, 'Occupied')), 0);
        value = capacity ? (occupied / capacity) * 100 : 0;
        tone = getToneForValue(value, 'yor');
      } else if (menu.id === 'tcm') {
        value = filtered.reduce((sum, row) => sum + safeNumber(getFieldValue(row, state.mapping, 'Mobile')), 0);
        tone = value >= 50 ? 'green' : 'yellow';
      } else if (menu.id === 'repair') {
        value = filtered.reduce((sum, row) => sum + safeNumber(getFieldValue(row, state.mapping, 'Repair Hours')), 0);
        tone = getToneForValue(value, 'repair');
      }

      return buildOverviewCard(menu, Number(value.toFixed(1)), tone, state.uploadedAt ? new Date(state.uploadedAt).toLocaleString() : 'Not uploaded');
    });

    return cards;
  }, [moduleData]);

  const renderOverview = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-blue-500 font-semibold">Operations Overview</p>
          <h2 className="mt-2 text-3xl font-bold text-slate-900">TANTO Operation Jakarta</h2>
        </div>
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700">8 KPI modules monitored</div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {overviewCards.map((card) => (
          <div key={card.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-slate-500">{card.title}</p>
                <p className="mt-3 text-3xl font-extrabold text-slate-900">{card.value}</p>
              </div>
              <span className={`rounded-full border px-2 py-1 text-xs font-bold ${getToneClasses(card.status)}`}>{getStatusLabel(card.status)}</span>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
              <span>{card.trend}</span>
              <span>{card.lastUpdate}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderUploader = (moduleId: Exclude<ModuleId, 'overview'>, state: ModuleDataState) => (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Data Source</p>
          <h3 className="mt-2 text-xl font-bold text-slate-900">Upload Excel</h3>
        </div>
        {state.fileName ? <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">{state.fileName}</span> : null}
      </div>

      <label className="mt-5 flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-blue-300 bg-blue-50 px-4 py-6 text-center text-sm font-medium text-blue-700 transition hover:border-blue-500 hover:bg-blue-100">
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            void uploadFile(moduleId, file);
          }}
        />
        Upload Excel file
      </label>
    </div>
  );

  const renderFilters = (moduleId: Exclude<ModuleId, 'overview'>, state: ModuleDataState) => {
    const updateFilter = (key: keyof ModuleFilterState, value: string) => {
      setModuleData((previous) => ({
        ...previous,
        [moduleId]: {
          ...previous[moduleId],
          filters: {
            ...previous[moduleId].filters,
            [key]: value,
          },
        },
      }));
    };

    return (
      <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-soft md:grid-cols-4">
        <label className="text-sm text-slate-600">
          <span className="mb-2 block font-medium">Start date</span>
          <input type="date" value={state.filters.startDate} onChange={(e) => updateFilter('startDate', e.target.value)} className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2 outline-none ring-0 focus:border-blue-400" />
        </label>
        <label className="text-sm text-slate-600">
          <span className="mb-2 block font-medium">End date</span>
          <input type="date" value={state.filters.endDate} onChange={(e) => updateFilter('endDate', e.target.value)} className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2 outline-none ring-0 focus:border-blue-400" />
        </label>
        <label className="text-sm text-slate-600">
          <span className="mb-2 block font-medium">Start time</span>
          <input type="time" value={state.filters.startTime} onChange={(e) => updateFilter('startTime', e.target.value)} className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2 outline-none ring-0 focus:border-blue-400" />
        </label>
        <label className="text-sm text-slate-600">
          <span className="mb-2 block font-medium">End time</span>
          <input type="time" value={state.filters.endTime} onChange={(e) => updateFilter('endTime', e.target.value)} className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2 outline-none ring-0 focus:border-blue-400" />
        </label>
      </div>
    );
  };

  const renderColumnMapping = (moduleId: Exclude<ModuleId, 'overview'>, state: ModuleDataState) => {
    const columns = Object.keys(state.rows[0] ?? {});
    if (!columns.length) return null;

    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xl font-bold text-slate-900">Excel Column Mapping</h3>
          <button type="button" onClick={() => void saveMapping(moduleId)} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">Save Mapping</button>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {REQUIRED_FIELDS[moduleId].map((systemField) => (
            <label key={systemField} className="block text-sm text-slate-600">
              <span className="mb-2 block font-medium text-slate-700">{systemField}</span>
              <select
                value={Object.entries(state.mapping).find(([, mappedField]) => mappedField === systemField)?.[0] ?? ''}
                onChange={(event) => updateMapping(moduleId, event.target.value, systemField)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 outline-none focus:border-blue-400"
              >
                <option value="">Select Excel column</option>
                {columns.map((column) => (
                  <option key={column} value={column}>{column}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>
    );
  };

  const renderValidation = (moduleId: Exclude<ModuleId, 'overview'>, state: ModuleDataState) => {
    if (!state.validation) return null;
    const { validRows, invalidRows, missingColumns, warnings } = state.validation;

    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
        <h3 className="text-xl font-bold text-slate-900">Data Validation</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-4">
          <div className="rounded-xl bg-emerald-50 p-4 text-emerald-700"><p className="text-xs uppercase tracking-[0.2em]">Valid rows</p><p className="mt-2 text-2xl font-extrabold">{validRows}</p></div>
          <div className="rounded-xl bg-rose-50 p-4 text-rose-700"><p className="text-xs uppercase tracking-[0.2em]">Invalid rows</p><p className="mt-2 text-2xl font-extrabold">{invalidRows}</p></div>
          <div className="rounded-xl bg-blue-50 p-4 text-blue-700"><p className="text-xs uppercase tracking-[0.2em]">Required fields</p><p className="mt-2 text-2xl font-extrabold">{REQUIRED_FIELDS[moduleId].length}</p></div>
          <div className="rounded-xl bg-slate-100 p-4 text-slate-700"><p className="text-xs uppercase tracking-[0.2em]">Missing columns</p><p className="mt-2 text-2xl font-extrabold">{missingColumns.length}</p></div>
        </div>
        <div className="mt-4 space-y-2 text-sm text-slate-600">
          {missingColumns.length ? <div className="rounded-lg bg-amber-50 p-3 text-amber-700">Missing columns: {missingColumns.join(', ')}</div> : <div className="rounded-lg bg-emerald-50 p-3 text-emerald-700">All required columns are present.</div>}
          {warnings.length ? warnings.map((warning) => <div key={warning} className="rounded-lg bg-slate-50 p-3">{warning}</div>) : null}
        </div>
      </div>
    );
  };

  const getToneForValue = (value: number, kind: 'stock' | 'longstay' | 'yor' | 'usage' | 'repair') => statusValue(value, kind);

  const renderMetricCard = (label: string, value: string, tone: StatusTone, subLabel?: string) => (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
        <span className={`rounded-full border px-2 py-1 text-[10px] font-bold ${getToneClasses(tone)}`}>{getStatusLabel(tone)}</span>
      </div>
      <p className="mt-4 text-3xl font-extrabold text-slate-900">{value}</p>
      {subLabel ? <p className="mt-2 text-sm text-slate-500">{subLabel}</p> : null}
    </div>
  );

  const renderDataTable = (rows: Record<string, unknown>[], headers: string[], mapping: Record<string, string> = {}) => (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm text-slate-700">
          <thead className="bg-slate-100">
            <tr>
              {headers.map((header) => (
                <th key={header} className="px-4 py-3 font-semibold text-slate-700">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 12).map((row, index) => (
              <tr key={`${index}-${String(getFieldValue(row, mapping, 'Date') ?? '')}`} className="border-t border-slate-200">
                {headers.map((header) => (
                  <td key={`${header}-${index}`} className="px-4 py-3">{String(getFieldValue(row, mapping, header) ?? '')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderStockEmpty = () => {
    const state = moduleData.stockEmpty;
    if (!state.fileName || !state.rows.length) return <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center text-slate-500">Upload Excel data to calculate empty stock KPI.</div>;

    const filteredRows = filterRowsForModule(state.rows, state.mapping, state.filters);
    const totalStock = filteredRows.length;
    const byDepot = aggregateByKey(filteredRows, 'Depot', undefined, state.mapping);
    const byType = aggregateByKey(filteredRows, 'Container Type', undefined, state.mapping);
    const trendData = getMappedTrendData(filteredRows, state.mapping, 'Date', 'Quantity');
    const tone = getToneForValue(totalStock, 'stock');

    return (
      <div className="space-y-6">
        {renderUploader('stockEmpty', state)}
        {renderFilters('stockEmpty', state)}
        {renderColumnMapping('stockEmpty', state)}
        {renderValidation('stockEmpty', state)}
        <div className="grid gap-4 md:grid-cols-3">
          {renderMetricCard('Total Stock', totalStock.toString(), tone, 'Available empty containers')}
          {renderMetricCard('Depot Coverage', byDepot.length.toString(), 'green', 'Active depots')}
          {renderMetricCard('Container Types', byType.length.toString(), 'green', 'Container mix')}
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
            <h3 className="text-lg font-bold text-slate-900">Availability Trend</h3>
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dbeafe" />
                  <XAxis dataKey="date" stroke="#64748b" />
                  <YAxis stroke="#64748b" />
                  <Tooltip />
                  <Area type="monotone" dataKey="value" stroke="#2563eb" fill="#bfdbfe" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
            <h3 className="text-lg font-bold text-slate-900">By Depot</h3>
            <div className="mt-4 space-y-4">
              {byDepot.map((item) => (
                <div key={item.name}>
                  <div className="mb-1 flex items-center justify-between text-sm text-slate-600"><span>{item.name}</span><span>{item.value}</span></div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div className="h-2 rounded-full bg-blue-500" style={{ width: `${Math.min((item.value / Math.max(totalStock, 1)) * 100, 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
          <h3 className="text-lg font-bold text-slate-900">Detailed Table</h3>
          <div className="mt-4">
            {renderDataTable(filteredRows, ['Date', 'Depot', 'Container Number', 'Status', 'Container Type'], state.mapping)}
          </div>
        </div>
      </div>
    );
  };

  const renderLongstay = (moduleId: Exclude<ModuleId, 'overview'>, title: string, legend: string) => {
    const state = moduleData[moduleId];
    if (!state.fileName || !state.rows.length) return <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center text-slate-500">Upload Excel data to calculate {title.toLowerCase()} KPI.</div>;

    const filteredRows = filterRowsForModule(state.rows, state.mapping, state.filters);
    const dwellValues = filteredRows.map((row) => {
      const fromField = safeNumber(getFieldValue(row, state.mapping, 'Dwell Days'));
      if (fromField > 0) return fromField;
      const dateValue = String(getFieldValue(row, state.mapping, 'Date') || '').trim();
      if (!dateValue) return 0;
      const diff = Date.now() - new Date(dateValue).getTime();
      return Math.max(0, Math.round(diff / 86400000));
    });
    const totalContainers = dwellValues.length;
    const averageDwell = totalContainers ? dwellValues.reduce((sum, curr) => sum + curr, 0) / totalContainers : 0;
    const longstayCount = dwellValues.filter((value) => value > 11).length;
    const aging = {
      '1 day': dwellValues.filter((value) => value <= 1).length,
      '2-5 days': dwellValues.filter((value) => value >= 2 && value <= 5).length,
      '6-10 days': dwellValues.filter((value) => value >= 6 && value <= 10).length,
      '>11 days': longstayCount,
    };
    const tone = getToneForValue(averageDwell, 'longstay');

    return (
      <div className="space-y-6">
        {renderUploader(moduleId, state)}
        {renderFilters(moduleId, state)}
        {renderColumnMapping(moduleId, state)}
        {renderValidation(moduleId, state)}
        <div className="grid gap-4 md:grid-cols-4">
          {renderMetricCard('Total Containers', totalContainers.toString(), tone, legend)}
          {renderMetricCard('Avg Dwell Time', `${averageDwell.toFixed(1)}d`, tone, 'Average days in depot')}
          {renderMetricCard('Longstay >11d', longstayCount.toString(), 'red', 'Critical aging count')}
          {renderMetricCard('Aging Buckets', `${aging['6-10 days'] + aging['>11 days']}`, 'yellow', 'Watchlist total')}
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
            <h3 className="text-lg font-bold text-slate-900">Aging Distribution</h3>
            <div className="mt-4 space-y-3">
              {Object.entries(aging).map(([label, value]) => (
                <div key={label}>
                  <div className="mb-1 flex items-center justify-between text-sm text-slate-600"><span>{label}</span><span>{value}</span></div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div className="h-2 rounded-full bg-blue-500" style={{ width: `${Math.min((value / Math.max(totalContainers, 1)) * 100, 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
            <h3 className="text-lg font-bold text-slate-900">Dwell Trend</h3>
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={filteredRows.map((row, index) => ({
                    date: String(getFieldValue(row, state.mapping, 'Date') || `Day ${index + 1}`),
                    value: safeNumber(getFieldValue(row, state.mapping, 'Dwell Days')) || Math.max(1, Math.round((Date.now() - new Date(String(getFieldValue(row, state.mapping, 'Date') || new Date())).getTime()) / 86400000)),
                  }))}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#dbeafe" />
                  <XAxis dataKey="date" stroke="#64748b" />
                  <YAxis stroke="#64748b" />
                  <Tooltip />
                  <Bar dataKey="value" fill="#2563eb" radius={[8, 8, 0, 0]} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
          <h3 className="text-lg font-bold text-slate-900">Detailed Table</h3>
          <div className="mt-4">
            {renderDataTable(filteredRows, ['Date', 'Depot', 'Container Number', 'Container Type', 'Status', 'Dwell Days'], state.mapping)}
          </div>
        </div>
      </div>
    );
  };

  const renderContainerInOut = () => {
    const state = moduleData.containerInOut;
    if (!state.fileName || !state.rows.length) return <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center text-slate-500">Upload Excel data to calculate container IN & OUT KPI.</div>;

    const filteredRows = filterRowsForModule(state.rows, state.mapping, state.filters);
    const totalIn = filteredRows.reduce((sum, row) => String(getFieldValue(row, state.mapping, 'Direction')).toUpperCase() === 'IN' ? sum + safeNumber(getFieldValue(row, state.mapping, 'Quantity')) : sum, 0);
    const totalOut = filteredRows.reduce((sum, row) => String(getFieldValue(row, state.mapping, 'Direction')).toUpperCase() === 'OUT' ? sum + safeNumber(getFieldValue(row, state.mapping, 'Quantity')) : sum, 0);
    const productivity = totalOut ? (totalIn / totalOut) * 100 : 100;
    const tone = productivity >= 90 ? 'green' : productivity >= 70 ? 'yellow' : 'red';
    const trendData = getMappedTrendData(filteredRows, state.mapping, 'Date', 'Quantity');

    return (
      <div className="space-y-6">
        {renderUploader('containerInOut', state)}
        {renderFilters('containerInOut', state)}
        {renderColumnMapping('containerInOut', state)}
        {renderValidation('containerInOut', state)}
        <div className="grid gap-4 md:grid-cols-4">
          {renderMetricCard('Total IN', formatCompactNumber(totalIn), tone, 'Inbound volume')}
          {renderMetricCard('Total OUT', formatCompactNumber(totalOut), 'yellow', 'Outbound volume')}
          {renderMetricCard('Daily IN', formatCompactNumber(totalIn / Math.max(filteredRows.length, 1)), 'green', 'Average per row')}
          {renderMetricCard('Productivity', `${productivity.toFixed(1)}%`, tone, 'IN / OUT ratio')}
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
            <h3 className="text-lg font-bold text-slate-900">Trend</h3>
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dbeafe" />
                  <XAxis dataKey="date" stroke="#64748b" />
                  <YAxis stroke="#64748b" />
                  <Tooltip />
                  <Area type="monotone" dataKey="value" fill="#bfdbfe" stroke="#2563eb" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
            <h3 className="text-lg font-bold text-slate-900">Depot Comparison</h3>
            <div className="mt-4 space-y-3">
              {aggregateByKey(filteredRows, 'Depot', 'Quantity', state.mapping).map((item) => (
                <div key={item.name}>
                  <div className="mb-1 flex items-center justify-between text-sm text-slate-600"><span>{item.name}</span><span>{item.value}</span></div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div className="h-2 rounded-full bg-blue-500" style={{ width: `${Math.min((item.value / Math.max(totalIn + totalOut, 1)) * 100, 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
          <h3 className="text-lg font-bold text-slate-900">Detailed Table</h3>
          <div className="mt-4">
            {renderDataTable(filteredRows, ['Date', 'Depot', 'Direction', 'Container Number', 'Quantity'], state.mapping)}
          </div>
        </div>
      </div>
    );
  };

  const renderSolar = () => {
    const state = moduleData.solar;
    if (!state.fileName || !state.rows.length) return <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center text-slate-500">Upload Excel data to calculate solar usage KPI.</div>;

    const filteredRows = filterRowsForModule(state.rows, state.mapping, state.filters);
    const usage = filteredRows.reduce((sum, row) => sum + safeNumber(getFieldValue(row, state.mapping, 'Usage')), 0);
    const distance = filteredRows.reduce((sum, row) => sum + safeNumber(getFieldValue(row, state.mapping, 'Distance')), 0);
    const efficiency = distance ? usage / distance : 0;
    const tone = getToneForValue(efficiency * 100, 'usage');
    const dailyUsage = getMappedTrendData(filteredRows, state.mapping, 'Date', 'Usage');

    return (
      <div className="space-y-6">
        {renderUploader('solar', state)}
        {renderFilters('solar', state)}
        {renderColumnMapping('solar', state)}
        {renderValidation('solar', state)}
        <div className="grid gap-4 md:grid-cols-4">
          {renderMetricCard('Total Usage', `${usage.toFixed(1)}L`, tone, 'Fuel consumption')}
          {renderMetricCard('Daily Usage', `${(usage / Math.max(filteredRows.length, 1)).toFixed(1)}L`, 'yellow', 'Average per record')}
          {renderMetricCard('Efficiency', `${(efficiency * 100).toFixed(1)}%`, tone, 'Usage vs distance')}
          {renderMetricCard('Distance', `${distance.toFixed(1)} km`, 'green', 'Travel distance')}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
          <h3 className="text-lg font-bold text-slate-900">Usage Trend</h3>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <Line data={dailyUsage} dataKey="value" stroke="#2563eb" strokeWidth={3} />
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
          <h3 className="text-lg font-bold text-slate-900">Detailed Table</h3>
          <div className="mt-4">
            {renderDataTable(filteredRows, ['Date', 'Depot', 'Usage', 'Distance', 'Status'], state.mapping)}
          </div>
        </div>
      </div>
    );
  };

  const renderYor = () => {
    const state = moduleData.yor;
    if (!state.fileName || !state.rows.length) return <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center text-slate-500">Upload Excel data to calculate YOR KPI.</div>;

    const filteredRows = filterRowsForModule(state.rows, state.mapping, state.filters);
    const ratios = filteredRows.map((row) => {
      const capacity = safeNumber(getFieldValue(row, state.mapping, 'Capacity'));
      const occupied = safeNumber(getFieldValue(row, state.mapping, 'Occupied'));
      return capacity ? (occupied / capacity) * 100 : 0;
    });
    const current = ratios[ratios.length - 1] ?? 0;
    const average = ratios.length ? ratios.reduce((sum, value) => sum + value, 0) / ratios.length : 0;
    const highest = ratios.length ? Math.max(...ratios) : 0;
    const tone = getToneForValue(current, 'yor');
    const byDepot = aggregateByKey(filteredRows, 'Depot', 'Capacity', state.mapping);
    const yORTrendData = filteredRows.map((row, index) => ({
      date: String(getFieldValue(row, state.mapping, 'Date') || `Day ${index + 1}`),
      value: safeNumber(getFieldValue(row, state.mapping, 'Occupied')) / Math.max(safeNumber(getFieldValue(row, state.mapping, 'Capacity')), 1) * 100,
    }));

    return (
      <div className="space-y-6">
        {renderUploader('yor', state)}
        {renderFilters('yor', state)}
        {renderColumnMapping('yor', state)}
        {renderValidation('yor', state)}
        <div className="grid gap-4 md:grid-cols-4">
          {renderMetricCard('Current YOR', `${current.toFixed(1)}%`, tone, 'Target <65%')}
          {renderMetricCard('Average YOR', `${average.toFixed(1)}%`, tone, 'Rolling average')}
          {renderMetricCard('Highest YOR', `${highest.toFixed(1)}%`, 'red', 'Peak occupancy')}
          {renderMetricCard('Target', '65%', current < 65 ? 'green' : current <= 70 ? 'yellow' : 'red', 'Benchmark')}
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
            <h3 className="text-lg font-bold text-slate-900">YOR Trend</h3>
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <Line data={yORTrendData} dataKey="value" stroke="#2563eb" strokeWidth={3} />
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
            <h3 className="text-lg font-bold text-slate-900">Depot Comparison</h3>
            <div className="mt-4 space-y-3">
              {byDepot.map((item) => (
                <div key={item.name}>
                  <div className="mb-1 flex items-center justify-between text-sm text-slate-600"><span>{item.name}</span><span>{item.value}</span></div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div className="h-2 rounded-full bg-blue-500" style={{ width: `${Math.min((item.value / Math.max(filteredRows.reduce((sum, row) => sum + safeNumber(getFieldValue(row, state.mapping, 'Capacity')), 0), 1)) * 100, 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
          <h3 className="text-lg font-bold text-slate-900">Detailed Table</h3>
          <div className="mt-4">
            {renderDataTable(filteredRows, ['Date', 'Depot', 'Capacity', 'Occupied', 'YOR'], state.mapping)}
          </div>
        </div>
      </div>
    );
  };

  const renderTcm = () => {
    const state = moduleData.tcm;
    if (!state.fileName || !state.rows.length) return <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center text-slate-500">Upload Excel data to calculate TCM usage KPI.</div>;

    const filteredRows = filterRowsForModule(state.rows, state.mapping, state.filters);
    const mobile = filteredRows.reduce((sum, row) => sum + safeNumber(getFieldValue(row, state.mapping, 'Mobile')), 0);
    const desktop = filteredRows.reduce((sum, row) => sum + safeNumber(getFieldValue(row, state.mapping, 'Desktop')), 0);
    const total = mobile + desktop;
    const mobilePct = total ? (mobile / total) * 100 : 0;
    const desktopPct = total ? (desktop / total) * 100 : 0;
    const tone = mobilePct >= 50 ? 'green' : 'yellow';

    return (
      <div className="space-y-6">
        {renderUploader('tcm', state)}
        {renderFilters('tcm', state)}
        {renderColumnMapping('tcm', state)}
        {renderValidation('tcm', state)}
        <div className="grid gap-4 md:grid-cols-4">
          {renderMetricCard('Mobile Usage', formatCompactNumber(mobile), tone, `${mobilePct.toFixed(1)}% of users`)}
          {renderMetricCard('Desktop Usage', formatCompactNumber(desktop), 'yellow', `${desktopPct.toFixed(1)}% of users`)}
          {renderMetricCard('Total Usage', formatCompactNumber(total), 'green', 'Combined traffic')}
          {renderMetricCard('Mobile Share', `${mobilePct.toFixed(1)}%`, tone, 'Primary channel mix')}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
          <h3 className="text-lg font-bold text-slate-900">Trend</h3>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={filteredRows.map((row, index) => ({ date: String(row.Date ?? `Day ${index + 1}`), mobile: safeNumber(getFieldValue(row, state.mapping, 'Mobile')), desktop: safeNumber(getFieldValue(row, state.mapping, 'Desktop')) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dbeafe" />
                <XAxis dataKey="date" stroke="#64748b" />
                <YAxis stroke="#64748b" />
                <Tooltip />
                <Legend />
                <Bar dataKey="mobile" fill="#2563eb" radius={[8, 8, 0, 0]} />
                <Line type="monotone" dataKey="desktop" stroke="#60a5fa" strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
          <h3 className="text-lg font-bold text-slate-900">Detailed Table</h3>
          <div className="mt-4">
            {renderDataTable(filteredRows, ['Date', 'Mobile', 'Desktop', 'Total'])}
          </div>
        </div>
      </div>
    );
  };

  const renderRepair = () => {
    const state = moduleData.repair;
    if (!state.fileName || !state.rows.length) return <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center text-slate-500">Upload Excel data to calculate repair KPI.</div>;

    const filteredRows = filterRowsForModule(state.rows, state.mapping, state.filters);
    const totalRepair = filteredRows.length;
    const repairHours = filteredRows.reduce((sum, row) => sum + safeNumber(getFieldValue(row, state.mapping, 'Repair Hours')), 0);
    const productivity = repairHours ? (totalRepair / repairHours) * 100 : 0;
    const tone = getToneForValue(productivity, 'repair');
    const byDepot = aggregateByKey(filteredRows, 'Depot', 'Repair Hours', state.mapping);

    return (
      <div className="space-y-6">
        {renderUploader('repair', state)}
        {renderFilters('repair', state)}
        {renderColumnMapping('repair', state)}
        {renderValidation('repair', state)}
        <div className="grid gap-4 md:grid-cols-4">
          {renderMetricCard('Total Repair', totalRepair.toString(), tone, 'Jobs processed')}
          {renderMetricCard('Productivity', `${productivity.toFixed(1)}%`, tone, 'Jobs per repair hour')}
          {renderMetricCard('Repair Hours', repairHours.toFixed(1), 'yellow', 'Total maintenance time')}
          {renderMetricCard('Depot Count', byDepot.length.toString(), 'green', 'Active depots')}
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
            <h3 className="text-lg font-bold text-slate-900">Trend</h3>
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <Bar dataKey="value" data={filteredRows.map((row, index) => ({ date: String(row.Date ?? `Day ${index + 1}`), value: safeNumber(getFieldValue(row, state.mapping, 'Repair Hours')) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dbeafe" />
                  <XAxis dataKey="date" stroke="#64748b" />
                  <YAxis stroke="#64748b" />
                  <Tooltip />
                  <Bar dataKey="value" fill="#2563eb" radius={[8, 8, 0, 0]} />
                </Bar>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
            <h3 className="text-lg font-bold text-slate-900">Depot Comparison</h3>
            <div className="mt-4 space-y-3">
              {byDepot.map((item) => (
                <div key={item.name}>
                  <div className="mb-1 flex items-center justify-between text-sm text-slate-600"><span>{item.name}</span><span>{item.value}</span></div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div className="h-2 rounded-full bg-blue-500" style={{ width: `${Math.min((item.value / Math.max(repairHours, 1)) * 100, 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
          <h3 className="text-lg font-bold text-slate-900">Detailed Repair Table</h3>
          <div className="mt-4">
            {renderDataTable(filteredRows, ['Date', 'Depot', 'Container Number', 'Status', 'Repair Hours'], state.mapping)}
          </div>
        </div>
      </div>
    );
  };

  useEffect(() => {
    const loadModuleData = async () => {
      if (activeModule === 'overview') return;

      try {
        const response = await fetch(`/api/reporting?moduleId=${encodeURIComponent(activeModule)}`);
        if (!response.ok) return;

        const data = await response.json();
        const latest = Array.isArray(data?.data) ? data.data[0] : null;
        if (!latest) return;

        setModuleData((previous) => ({
          ...previous,
          [activeModule]: {
            ...previous[activeModule],
            fileName: latest.metadata?.fileName || latest.file_name || '',
            rows: Array.isArray(latest.raw_data) ? latest.raw_data : [],
            mapping: latest.mapping || {},
            validation: latest.metadata?.validation || null,
            uploadedAt: latest.created_at || latest.uploaded_at || null,
          },
        }));
      } catch (error) {
        console.warn('Could not hydrate module data from API.', error);
      }
    };

    void loadModuleData();
  }, [activeModule]);

  const pageContent = (() => {
    switch (activeModule) {
      case 'overview':
        return renderOverview();
      case 'stockEmpty':
        return renderStockEmpty();
      case 'longstay107':
        return renderLongstay('longstay107', 'Longstay 107', 'Depot dwell time');
      case 'longstayTransporindo':
        return renderLongstay('longstayTransporindo', 'Longstay Transporindo', 'Depot dwell time');
      case 'containerInOut':
        return renderContainerInOut();
      case 'solar':
        return renderSolar();
      case 'yor':
        return renderYor();
      case 'tcm':
        return renderTcm();
      case 'repair':
        return renderRepair();
      default:
        return renderOverview();
    }
  })();

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto flex max-w-[1800px] gap-6 px-4 py-6 xl:px-8">
        <aside className="hidden w-72 shrink-0 rounded-3xl border border-slate-200 bg-white p-4 shadow-soft xl:block">
          <div className="mb-6 flex items-center gap-3 border-b border-slate-200 pb-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-lg font-black text-white">T</div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.25em] text-blue-500">TANTO</p>
              <h1 className="text-lg font-bold text-slate-900">Jakarta KPI</h1>
            </div>
          </div>

          <nav className="space-y-2">
            {MENU_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveModule(item.id)}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm font-medium transition ${activeModule === item.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30' : 'text-slate-700 hover:bg-slate-100'}`}
              >
                <span>{item.label}</span>
                <span className={`h-2.5 w-2.5 rounded-full ${activeModule === item.id ? 'bg-white' : 'bg-blue-500'}`} />
              </button>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="mb-6 rounded-3xl border border-blue-100 bg-gradient-to-r from-blue-700 via-blue-600 to-blue-500 p-6 text-white shadow-soft">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-blue-100">Operations Dashboard</p>
                <h2 className="mt-2 text-3xl font-extrabold">TANTO Operation Jakarta</h2>
              </div>
              {activeModule !== 'overview' && (
                <div className="flex gap-2">
                  {(['png', 'jpg', 'pdf'] as const).map((format) => (
                    <button
                      key={format}
                      onClick={() => exportAsImage(exportRef.current, format)}
                      className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/15"
                    >
                      Export {format.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </header>

          <div ref={exportRef} className="space-y-6">
            {pageContent}
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
