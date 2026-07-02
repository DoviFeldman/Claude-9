export type Unit = 'px' | 'in' | 'cm' | 'mm';

export const UNIT_TO_PX: Record<Unit, number> = {
  px: 1,
  in: 96,
  cm: 37.795275591,
  mm: 3.7795275591,
};

export function toPx(value: number, unit: Unit): number {
  return Math.round(value * UNIT_TO_PX[unit]);
}
export function fromPx(px: number, unit: Unit): number {
  const v = px / UNIT_TO_PX[unit];
  return unit === 'px' ? Math.round(v) : Math.round(v * 100) / 100;
}

export interface Template {
  name: string;
  w: number;
  h: number;
  group: string;
  gradient: string;
}

export const TEMPLATES: Template[] = [
  { name: 'YouTube Thumbnail', w: 1280, h: 720, group: 'Social media', gradient: 'linear-gradient(135deg,#ff6b6b,#ee0979)' },
  { name: 'Instagram Post', w: 1080, h: 1080, group: 'Social media', gradient: 'linear-gradient(135deg,#a18cd1,#fbc2eb)' },
  { name: 'Instagram Story', w: 1080, h: 1920, group: 'Social media', gradient: 'linear-gradient(135deg,#f093fb,#f5576c)' },
  { name: 'Facebook Post', w: 1200, h: 630, group: 'Social media', gradient: 'linear-gradient(135deg,#4facfe,#00f2fe)' },
  { name: 'X / Twitter Post', w: 1600, h: 900, group: 'Social media', gradient: 'linear-gradient(135deg,#43e97b,#38f9d7)' },
  { name: 'X / Twitter Header', w: 1500, h: 500, group: 'Social media', gradient: 'linear-gradient(135deg,#30cfd0,#330867)' },
  { name: 'LinkedIn Banner', w: 1584, h: 396, group: 'Social media', gradient: 'linear-gradient(135deg,#667eea,#764ba2)' },
  { name: 'Pinterest Pin', w: 1000, h: 1500, group: 'Social media', gradient: 'linear-gradient(135deg,#f6d365,#fda085)' },
  { name: 'Presentation 16:9', w: 1920, h: 1080, group: 'Web & presentations', gradient: 'linear-gradient(135deg,#5ee7df,#b490ca)' },
  { name: 'Website / Desktop', w: 1440, h: 1024, group: 'Web & presentations', gradient: 'linear-gradient(135deg,#c471f5,#fa71cd)' },
  { name: 'Logo', w: 500, h: 500, group: 'Web & presentations', gradient: 'linear-gradient(135deg,#fddb92,#d1fdff)' },
  { name: 'A4 Document', w: 794, h: 1123, group: 'Print', gradient: 'linear-gradient(135deg,#e0c3fc,#8ec5fc)' },
  { name: 'US Letter', w: 816, h: 1056, group: 'Print', gradient: 'linear-gradient(135deg,#fbc2eb,#a6c1ee)' },
  { name: 'Business Card 3.5×2″', w: 336, h: 192, group: 'Print', gradient: 'linear-gradient(135deg,#84fab0,#8fd3f4)' },
  { name: 'Flyer A5', w: 559, h: 794, group: 'Print', gradient: 'linear-gradient(135deg,#a1c4fd,#c2e9fb)' },
  { name: 'Poster 18×24″', w: 1728, h: 2304, group: 'Print', gradient: 'linear-gradient(135deg,#ffecd2,#fcb69f)' },
];

export const GOOGLE_FONTS = [
  'Inter', 'Poppins', 'Montserrat', 'Roboto', 'Open Sans', 'Lato', 'Oswald', 'Raleway',
  'Nunito', 'Playfair Display', 'Merriweather', 'Lora', 'Quicksand', 'Josefin Sans',
  'Cormorant Garamond', 'Space Grotesk', 'Work Sans', 'Barlow', 'Courier Prime', 'EB Garamond',
  'Bebas Neue', 'Anton', 'Archivo Black', 'Pacifico', 'Abril Fatface', 'Shadows Into Light',
  'Dancing Script', 'Caveat', 'DM Serif Display', 'Lobster', 'Righteous', 'Satisfy', 'Amatic SC',
];

export const SYSTEM_FONTS = [
  'Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Impact',
];

export const ALL_FONTS = [...GOOGLE_FONTS, ...SYSTEM_FONTS].sort();

export const DEFAULT_SWATCHES = [
  '#000000', '#545454', '#737373', '#a6a6a6', '#d9d9d9', '#ffffff',
  '#ff3131', '#ff5757', '#ff66c4', '#cb6ce6', '#8c52ff', '#5e17eb',
  '#0097b2', '#0cc0df', '#5ce1e6', '#38b6ff', '#5271ff', '#004aad',
  '#00bf63', '#7ed957', '#c1ff72', '#ffde59', '#ffbd59', '#ff914d',
];

export const BRAND = '#8b3dff';

export const RETENTION_DAYS = 7;
export const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
