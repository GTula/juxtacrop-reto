/* =========================================================
   juxtacrop · Crop knowledge base for rotation planning
   ---------------------------------------------------------
   Qualitative traits summarised from general agronomic
   references (FAO crop information, SARE "Managing Cover
   Crops Profitably", university extension guides). They are
   typical values to compare rotations, NOT local
   recommendations: varieties and management change them.

   type      : 'warm' (summer crop) · 'cool' (winter crop) · 'perennial'
   hardy     : cool crops only — survives a hard winter (mean
               monthly temperature well below 0 °C)
   grow      : active growing months
   tBase     : minimum monthly mean temperature (°C) to grow
   span      : perennials only — months the stand is kept
   water     : typical seasonal water use (mm per cycle; per year for perennials)
   root      : 1 shallow · 2 medium · 3 deep
   nFix      : 0 none · 1 modest · 2 strong nitrogen contribution
   nDemand   : 0 low · 1 medium · 2 high nitrogen requirement
   residue   : 0 low · 1 medium · 2 high organic-matter input
   cover     : 0 poor · 1 fair · 2 good ground protection while growing
   drought / heat / frost / waterlog : tolerance 0 low · 1 medium · 2 high
   host      : pest/disease host group (same group in a row = no cycle break)
   use       : 'grain' 'oilseed' 'pulse' 'forage' 'fiber' 'vegetable' 'cover'
   equipment : 'standard' or 'specialized' (needs extra machinery/know-how)
   gaez      : crop name in FAO GAEZ v4 (null = not assessed by GAEZ)
   ========================================================= */

const CROPS = [
  // ----- Warm-season crops -----
  { id: 'corn',      name: 'Corn (maize)',  emoji: '🌽', color: '#E9C46A', family: 'Grass',     host: 'cereal',     type: 'warm', grow: 5, tBase: 12, water: 550, root: 3, nFix: 0, nDemand: 2, residue: 2, cover: 1, drought: 1, heat: 1, frost: 0, waterlog: 0, use: 'grain',   equipment: 'standard',    gaez: 'Maize' },
  { id: 'soybean',   name: 'Soybean',       emoji: '🫘', color: '#A7C957', family: 'Legume',    host: 'soy',        type: 'warm', grow: 4, tBase: 13, water: 475, root: 2, nFix: 1, nDemand: 0, residue: 0, cover: 1, drought: 1, heat: 1, frost: 0, waterlog: 1, use: 'oilseed', equipment: 'standard',    gaez: 'Soybean' },
  { id: 'sorghum',   name: 'Sorghum',       emoji: '🌾', color: '#BC6C25', family: 'Grass',     host: 'cereal',     type: 'warm', grow: 4, tBase: 15, water: 425, root: 3, nFix: 0, nDemand: 1, residue: 2, cover: 1, drought: 2, heat: 2, frost: 0, waterlog: 1, use: 'grain',   equipment: 'standard',    gaez: 'Sorghum' },
  { id: 'sunflower', name: 'Sunflower',     emoji: '🌻', color: '#F4A261', family: 'Aster',     host: 'aster',      type: 'warm', grow: 4, tBase: 10, water: 450, root: 3, nFix: 0, nDemand: 1, residue: 0, cover: 0, drought: 2, heat: 2, frost: 0, waterlog: 0, use: 'oilseed', equipment: 'standard',    gaez: 'Sunflower' },
  { id: 'drybean',   name: 'Dry bean',      emoji: '🫘', color: '#9C6644', family: 'Legume',    host: 'pulse',      type: 'warm', grow: 3, tBase: 14, water: 350, root: 1, nFix: 1, nDemand: 0, residue: 0, cover: 0, drought: 0, heat: 0, frost: 0, waterlog: 0, use: 'pulse',   equipment: 'standard',    gaez: 'Phaseolus bean' },
  { id: 'peanut',    name: 'Peanut',        emoji: '🥜', color: '#C9A66B', family: 'Legume',    host: 'pulse',      type: 'warm', grow: 5, tBase: 16, water: 500, root: 2, nFix: 1, nDemand: 0, residue: 0, cover: 0, drought: 1, heat: 2, frost: 0, waterlog: 0, use: 'oilseed', equipment: 'specialized', gaez: 'Groundnut' },
  { id: 'cotton',    name: 'Cotton',        emoji: '☁️', color: '#D8D8D2', family: 'Mallow',    host: 'mallow',     type: 'warm', grow: 6, tBase: 16, water: 650, root: 3, nFix: 0, nDemand: 1, residue: 0, cover: 0, drought: 1, heat: 2, frost: 0, waterlog: 0, use: 'fiber',   equipment: 'specialized', gaez: 'Cotton' },
  { id: 'rice',      name: 'Rice (flooded)', emoji: '🍚', color: '#90BE6D', family: 'Grass',    host: 'cereal',     type: 'warm', grow: 5, tBase: 16, water: 1100, root: 1, nFix: 0, nDemand: 1, residue: 1, cover: 1, drought: 0, heat: 1, frost: 0, waterlog: 2, use: 'grain',  equipment: 'specialized', gaez: 'Wetland rice', needsIrrigation: true },

  // ----- Cool-season crops -----
  { id: 'wheat',     name: 'Wheat',         emoji: '🌾', color: '#D4A373', family: 'Grass',     host: 'cereal',     type: 'cool', hardy: true,  grow: 6, tBase: 3, water: 450, root: 3, nFix: 0, nDemand: 2, residue: 2, cover: 2, drought: 1, heat: 0, frost: 2, waterlog: 1, use: 'grain',   equipment: 'standard',    gaez: 'Wheat' },
  { id: 'barley',    name: 'Barley',        emoji: '🌾', color: '#CCB07A', family: 'Grass',     host: 'cereal',     type: 'cool', hardy: false, grow: 5, tBase: 3, water: 400, root: 2, nFix: 0, nDemand: 1, residue: 2, cover: 2, drought: 1, heat: 0, frost: 1, waterlog: 0, use: 'grain',   equipment: 'standard',    gaez: 'Barley' },
  { id: 'oats',      name: 'Oats',          emoji: '🌿', color: '#B5C99A', family: 'Grass',     host: 'cereal',     type: 'cool', hardy: false, grow: 4, tBase: 3, water: 380, root: 2, nFix: 0, nDemand: 1, residue: 2, cover: 2, drought: 1, heat: 0, frost: 1, waterlog: 1, use: 'forage',  equipment: 'standard',    gaez: 'Oat', forage: true },
  { id: 'canola',    name: 'Canola',        emoji: '🌼', color: '#F6D743', family: 'Brassica',  host: 'brassica',   type: 'cool', hardy: false, grow: 5, tBase: 4, water: 420, root: 3, nFix: 0, nDemand: 2, residue: 1, cover: 1, drought: 1, heat: 0, frost: 1, waterlog: 0, use: 'oilseed', equipment: 'standard',    gaez: 'Rapeseed' },
  { id: 'flax',      name: 'Flax',          emoji: '💠', color: '#8AB6D6', family: 'Flax',      host: 'flax',       type: 'cool', hardy: false, grow: 4, tBase: 4, water: 380, root: 2, nFix: 0, nDemand: 1, residue: 0, cover: 1, drought: 1, heat: 0, frost: 1, waterlog: 0, use: 'oilseed', equipment: 'standard',    gaez: 'Flax' },
  { id: 'pea',       name: 'Field pea',     emoji: '🟢', color: '#80B918', family: 'Legume',    host: 'pulse',      type: 'cool', hardy: false, grow: 4, tBase: 4, water: 350, root: 1, nFix: 2, nDemand: 0, residue: 1, cover: 1, drought: 1, heat: 0, frost: 1, waterlog: 0, use: 'pulse',   equipment: 'standard',    gaez: 'Dry pea' },
  { id: 'chickpea',  name: 'Chickpea',      emoji: '🧆', color: '#DDB892', family: 'Legume',    host: 'pulse',      type: 'cool', hardy: false, grow: 5, tBase: 5, water: 350, root: 3, nFix: 1, nDemand: 0, residue: 0, cover: 1, drought: 2, heat: 1, frost: 1, waterlog: 0, use: 'pulse',   equipment: 'standard',    gaez: 'Chickpea' },
  { id: 'lentil',    name: 'Lentil',        emoji: '🟤', color: '#B08968', family: 'Legume',    host: 'pulse',      type: 'cool', hardy: false, grow: 4, tBase: 4, water: 300, root: 1, nFix: 1, nDemand: 0, residue: 0, cover: 1, drought: 2, heat: 0, frost: 1, waterlog: 0, use: 'pulse',   equipment: 'standard',    gaez: null },
  { id: 'potato',    name: 'Potato',        emoji: '🥔', color: '#B5838D', family: 'Nightshade', host: 'nightshade', type: 'cool', hardy: false, grow: 4, tBase: 7, water: 500, root: 1, nFix: 0, nDemand: 2, residue: 0, cover: 0, drought: 0, heat: 0, frost: 0, waterlog: 0, use: 'vegetable', equipment: 'specialized', gaez: 'White potato' },

  // ----- Cover crops -----
  { id: 'rye',       name: 'Cereal rye (cover)', emoji: '🌾', color: '#606C38', family: 'Grass', host: 'cereal',  type: 'cool', hardy: true,  grow: 5, tBase: 1, water: 300, root: 3, nFix: 0, nDemand: 1, residue: 2, cover: 2, drought: 1, heat: 0, frost: 2, waterlog: 1, use: 'cover',   equipment: 'standard',    gaez: 'Rye', forage: true, isCover: true },
  { id: 'vetch',     name: 'Hairy vetch (cover)', emoji: '🌿', color: '#386641', family: 'Legume', host: 'forage-legume', type: 'cool', hardy: true, grow: 5, tBase: 2, water: 300, root: 2, nFix: 2, nDemand: 0, residue: 1, cover: 2, drought: 1, heat: 0, frost: 2, waterlog: 0, use: 'cover', equipment: 'standard', gaez: null, isCover: true },
  { id: 'ryegrass',  name: 'Annual ryegrass', emoji: '🌱', color: '#7BA568', family: 'Grass',   host: 'forage-grass', type: 'cool', hardy: true, grow: 6, tBase: 2, water: 450, root: 2, nFix: 0, nDemand: 1, residue: 2, cover: 2, drought: 0, heat: 0, frost: 1, waterlog: 2, use: 'forage', equipment: 'standard', gaez: null, forage: true },

  // ----- Perennial forages -----
  { id: 'alfalfa',   name: 'Alfalfa',       emoji: '🍀', color: '#55A630', family: 'Legume',    host: 'forage-legume', type: 'perennial', span: 36, tBase: 5, water: 800, root: 3, nFix: 2, nDemand: 0, residue: 2, cover: 2, drought: 2, heat: 1, frost: 2, waterlog: 0, use: 'forage', equipment: 'standard', gaez: 'Alfalfa', forage: true },
  { id: 'redclover', name: 'Red clover',    emoji: '☘️', color: '#6A994E', family: 'Legume',    host: 'forage-legume', type: 'perennial', span: 18, tBase: 4, water: 600, root: 3, nFix: 2, nDemand: 0, residue: 2, cover: 2, drought: 1, heat: 0, frost: 2, waterlog: 1, use: 'forage', equipment: 'standard', gaez: null, forage: true },
];

const CROP_BY_ID = Object.fromEntries(CROPS.map(c => [c.id, c]));

/* Farmer priorities (weights 0-3 set in the UI) */
const PRIORITIES = [
  { id: 'soil',    label: 'Build soil organic matter', icon: '🪱' },
  { id: 'water',   label: 'Conserve water',            icon: '💧' },
  { id: 'erosion', label: 'Reduce erosion',            icon: '⛰️' },
  { id: 'nitrogen', label: 'Supply nitrogen naturally', icon: '🌱' },
  { id: 'pests',   label: 'Break pest & disease cycles', icon: '🐛' },
  { id: 'income',  label: 'Supplemental income / forage', icon: '💵' },
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* Source catalogue shown in the UI — what each dataset contributes and its limits */
const SOURCES = {
  power:  { name: 'NASA POWER', short: 'POWER', url: 'https://power.larc.nasa.gov/', what: 'Monthly temperature, frost days, evapotranspiration, humidity and solar radiation (climatology) plus daily max/min temperature.', scale: '0.5° × 0.625° grid (~50 km), MERRA-2 based', limit: 'Regional climate context — not a weather station inside your field.' },
  imerg:  { name: 'NASA GPM IMERG', short: 'IMERG', url: 'https://gpm.nasa.gov/data/imerg', what: 'Daily satellite precipitation since 2001 (served through NASA POWER).', scale: '0.1° grid (~11 km)', limit: 'One grid cell covers many fields; it is not a rain gauge.' },
  smap:   { name: 'NASA SMAP L4', short: 'SMAP', url: 'https://nsidc.org/data/spl4smgp', what: 'Root-zone soil moisture (m³/m³), sampled monthly from NASA GIBS imagery.', scale: '9 km grid, model-assimilated', limit: 'Regional moisture signal; it cannot tell plots apart. Values decoded from the GIBS color scale (±0.003 m³/m³).' },
  modis:  { name: 'NASA MODIS NDVI', short: 'MODIS', url: 'https://modis.gsfc.nasa.gov/data/dataprod/mod13.php', what: 'Monthly vegetation index (greenness), used to detect when the land is typically bare.', scale: '~1 km in GIBS monthly product', limit: 'Mixes your field with neighbours; validate bare periods with your records.' },
  landsat:{ name: 'NASA/USGS Landsat', short: 'Landsat', url: 'https://landsat.gsfc.nasa.gov/', what: 'Historical imagery of the field: WELD annual composites 1983–2000 (NASA GIBS) and the least-cloudy Landsat 8/9 scene of each growing season since 2013 (Esri Living Atlas).', scale: '30 m', limit: 'One scene per year (or an annual composite) — a snapshot, not the whole season.' },
  s2:     { name: 'Sentinel-2 cloudless', short: 'Sentinel-2', url: 'https://s2maps.eu', what: 'Detailed true-color mosaic to recognise and outline fields and plots.', scale: '10 m', limit: 'Annual cloud-free composite (ESA Copernicus data, mosaic by EOX), not a live image.' },
  srtm:   { name: 'Copernicus DEM (via Open-Meteo)', short: 'DEM', url: 'https://open-meteo.com/en/docs/elevation-api', what: 'Elevation → slope and low spots across the field (erosion and water accumulation).', scale: '90 m (GLO-90), whole-metre values', limit: 'Coarse for small fields: does not see tile drains, terraces or micro-relief.' },
  gaez:   { name: 'FAO GAEZ v4', short: 'GAEZ', url: 'https://gaez.fao.org/', what: 'Crop suitability index (0–10 000) for rainfed, high-input farming: 1981–2010 and 2041–2070 (RCP 4.5 ensemble).', scale: '5 arc-minutes (~9 km)', limit: 'Modelled suitability, not a yield forecast for your plot.' },
  agro:   { name: 'Agronomic literature', short: 'Agronomy', url: 'https://www.sare.org/publications/managing-cover-crops-profitably/', what: 'Crop traits used in the rules (water use, rooting, N fixation, residue, host groups).', scale: 'General', limit: 'Typical values; varieties and local management change them.' },
  farmer: { name: 'Farmer input', short: 'You', url: null, what: 'Field boundary, plots, crop history, drainage, priorities and constraints.', scale: 'Plot', limit: 'Only as good as what is entered — unknowns are flagged.' },
};
