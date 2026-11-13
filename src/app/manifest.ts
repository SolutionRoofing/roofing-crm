import type { MetadataRoute } from 'next';

// Lets reps and crews "Add to Home Screen" so the app opens like a phone app, with the turtle as its icon.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Solution Roofing',
    short_name: 'Solution',
    description: 'Solution Roofing team app',
    start_url: '/',
    display: 'standalone',
    background_color: '#FFFCF5',
    theme_color: '#054123',
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
