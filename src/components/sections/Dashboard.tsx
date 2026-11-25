import { DashboardPage } from '@/features/dashboard/DashboardPage';
import type { AppRouteId } from '@/lib/navigationStack';

type Props = {
  onNavigate?: (id: AppRouteId) => void;
  onOpenInstall?: () => void;
};

export function Dashboard(_props: Props) {
  return <DashboardPage />;
}
