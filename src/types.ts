export type ModuleId =
  | 'overview'
  | 'stockEmpty'
  | 'longstay107'
  | 'longstayTransporindo'
  | 'containerInOut'
  | 'solar'
  | 'yor'
  | 'tcm'
  | 'repair';

export type StatusTone = 'green' | 'yellow' | 'red' | 'neutral';

export interface ModuleFilterState {
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
}

export interface ValidationSummary {
  requiredColumns: string[];
  missingColumns: string[];
  invalidRows: number;
  validRows: number;
  rows: Record<string, unknown>[];
  warnings: string[];
}

export interface ModuleDataState {
  fileName: string;
  rows: Record<string, unknown>[];
  mapping: Record<string, string>;
  validation: ValidationSummary | null;
  uploadedAt: string | null;
  filters: ModuleFilterState;
}

export interface KPIConfig {
  id: Exclude<ModuleId, 'overview'>;
  title: string;
  description: string;
  accent: string;
}

export interface ExportFormat {
  type: 'png' | 'jpg' | 'pdf';
}
