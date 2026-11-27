import { useEffect, useMemo, useState } from 'react';
import { loadDentalUnits } from '@/lib/clinicDefinitions';
import type { SectionId } from '@/lib/sections';
import {
  loadSelectedHomeServices,
  reorderSelectedHomeServices,
  saveSelectedHomeServices,
  subscribeHomeServicesChange,
} from '@/lib/navigationStack';
import { useAppearanceSettings } from '@/design-system/themes/appearance';
import { useViewportMetrics } from '@/platform/safeArea';
import { PlatformHapticAdapter } from '@/platform/haptics';
import { getActiveClinicUser } from '@/lib/cloudSyncEngine';
import { ACTIVE_TENANT_ID, getActiveBranchId } from '@/services/authentication/authService';
import { useClinicShell } from '@/app/AppProviders';
import { useNavigation } from '@/navigation/NavigationStack';
import { useDashboardDataSources } from './dashboard.service';
import { computeDashboardMetrics } from './dashboard.metrics';

export function useDashboard() {
  const sources = useDashboardDataSources();
  const { effectiveRole } = useClinicShell();
  const appearance = useAppearanceSettings();
  const viewport = useViewportMetrics();
  const { navigate } = useNavigation();

  const [selectedServices, setSelectedServices] = useState<SectionId[]>(() =>
    loadSelectedHomeServices()
  );
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [activeUser, setActiveUser] = useState(() => getActiveClinicUser());
  const [branchId, setBranchId] = useState(() => getActiveBranchId());

  useEffect(() => {
    const unsubHome = subscribeHomeServicesChange(setSelectedServices);
    const onUserChange = () => setActiveUser(getActiveClinicUser());
    const onBranchChange = () => setBranchId(getActiveBranchId());
    window.addEventListener('minadental-user-changed', onUserChange);
    window.addEventListener('minadental-branch-changed', onBranchChange);
    return () => {
      unsubHome();
      window.removeEventListener('minadental-user-changed', onUserChange);
      window.removeEventListener('minadental-branch-changed', onBranchChange);
    };
  }, []);

  const units = useMemo(() => loadDentalUnits(), []);

  const metrics = useMemo(
    () =>
      computeDashboardMetrics({
        patients: sources.patients,
        appointments: sources.appointments,
        treatments: sources.treatments,
        labOrders: sources.labOrders,
        implants: sources.implants,
        payments: sources.payments,
        inventory: sources.inventory,
        reminders: sources.reminders,
        finance: sources.finance,
        installments: sources.installments,
        checks: sources.checks,
        safteh: sources.safteh,
        clinicSettings: sources.clinicSettings,
        staff: sources.staff,
        units,
        branchId,
        tenantId: activeUser.tenantId || ACTIVE_TENANT_ID,
        userRole: activeUser.role,
        financialDataComplete: sources.status.financialDataComplete,
        serverSummary: sources.serverSummary,
      }),
    [
      sources.patients,
      sources.appointments,
      sources.treatments,
      sources.labOrders,
      sources.implants,
      sources.payments,
      sources.inventory,
      sources.reminders,
      sources.finance,
      sources.installments,
      sources.checks,
      sources.safteh,
      sources.clinicSettings,
      sources.staff,
      sources.serverSummary,
      sources.status.financialDataComplete,
      units,
      branchId,
      activeUser.tenantId,
      activeUser.role,
    ]
  );

  const showNextAppointmentCard =
    Boolean(metrics.nextAppt) &&
    viewport.hasNextAppointmentRoom &&
    !appearance.isLargeText &&
    !viewport.keyboardOpen;

  const handleReorderDrop = (targetIdx: number) => {
    if (draggingIndex === null || draggingIndex === targetIdx) {
      setDraggingIndex(null);
      return;
    }
    const reordered = reorderSelectedHomeServices(selectedServices, draggingIndex, targetIdx);
    const saved = saveSelectedHomeServices(reordered);
    setSelectedServices(saved);
    setDraggingIndex(null);
    PlatformHapticAdapter.selection();
  };

  const handleMoveToFirst = (idx: number) => {
    const updated = reorderSelectedHomeServices(selectedServices, idx, 0);
    setSelectedServices(saveSelectedHomeServices(updated));
    PlatformHapticAdapter.selection();
  };

  return {
    metrics,
    sources,
    status: sources.status,
    refreshAll: sources.refreshAll,
    selectedServices,
    draggingIndex,
    setDraggingIndex,
    handleReorderDrop,
    handleMoveToFirst,
    showNextAppointmentCard,
    navigate,
    userRole: effectiveRole,
  };
}
