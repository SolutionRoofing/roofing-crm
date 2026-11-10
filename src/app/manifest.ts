import type { MetadataRoute } from 'next';

// Lets reps and crews "Add to Home Screen" so the CRM opens like an app on their phone.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Roofing CRM',
    short_name: 'Roofing CRM',
    start_url: '/',
    display: 'standalone',
    background_color: '#f4f2ee',
    theme_color: '#1f2c37',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
