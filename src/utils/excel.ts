import * as XLSX from 'xlsx';

export const FIELD_OPTIONS = [
  'Date',
  'Time',
  'Depot',
  'Container Number',
  'Container',
  'Status',
  'Container Type',
  'Type',
  'Direction',
  'Quantity',
  'Usage',
  'Capacity',
  'Occupied',
  'Mobile',
  'Desktop',
  'Repair Hours',
  'Fuel Liters',
  'Distance',
  'YOR',
  'Dwell Days',
  'Notes',
  'Other',
];

export const REQUIRED_FIELDS: Record<string, string[]> = {
  stockEmpty: ['Date', 'Depot', 'Container Number', 'Status', 'Container Type'],
  longstay107: ['Date', 'Depot', 'Container Number', 'Container Type', 'Status'],
  longstayTransporindo: ['Date', 'Depot', 'Container Number', 'Container Type', 'Status'],
  containerInOut: ['Date', 'Depot', 'Direction', 'Container Number', 'Quantity'],
  solar: ['Date', 'Depot', 'Usage', 'Distance'],
  yor: ['Date', 'Depot', 'Capacity', 'Occupied'],
  tcm: ['Date', 'Mobile', 'Desktop'],
  repair: ['Date', 'Depot', 'Container Number', 'Status', 'Repair Hours'],
};

export const parseWorkbookRows = (file: File) => {
  return new Promise<{ rows: Record<string, unknown>[]; columns: string[] }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = event.target?.result as ArrayBuffer;
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '' });
        const columns = Object.keys(rows[0] || {});
        resolve({ rows, columns });
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error('Unable to read Excel file.'));
    reader.readAsArrayBuffer(file);
  });
};

export const normalizeHeader = (value: string) => value.trim().toLowerCase();

export const buildDefaultMapping = (columns: string[], fields: string[]) => {
  const mapping: Record<string, string> = {};
  columns.forEach((column) => {
    const normalized = normalizeHeader(column);
    const match = fields.find((field) => normalizeHeader(field) === normalized);
    if (match) {
      mapping[column] = match;
    }
  });
  return mapping;
};

export const validateRows = (rows: Record<string, unknown>[], requiredFields: string[]) => {
  const missingColumns = requiredFields.filter((field) => !rows.some((row) => Object.keys(row).some((key) => normalizeHeader(key) === normalizeHeader(field))));

  const mappedRows = rows.map((row) => {
    const normalizedRow: Record<string, string> = {};
    Object.entries(row).forEach(([key, value]) => {
      normalizedRow[key] = String(value ?? '').trim();
    });
    return normalizedRow;
  });

  let validRows = 0;
  let invalidRows = 0;

  mappedRows.forEach((row) => {
    const hasRequired = requiredFields.every((field) => {
      const key = Object.keys(row).find((header) => normalizeHeader(header) === normalizeHeader(field));
      return !!key && String(row[key] ?? '').trim() !== '';
    });
    if (hasRequired) {
      validRows += 1;
    } else {
      invalidRows += 1;
    }
  });

  return {
    requiredColumns: requiredFields,
    missingColumns,
    validRows,
    invalidRows,
    rows: mappedRows,
    warnings: missingColumns.length ? [`Missing required columns: ${missingColumns.join(', ')}`] : [],
  };
};

export const toDateValue = (value: unknown) => {
  if (!value) return null;
  const str = String(value).trim();
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return null;
};

export const safeNumber = (value: unknown) => {
  if (value === null || value === undefined || value === '') return 0;
  const num = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(num) ? num : 0;
};

export const getTrendSeries = (rows: Record<string, unknown>[], dateKey: string, valueKey: string) => {
  const series = new Map<string, number>();

  rows.forEach((row) => {
    const date = toDateValue(row[dateKey]) ?? new Date();
    const key = date.toISOString().slice(0, 10);
    series.set(key, (series.get(key) ?? 0) + safeNumber(row[valueKey]));
  });

  return Array.from(series.entries()).map(([date, value]) => ({ date, value }));
};
