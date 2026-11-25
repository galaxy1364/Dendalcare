import { Suspense, useEffect, useState } from 'react';
import { Home, RefreshCw } from 'lucide-react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SectionStatusBanner } from '@/components/shared/SectionStatusBanner';
import { canAccessRoute } from '@/services/permissions/accessControl';
import { useNavigation } from '@/navigation/NavigationStack';
import { useClinicShell } from './AppProviders';
import { lazyWithRetry } from './lazyWithRetry';

// Lazy-loaded full-screen pages with bounded retry & version-mismatch recovery (V5 P0-04)
const DashboardPage = lazyWithRetry(
  () => import('@/features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })),
  'DashboardPage'
);
const AllServicesScreen = lazyWithRetry(
  () => import('@/components/sections/AllServicesScreen').then((m) => ({ default: m.AllServicesScreen })),
  'AllServicesScreen'
);
const CustomizeServicesPage = lazyWithRetry(
  () => import('@/features/services/CustomizeServicesPage').then((m) => ({ default: m.CustomizeServicesPage })),
  'CustomizeServicesPage'
);
const ReportsPage = lazyWithRetry(
  () => import('@/features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })),
  'ReportsPage'
);
const PatientFormPage = lazyWithRetry(
  () => import('@/features/forms/OperationalFormRoutes').then((m) => ({ default: m.PatientFormPage })),
  'PatientFormPage'
);
const AppointmentFormPage = lazyWithRetry(
  () => import('@/features/forms/OperationalFormRoutes').then((m) => ({ default: m.AppointmentFormPage })),
  'AppointmentFormPage'
);
const TreatmentFormPage = lazyWithRetry(
  () => import('@/features/forms/OperationalFormRoutes').then((m) => ({ default: m.TreatmentFormPage })),
  'TreatmentFormPage'
);
const Appointments = lazyWithRetry(
  () => import('@/components/sections/Appointments').then((m) => ({ default: m.Appointments })),
  'Appointments'
);
const Patients = lazyWithRetry(
  () => import('@/components/sections/Patients').then((m) => ({ default: m.Patients })),
  'Patients'
);
const Treatments = lazyWithRetry(
  () => import('@/components/sections/Treatments').then((m) => ({ default: m.Treatments })),
  'Treatments'
);
const Lab = lazyWithRetry(
  () => import('@/components/sections/Lab').then((m) => ({ default: m.Lab })),
  'Lab'
);
const Implants = lazyWithRetry(
  () => import('@/components/sections/Implants').then((m) => ({ default: m.Implants })),
  'Implants'
);
const Reminders = lazyWithRetry(
  () => import('@/components/sections/Reminders').then((m) => ({ default: m.Reminders })),
  'Reminders'
);
const CalendarSection = lazyWithRetry(
  () => import('@/components/sections/CalendarSection').then((m) => ({ default: m.CalendarSection })),
  'CalendarSection'
);
const Finance = lazyWithRetry(
  () => import('@/components/sections/Finance').then((m) => ({ default: m.Finance })),
  'Finance'
);
const Messages = lazyWithRetry(
  () => import('@/components/sections/Messages').then((m) => ({ default: m.Messages })),
  'Messages'
);
const Inventory = lazyWithRetry(
  () => import('@/components/sections/Inventory').then((m) => ({ default: m.Inventory })),
  'Inventory'
);
const StaffSection = lazyWithRetry(
  () => import('@/components/sections/StaffSection').then((m) => ({ default: m.StaffSection })),
  'StaffSection'
);
const SettingsSection = lazyWithRetry(
  () => import('@/components/sections/SettingsSection').then((m) => ({ default: m.SettingsSection })),
  'SettingsSection'
);

const SUSPENSE_SLOW_THRESHOLD_MS = 8000;

function RouteSkeleton({ onGoHome }: { onGoHome: () => void }) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SUSPENSE_SLOW_THRESHOLD_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      data-testid="route_loading_skeleton"
      className="py-10 flex flex-col items-center justify-center gap-3 text-center"
    >
      <div className="w-8 h-8 rounded-full border-2 border-[#087C76] border-t-transparent animate-spin" />
      <span className="text-xs font-semibold text-[#526779] dark:text-[#9FB1C1]">
        {slow ? 'بارگذاری این صفحه بیش از حد معمول طول کشید...' : 'در حال بارگذاری صفحه...'}
      </span>
      {slow && (
        <div className="flex items-center gap-2 mt-1">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-[12px] bg-[#087C76] text-white text-xs font-bold"
          >
            <RefreshCw size={13} />
            بارگذاری مجدد
          </button>
          <button
            type="button"
            onClick={onGoHome}
            className="flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-[12px] bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] text-[#14283B] dark:text-[#F1F5F9] text-xs font-bold"
          >
            <Home size={13} />
            بازگشت به خانه
          </button>
        </div>
      )}
    </div>
  );
}

export function AppRouter() {
  const { activeRoute, navigate } = useNavigation();
  const { effectiveRole, setRoadmapModalOpen, setInstallModalOpen } = useClinicShell();

  if (!canAccessRoute(effectiveRole, activeRoute)) {
    return (
      <div className="py-6 space-y-3" data-testid="route_rbac_denied">
        <SectionStatusBanner
          status="unauthorized"
          errorMessage="نقش فعلی شما مجوز دسترسی به این صفحه را ندارد. برای ادامه به صفحه اصلی بازگردید یا با حساب مجاز وارد شوید."
        />
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => navigate('dashboard')}
            className="flex items-center gap-2 px-4 py-2.5 min-h-[48px] rounded-[12px] bg-[#087C76] text-white text-xs font-bold"
          >
            <Home size={14} />
            بازگشت به داشبورد
          </button>
        </div>
      </div>
    );
  }

  const renderRoute = () => {
    switch (activeRoute) {
      case 'dashboard':
        return <DashboardPage />;
      case 'services':
        return <AllServicesScreen onNavigate={(id) => navigate(id)} />;
      case 'customize_services':
        return <CustomizeServicesPage />;
      case 'reports':
        return <ReportsPage />;
      case 'patient_form':
        return <PatientFormPage />;
      case 'appointment_form':
        return <AppointmentFormPage />;
      case 'treatment_form':
        return <TreatmentFormPage />;
      case 'appointments':
        return <Appointments />;
      case 'patients':
        return <Patients />;
      case 'treatments':
        return <Treatments />;
      case 'lab':
        return <Lab />;
      case 'implants':
        return <Implants />;
      case 'reminders':
        return <Reminders />;
      case 'calendar':
        return <CalendarSection onNavigate={(s) => navigate(s)} />;
      case 'finance':
        return <Finance />;
      case 'messages':
        return <Messages />;
      case 'inventory':
        return <Inventory />;
      case 'staff':
        return <StaffSection />;
      case 'settings':
        return (
          <SettingsSection
            onOpenRoadmapAudit={() => setRoadmapModalOpen(true)}
            onOpenInstall={() => setInstallModalOpen(true)}
          />
        );
      default:
        return <DashboardPage />;
    }
  };

  return (
    <ErrorBoundary
      resetKey={activeRoute}
      onGoHome={() => navigate('dashboard')}
    >
      <Suspense fallback={<RouteSkeleton onGoHome={() => navigate('dashboard')} />}>
        {renderRoute()}
      </Suspense>
    </ErrorBoundary>
  );
}
