export const THEMES = [
  { id: 'sage', label: 'Sage Green', bg: '#e3ecdf', dot: '#92400e', panel: '#f2f7ef', primary: '#92400e', accent: '#ea580c', text: '#1e3327', dark: false },
  { id: 'cream', label: 'Warm Cream', bg: '#f4ecdd', dot: '#92400e', panel: '#f8f2e4', primary: '#92400e', accent: '#ea580c', text: '#3b2f1d', dark: false },
  { id: 'steel', label: 'Sandstone', bg: '#d9e2cf', dot: '#92400e', panel: '#f0ebe0', primary: '#92400e', accent: '#ea580c', text: '#33291a', dark: false },
  { id: 'slate', label: 'Dark Coal', bg: '#0f1210', dot: '#92400e', panel: '#181c18', primary: '#92400e', accent: '#ea580c', text: '#e8e4dc', dark: true },
  { id: 'navy', label: 'Espresso', bg: '#0f1210', dot: '#92400e', panel: '#181c18', primary: '#92400e', accent: '#ea580c', text: '#e8e4dc', dark: true },
  { id: 'purple', label: 'Royal Purple', bg: '#0c0918', dot: '#a78bfa', panel: '#181230', primary: '#a78bfa', accent: '#e879f9', text: '#f3eefc', dark: true },
  { id: 'obsidian', label: 'Obsidian Gold', bg: '#0a0c10', dot: '#d4a941', panel: '#12151c', primary: '#d4a941', accent: '#e6c26a', text: '#f2f0ec', dark: true },
];

export function getTheme() {
  // One-time reset to the light default (v2) : earlier dark picks are cleared.
  if (!localStorage.getItem('app-theme-v2')) {
    localStorage.setItem('app-theme-v2', '1');
    localStorage.setItem('app-theme', 'sage');
    return 'sage';
  }
  return localStorage.getItem('app-theme') || 'steel';
}

export function applyTheme(id) {
  const t = THEMES.find((x) => x.id === id) || THEMES[0];
  document.documentElement.dataset.theme = t.id;
  localStorage.setItem('app-theme', t.id);
  return t;
}
