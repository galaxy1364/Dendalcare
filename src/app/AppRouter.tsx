import { lazy, Suspense } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SectionStatusBanner } from '@/components/shared/SectionStatusBanner';
import { FullScreenRoute } from '@/navigation/FullScreenRoute';
import { useNavigation } from '@/navigation/NavigationStack';
import { canAccessRoute } from '@/services/permissions/accessControl';
import { useClinicShell } from './AppProviders';

const DashboardPage = lazy(() =>
  import('@/features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage }))
);
const AllServicesScreen = lazy(() =>
  import('@/components/sections/AllServicesScreen').then((m) => ({ default: m.AllServicesScreen }))
);
const Patients = lazy(() =>
  import('@/components/sections/Patients').then((m) => ({ default: m.Patients }))
);
const Appointments = lazy(() =>
  import('@/components/sections/Appointments').then((m) => ({ default: m.Appointments }))
);
const CalendarSection = lazy(() =>
  import('@/components/sections/CalendarSection').then((m) => ({ default: m.CalendarSection }))
);
const Treatments = lazy(() =>
  import('@/components/sections/Treatments').then((m) => ({ default: m.Treatments }))
);
const Lab = lazy(() => import('@/components/sections/Lab').then((m) => ({ default: m.Lab })));
const Implants = lazy(() =>
  import('@/components/sections/Implants').then((m) => ({ default: m.Implants }))
);
const Finance = lazy(() =>
  import('@/components/sections/Finance').then((m) => ({ default: m.Finance }))
);
const Inventory = lazy(() =>
  import('@/components/sections/Inventory').then((m) => ({ default: m.Inventory }))
);
const Reminders = lazy(() =>
  import('@/components/sections/Reminders').then((m) => ({ default: m.Reminders }))
);
const StaffSection = lazy(() =>
  import('@/components/sections/StaffSection').then((m) => ({ default: m.StaffSection }))
);
const Messages = lazy(() =>
  import('@/components/sections/Messages').then((m) => ({ default: m.Messages }))
);
const SettingsSection = lazy(() =>
  import('@/components/sections/SettingsSection').then((m) => ({ default: m.SettingsSection }))
);
const ReportsPage = lazy(() =>
  import('@/features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage }))
);
const PatientFormPage = lazy(() =>
  import('@/features/forms/OperationalFormRoutes').then((m) => ({ default: m.PatientFormPage }))
);
const AppointmentFormPage = lazy(() =>
  import('@/features/forms/OperationalFormRoutes').then((m) => ({ default: m.AppointmentFormPage }))
);
const TreatmentFormPage = lazy(() =>
  import('@/features/forms/OperationalFormRoutes').then((m) => ({ default: m.TreatmentFormPage }))
);

function RouteSkeleton() {
  return (
    <div className="space-y-3 py-2" aria-busy="true" aria-label="در حال بارگذاری بخش">
      <div className="h-14 rounded-[20px] skeleton" />
      <div className="grid grid-cols-2 gap-2.5">
        <div className="h-24 rounded-[20px] skeleton" />
        <div className="h-24 rounded-[20px] skeleton" />
      </div>
      <div className="h-36 rounded-[20px] skeleton" />
    </div>
  );
}

export function AppRouter() {
  const { activeRoute, navigate } = useNavigation();
  const { effectiveRole, triggerInstall, triggerQuickAction, setRoadmapModalOpen } = useClinicShell();

  if (!canAccessRoute(effectiveRole, activeRoute)) {
    return (
      <FullScreenRoute routeId={activeRoute}>
        <div className="space-y-3 py-4">
          <SectionStatusBanner status="unauthorized" />
          <button
            type="button"
            onClick={() => navigate('dashboard')}
            className="min-h-[44px] px-4 py-2 rounded-[12px] bg-[#087C76] text-white text-xs font-bold"
          >
            بازگشت به داشبورد
          </button>
        </div>
      </FullScreenRoute>
    );
  }

  const renderRoute = () => {
    switch (activeRoute) {
      case 'dashboard':
        return <DashboardPage />;
      case 'services':
        return <AllServicesScreen onNavigate={(id) => navigate(id)} onQuickAction={triggerQuickAction} />;
      case 'reports':
        return <ReportsPage />;
      case 'patients':
        return <Patients />;
      case 'patient_form':
        return <PatientFormPage />;
      case 'appointments':
        return <Appointments />;
      case 'appointment_form':
        return <AppointmentFormPage />;
      case 'calendar':
        return <CalendarSection onNavigate={(id) => navigate(id)} />;
      case 'treatments':
        return <Treatments />;
      case 'treatment_form':
        return <TreatmentFormPage />;
      case 'lab':
        return <Lab />;
      case 'implants':
        return <Implants />;
      case 'finance':
        return <Finance />;
      case 'inventory':
        return <Inventory />;
      case 'reminders':
        return <Reminders />;
      case 'staff':
        return <StaffSection />;
      case 'messages':
        return <Messages />;
      case 'settings':
        return (
          <SettingsSection
            onOpenRoadmapAudit={() => setRoadmapModalOpen(true)}
            onOpenInstall={() => void triggerInstall()}
          />
        );
      default:
        return <DashboardPage />;
    }
  };

  return (
    <ErrorBoundary>
      <Suspense fallback={<RouteSkeleton />}>
        <FullScreenRoute routeId={activeRoute}>{renderRoute()}</FullScreenRoute>
      </Suspense>
    </ErrorBoundary>
  );
}
