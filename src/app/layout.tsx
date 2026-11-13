import type { Metadata, Viewport } from 'next';
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import './globals.css';
import './app.css';

// Brand fonts (Solution Roofing brand guide): Archivo for headlines, IBM Plex Sans for
// reading, IBM Plex Mono for small all-caps labels.
const archivo = Archivo({ subsets: ['latin'], weight: ['700', '800'], variable: '--font-head', display: 'swap' });
const plexSans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-body', display: 'swap' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['500'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Solution Roofing', template: '%s · Solution Roofing' },
  description: 'Solution Roofing team app: leads, jobs, crews and follow-ups.',
  appleWebApp: { capable: true, title: 'Solution Roofing', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: '#054123',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${archivo.variable} ${plexSans.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
