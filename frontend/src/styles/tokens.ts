// The same tokens as tokens.css, for code that needs values (charts, inline SVG). Keep in sync.
export const colors = {
  paper: '#F5F6F3',
  sheet: '#FFFFFF',
  ink: '#16181D',
  muted: '#5A606B',
  rule: '#DADCD5',
  marginRed: '#B42318',
  highlighter: '#FFE14D',
  okGreen: '#1E7A46',
  ruleStrong: '#C9CCC3',
  ruleSoft: '#ECEDE8',
  highlighterInk: '#17150A',
  highlighterSoft: '#FFF6C2',
  redSoft: '#F6D9D5',
} as const;

export const fonts = {
  heading: "'Libre Caslon Text', Georgia, 'Times New Roman', serif",
  body: "'Public Sans', 'Segoe UI', system-ui, sans-serif",
  mono: "'Courier Prime', 'Courier New', monospace",
} as const;
