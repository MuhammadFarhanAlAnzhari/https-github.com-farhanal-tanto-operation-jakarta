import type { KPIConfig, ModuleId } from './types';

export const MENU_ITEMS: Array<{ id: ModuleId; label: string; description: string }> = [
  { id: 'overview', label: 'Overview', description: 'All modules at a glance' },
  { id: 'stockEmpty', label: 'KPI Stock Empty', description: 'Empty container availability' },
  { id: 'longstay107', label: 'KPI Longstay 107', description: 'Depot dwell time' },
  { id: 'longstayTransporindo', label: 'KPI Longstay Transporindo', description: 'Transit dwell time' },
  { id: 'containerInOut', label: 'KPI Container IN & OUT', description: 'Operational throughput' },
  { id: 'solar', label: 'KPI Pemakaian Solar', description: 'Fuel consumption' },
  { id: 'yor', label: 'KPI YOR', description: 'Yard occupancy ratio' },
  { id: 'tcm', label: 'KPI TCM Desktop & Mobile', description: 'Device usage mix' },
  { id: 'repair', label: 'KPI Repair', description: 'Repair productivity' },
];

export const KPI_CONFIG: Record<Exclude<ModuleId, 'overview'>, KPIConfig> = {
  stockEmpty: {
    id: 'stockEmpty',
    title: 'KPI Stock Empty',
    description: 'Empty container availability monitoring',
    accent: '#2563eb',
  },
  longstay107: {
    id: 'longstay107',
    title: 'KPI Longstay 107',
    description: 'Container dwell time at Depot 107',
    accent: '#1d4ed8',
  },
  longstayTransporindo: {
    id: 'longstayTransporindo',
    title: 'KPI Longstay Transporindo',
    description: 'Container dwell time at Transporindo',
    accent: '#3b82f6',
  },
  containerInOut: {
    id: 'containerInOut',
    title: 'KPI Container IN & OUT',
    description: 'Inbound and outbound productivity',
    accent: '#0f172a',
  },
  solar: {
    id: 'solar',
    title: 'KPI Pemakaian Solar',
    description: 'Daily fuel usage and efficiency',
    accent: '#60a5fa',
  },
  yor: {
    id: 'yor',
    title: 'KPI YOR',
    description: 'Yard occupancy ratio tracking',
    accent: '#1e40af',
  },
  tcm: {
    id: 'tcm',
    title: 'KPI TCM Desktop & Mobile',
    description: 'Traffic usage by channel',
    accent: '#2563eb',
  },
  repair: {
    id: 'repair',
    title: 'KPI Repair',
    description: 'Repair productivity and backlog',
    accent: '#1d4ed8',
  },
};
