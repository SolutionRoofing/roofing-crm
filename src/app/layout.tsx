import type { Metadata, Viewport } from 'next';
import './globals.css';
import './app.css';

export const metadata: Metadata = {
  title: { default: 'Roofing CRM', template: '%s · Roofing CRM' },
  description: 'Leads, jobs, crews and follow-ups for the team.',
  appleWebApp: { capable: true, title: 'Roofing CRM', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: '#1f2c37',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
