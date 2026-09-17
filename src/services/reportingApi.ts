export interface ReportingPayload {
  fileName: string;
  rows: Record<string, unknown>[];
  mapping: Record<string, string>;
  validation: {
    requiredColumns: string[];
    missingColumns: string[];
    invalidRows: number;
    validRows: number;
    rows: Record<string, unknown>[];
    warnings: string[];
  } | null;
  uploadedAt: string;
}

const API_BASE = import.meta.env.VITE_API_URL || '/api/reporting';

export const saveReportingData = async (moduleId: string, payload: ReportingPayload) => {
  const response = await fetch(API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(import.meta.env.VITE_API_TOKEN ? { Authorization: `Bearer ${import.meta.env.VITE_API_TOKEN}` } : {}),
    },
    body: JSON.stringify({ moduleId, ...payload }),
  });

  if (!response.ok) {
    throw new Error(`API save failed: ${response.status}`);
  }

  return response.json();
};

export const fetchReportingData = async (moduleId?: string) => {
  const url = moduleId ? `${API_BASE}?moduleId=${encodeURIComponent(moduleId)}` : API_BASE;
  const response = await fetch(url, { method: 'GET' });

  if (!response.ok) {
    throw new Error(`API fetch failed: ${response.status}`);
  }

  return response.json();
};
