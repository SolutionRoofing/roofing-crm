const PATHS = {
  home: 'M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  clipboard: 'M9 4h6v3H9zM7 5H5v16h14V5h-2M8 11h8M8 15h6',
  users: 'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM22 20v-2a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8',
  roof: 'M3 12 12 4l9 8M6 10v10h12V10',
  board: 'M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z',
  briefcase: 'M3 8h18v12H3zM8 8V5h8v3M3 13h18',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  check: 'M4 5h16v14H4zM8 12l3 3 5-6',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2 .3-1.4-1.4L17 5l-3-1-1 2h-2L10 4 7 5l.3 2L6 8.4 4 8 3 11l2 1v0l-2 1 1 3 2-.3 1.4 1.4L7 19l3 1 1-2h2l1 2 3-1-.3-2 1.4-1.4 2 .4 1-3z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  pin: 'M12 21s7-6.1 7-11a7 7 0 0 0-14 0c0 4.9 7 11 7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  back: 'M15 18l-6-6 6-6',
  dollar: 'M12 3v18M16.5 7.5C16 6 14.3 5 12 5c-2.8 0-4.5 1.4-4.5 3.3 0 4.4 9 2.4 9 7 0 1.9-1.8 3.4-4.5 3.4-2.4 0-4.2-1.1-4.7-2.8',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg className="ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
