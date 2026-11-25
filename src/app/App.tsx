import { AppProviders } from './AppProviders';
import { AppShell } from './AppShell';

declare global {
  interface String {
    toPersianDigits(): string;
  }
}

if (typeof String.prototype.toPersianDigits !== 'function') {
  String.prototype.toPersianDigits = function (this: string) {
    const persian = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return this.replace(/[0-9]/g, (d) => persian[parseInt(d, 10)]);
  };
}

export function App() {
  return (
    <AppProviders>
      <AppShell />
    </AppProviders>
  );
}

export default App;
