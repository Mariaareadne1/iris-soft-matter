const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const IconSliders = () => (
  <svg {...base}><path d="M3 4h6M12 4h1M3 12h1M7 12h6" /><circle cx="10.5" cy="4" r="1.5" /><circle cx="5.5" cy="12" r="1.5" /></svg>
);

export const IconReset = () => (
  <svg {...base}><path d="M3.2 6.2A5 5 0 1 1 3 9" /><path d="M3 2.8v3.6h3.6" /></svg>
);

export const IconCapture = () => (
  <svg {...base}><path d="M2.5 5.5A1.5 1.5 0 0 1 4 4h1.3l1-1.4h3.4l1 1.4H12a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 12 13H4a1.5 1.5 0 0 1-1.5-1.5z" /><circle cx="8" cy="8.4" r="2.3" /></svg>
);

export const IconClose = () => (
  <svg {...base}><path d="M4 4l8 8M12 4l-8 8" /></svg>
);

export const IconPlay = () => (
  <svg {...base}><path d="M5 3.5v9l7-4.5z" /></svg>
);

export const IconStill = () => (
  <svg {...base}><rect x="2.5" y="3" width="11" height="10" rx="1.5" /><path d="M2.5 10.5l3-3 3 3 2-2 3 3" /></svg>
);

export const IconRecord = () => (
  <svg {...base}><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="2.4" fill="currentColor" stroke="none" /></svg>
);

export const IconEye = () => (
  <svg {...base}><path d="M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8z" /><circle cx="8" cy="8" r="1.9" /></svg>
);
