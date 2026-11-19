// "Describe a design": a local, deterministic reading of a whole-garment description ("oversized navy hoodie with
// a cream hood and white cuffs") into edits of the design. Garment words choose the base product, neckline, sleeve
// length, hem, chest pocket and fit; clauses that name a part ("cream hood") style that part; everything else styles
// the whole garment. Each change is reported with its scope, and words that were not understood are listed. Style
// words are read by the part-level interpreter in style-prompt.ts. No network and no model.
import { readStylePrompt } from './style-prompt.ts';
import { contrastingInk, readSlogan, textPlace, type TextRequest } from './text-artwork.ts';
import { GATHER, PLEAT_COUNT, PLEAT_DEPTH, pleatDepthLimit, validateSkirtMeasures, type PleatStyle, type SkirtMeasures } from './product-skirt.ts';
import {
  BASE_NAMES, DEFAULT_BUST_DART, DEFAULT_WAIST_DART, FISHEYE_MIN_BELOW_CM, waistDartsAllowed, DRESS_GATHER, DRESS_LENGTH, FIT_NAMES, FLOOR_LENGTH, MAXI_LENGTH, LIMITS, WAIST_FIT_KEYS, seamHalfAt, teeDimensions, waistShapeable, waistSeamAllowed, withSleeveLength, PART_NAMES, RIB_PARTS, SLEEVE_PRESETS, chestPocketAllowed, backPocketsAllowed, yokeAllowed, cuffsAllowed, CUFFED_SLEEVE, garmentName, hemAllowed, isBottoms, lapelsAllowed, liningAllowed, COAT_LENGTH, isSleeveArtwork, keepArtworkInside, legMeasurements, optionsOf, partName, partsOf,
  template, topMeasurements, validateProduct, withLegCuffs, withOptions, withSkirtWaistband, type Base, type FitKey, type PartId, type Product, zipAllowed } from './product.ts';

export interface DesignScope { label: string; understood: string[] }
export interface DesignReading { product: Product; scopes: DesignScope[]; ignored: string[]; /** Words in quotes, to print on the garment. */ text?: TextRequest }

// Named top pattern measurements, in the same units and conventions as the fit controls.
const TOP_FIT_LABELS: Partial<Record<string, FitKey>> = {
  'shoulder width': 'shoulderWidth', 'shoulder drop': 'shoulderDrop',
  'neck width': 'neckWidth', 'front neck drop': 'frontNeckDrop', 'back neck drop': 'backNeckDrop',
  'armhole depth': 'armholeDepth', 'waist width': 'waistWidth', 'waist position': 'waistPosition', 'hem width': 'hemWidth',
};

/** The template a garment word starts from, and its base. */
const GARMENTS: [RegExp, string, Base][] = [
  // A tank top is a sleeveless tee, and a crop top a short one.
  [/\bcrop(?:ped)? tops?\b/, 'crop-top', 'tee'],
  [/\b(?:tank|vest|sleeveless) tops?\b|\btanks?\b|\bsinglets?\b/, 'blank', 'tee'],
  // Shirts: a shirt dress is a long one; a dress shirt is not a dress.
  [/\bshirt ?dress(?:es)?\b/, 'shirt', 'tee'],
  [/\b(?:dress|formal|oxford|button[- ]?(?:up|down)|flannel|work) shirts?\b|\bbutton[- ]?(?:ups?|downs?)\b/, 'shirt', 'tee'],
  // Dresses are long tops; a plain "dress" keeps the current top's base.
  [/\b(?:hoodie|hooded) dress(?:es)?\b/, 'hoodie', 'hoodie'],
  [/\b(?:sweatshirt|sweat|jumper|sweater) dress(?:es)?\b/, 'sweat-dress', 'sweatshirt'],
  // A fit-and-flare (skater) dress is shaped at the waist and cut there into a bodice and a flared skirt.
  [/\b(?:fit[- ]and[- ]flare|skater) dress(?:es)?\b/, 'fit-flare', 'tee'],
  [/\b(?:t-?shirt|tee) dress(?:es)?\b/, 'tee-dress', 'tee'],
  [/\bdress(?:es)?\b/, 'tee-dress', 'tee'],
  [/\b(hoodies?|hooded (?:sweatshirt|top|jumper))\b/, 'hoodie', 'hoodie'],
  // A blazer (or sport coat or suit jacket) is a hip-length coat with notched lapels; it is read before coats and jackets.
  [/\b(?:blazers?|sports? coats?|suit jackets?|tailored jackets?)\b/, 'blazer', 'tee'],
  // Coats (not a waistcoat, which is a vest): a long shirt cut to go over other tops.
  [/\b(?:rain|over|top)?coats?\b/, 'coat', 'tee'],
  // Jackets start from the bomber, the one jacket so far.
  [/\b(?:bomber|flight|track|zip(?:-? ?up)?) jackets?\b|\bbombers?\b|\btrack tops?\b|\bjackets?\b/, 'bomber', 'sweatshirt'],
  [/\b(sweatshirts?|jumpers?|sweaters?|crew ?neck sweat(?:shirt)?s?)\b/, 'crew-sweat', 'sweatshirt'],
  [/\bpolo(?: shirt)?s?\b/, 'polo', 'tee'],
  [/\b(t-?shirts?|tees?)\b/, 'blank', 'tee'],
  [/(?<!polo |t-|t )\bshirts?\b/, 'shirt', 'tee'],
  [/\bshorts\b/, 'shorts', 'trousers'],
  [/\b(joggers|sweat ?pants|track ?pants|jogging bottoms|track ?suit bottoms)\b/, 'joggers', 'trousers'],
  [/\bjeans\b/, 'jeans', 'trousers'],
  [/\b(trousers|pants|chinos)\b/, 'trousers', 'trousers'],
  [/\bskirts?\b/, 'flared-skirt', 'skirt'],
];

/** Part words, longest first; each names the parts it means on this design. */
const PART_WORDS: [RegExp, (parts: ReadonlySet<PartId>) => PartId[]][] = [
  [/\bleft sleeves?\b/, () => ['sleeveLeft']],
  [/\bright sleeves?\b/, () => ['sleeveRight']],
  [/\bleft cuffs?\b/, () => ['cuffLeft']],
  [/\bright cuffs?\b/, () => ['cuffRight']],
  [/\bchest pockets?\b/, () => ['chestPocket']],
  [/\b(?:front|scoop) pockets?\b|\bpocket facings?\b/, parts => (parts.has('frontPocket') ? ['frontPocket'] : [])],
  [/\bback pockets?\b/, parts => (parts.has('backPocket') ? ['backPocket'] : [])],
  [/\bbelt loops?\b/, parts => (parts.has('beltLoop') ? ['beltLoop'] : [])],
  [/\b(kangaroo pockets?|pouch|pockets?)\b/, parts => [parts.has('pocket') ? 'pocket' : parts.has('backPocket') ? 'backPocket' : 'chestPocket']],
  [/\b(rib trims?|trims?)\b/, parts => ['neckband', 'collar', 'cuffLeft', 'cuffRight', 'hemBand', 'waistband'].filter(id => parts.has(id as PartId)) as PartId[]],
  [/\b(hem ?bands?|hem ribs?|bottom bands?)\b/, () => ['hemBand']],
  [/\b(waist ?bands?)\b/, () => ['waistband']],
  // A dress cut at the waist: its skirt pieces, and the bodice above them.
  [/\bfront skirts?\b/, parts => (parts.has('skirtFront') ? ['skirtFront'] : [])],
  [/\bback skirts?\b/, parts => (parts.has('skirtBack') ? ['skirtBack'] : [])],
  [/\bskirts?\b/, parts => (parts.has('skirtFront') ? ['skirtFront', 'skirtBack'] : [])],
  [/\bbodices?\b/, parts => (parts.has('skirtFront') ? ['front', 'back'] : [])],
  [/\b(sleeves?|arms?)\b/, () => ['sleeveLeft', 'sleeveRight']],
  [/\bcuffs?\b/, () => ['cuffLeft', 'cuffRight']],
  [/\bhoods?\b/, () => ['hood']],
  [/\b(collars?|neck ?bands?|neck ribs?|necklines?|neck)\b/, parts => [parts.has('collar') ? 'collar' : 'neckband']],
  // A coat's lapels, before the collar.
  [/\blapels?\b/, parts => (parts.has('lapel') ? ['lapel'] : [])],
  // A coat's lining.
  [/\blinings?\b/, parts => (parts.has('lining') ? ['lining'] : [])],
  // A shirt's back yoke, before "back" alone takes the word.
  [/\b(?:back )?yokes?\b/, parts => (parts.has('yoke') ? ['yoke'] : [])],
  [/\b(front panels?|front)\b/, () => ['front']],
  [/\b(back panels?|back)\b/, () => ['back']],
  [/\b(body|bodies|torso|legs?|panels)\b/, () => ['front', 'back']],
];

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
const clampTo = ([low, high]: readonly [number, number], value: number) => Math.min(high, Math.max(low, value));

/**
 * Reads `prompt` as edits of `current`. Throws when nothing in it could be applied, so a failed description never
 * changes the design.
 */
export function readDesignPrompt(prompt: string, current: Product): DesignReading {
  // Words in quotes are printed on the garment, not read as garment words ("tee with "Stay Wild" on the back").
  const slogan = readSlogan(prompt.slice(0, 260));
  let text = fold(slogan ? slogan.rest : prompt).slice(0, 200);
  if (!text.trim() && !slogan) throw new Error('Describe the garment, for example "oversized navy hoodie with a cream hood and white cuffs".');
  const garment: string[] = [], notApplied: string[] = [];
  // Garment words are blanked out once read, keeping positions, so they are not read again as style or part words.
  const take = (pattern: RegExp): RegExpExecArray | null => {
    const match = pattern.exec(text);
    if (match) text = text.slice(0, match.index) + ' '.repeat(match[0].length) + text.slice(match.index + match[0].length);
    return match;
  };

  // A long dress is a maxi dress; the word is read before the garment word is taken.
  const longDress = take(/\blong(?![ -]sleeve)(?=(?:[ -][a-z]+){0,2}[ -]dress(?:es)?\b)/);
  // A gathered dress is a dress whose skirt is gathered into a waist seam: the word is read with the skirt, below.
  const gatheredDress = take(/\b(?:gathered|dirndl)(?=(?:[ -][a-z]+){0,3} dress(?:es)?\b)/);
  // The garment: a different base starts from that base's template; shorts and trousers switch leg length.
  let product = structuredClone(current);
  let tank = false;
  // On a dress cut at the waist, "skirt" names its skirt pieces, not a skirt to wear instead; so does a gathered skirt on
  // a dress long enough to be cut there.
  const dressSkirt = partsOf(product).includes('skirtFront') || (!gatheredDress && waistSeamAllowed(product) && /\b(?:gathered|dirndl) skirts?\b/.test(text));
  for (const [pattern, id, chosen] of GARMENTS) {
    if (id === 'flared-skirt' && dressSkirt) continue;
    const match = take(pattern);
    if (!match) continue;
    tank = id === 'blank' && /tank|vest|sleeveless|singlet/.test(match[0]);
    const dress = /dress/.test(match[0]) && !/\bdress shirts?\b/.test(match[0]);
    const base = dress && match[0].startsWith('dress') && !isBottoms(current) ? current.base : chosen;
    if (dress) {
      if (base !== product.base) product = { ...template(id), ...(current.spec ? { spec: current.spec } : {}), ...(current.motifs ? { motifs: current.motifs } : {}) };
      else if (id === 'shirt') product = withOptions({ ...product, neckline: 'crew' }, { ...optionsOf(product), buttons: true, collar: true });
      // Shoulder-to-hem lengths for a mid-height body: a mini ends at mid-thigh, a midi below the knee.
      // A maxi dress ends at the ankles and a floor-length one just above the floor (a mid-height body's shoulder is
      // about 138 cm up).
      const length = take(/\bmini\b/) ? DRESS_LENGTH : take(/\b(?:midi|mid[- ]calf|calf[- ]length)\b/) ? 115 : take(/\bknee[- ]length\b/) ? 100
        : take(/\b(?:floor[- ]length|full[- ]length|floor[- ]sweeping)\b/) ? FLOOR_LENGTH : (take(/\b(?:maxi|ankle[- ]length)\b/) || longDress) ? MAXI_LENGTH
        : Math.max(topMeasurements(product).length, base === 'tee' ? 100 : 92);
      const flared = template(base === 'tee' ? 'tee-dress' : 'sweat-dress').fit!.hemWidth!;
      product.measurements = { ...topMeasurements(product), length };
      if (id === 'fit-flare' && base === current.base) {
        // A tee becoming a fit-and-flare dress keeps its styling: its waist is taken in 10 cm a piece and its hem flared
        // to one and a half times the chest, and it is cut at the waist.
        const panel = topMeasurements(product).chest / 2 + 2;
        product.fit = { ...product.fit, waistWidth: Math.round((panel - 10) * 2) / 2, hemWidth: Math.round(panel * 1.5 * 2) / 2 };
        product = withOptions(product, { ...optionsOf(product), waistSeam: true });
      }
      if (product.fit?.hemWidth === undefined) product.fit = { ...product.fit, hemWidth: flared };
      garment.push(`garment: ${garmentName(product)}${base !== current.base ? ', started from its template' : ''}, ${length} cm long`);
      break;
    }
    if (base === 'trousers' && product.base === 'trousers') {
      const inseam = id === 'shorts' ? 18 : 78, cuffs = legMeasurements(product).cuffHeight;
      // Shorts lose ankle cuffs; joggers gain them.
      if (id === 'shorts' && cuffs) product = withLegCuffs(product, 0);
      product.measurements = { ...legMeasurements(product), inseam };
      // Artwork below the new hem moves up onto the shorter legs.
      keepArtworkInside(product);
      garment.push(`${id === 'shorts' ? 'shorts' : 'full-length legs'}: ${inseam} cm inseam`);
      if (id === 'joggers' && !cuffs) {
        product = withLegCuffs(product, legMeasurements(template('joggers')).cuffHeight!);
        garment.push('ankle cuffs: joggers');
      }
      // Trousers described as jeans keep their styling and gain the fly and belt loops, front pockets, the back yoke and
      // back pockets.
      const jeans = optionsOf(product);
      if (id === 'jeans' && (!jeans.yoke || !jeans.backPockets || !jeans.frontPockets || !jeans.fly || !jeans.beltLoops)) {
        product = withOptions(product, { ...jeans, yoke: true, backPockets: true, frontPockets: true, fly: true, beltLoops: true });
        garment.push('jeans: zip fly, belt loops, front pockets, back yoke and back pockets');
      }
    } else if (base === product.base && id === 'polo') {
      // A tee described as a polo keeps its styling and gains the collar and placket, on a round neck.
      product = withOptions({ ...product, neckline: 'crew' }, { ...optionsOf(product), collar: true });
      garment.push(`garment: ${garmentName(product)}`);
    } else if (base === product.base && id === 'shirt') {
      // A tee described as a shirt keeps its styling and gains the button front and collar, on a round neck.
      product = withOptions({ ...product, neckline: 'crew' }, { ...optionsOf(product), buttons: true, collar: true });
      garment.push(`garment: ${garmentName(product)}`);
    } else if (base === product.base && id === 'blazer') {
      // A top described as a blazer keeps its styling and becomes a coat with lapels, at least as roomy and long-sleeved
      // as the blazer template and at least coat length.
      const blazer = topMeasurements(template('blazer')), m = topMeasurements(product);
      product.measurements = { ...m, chest: Math.max(m.chest, blazer.chest), length: Math.max(m.length, COAT_LENGTH), sleeve: Math.max(m.sleeve, blazer.sleeve) };
      const kept = { ...optionsOf(product) };
      delete kept.waistSeam;
      // Its lapels are notched unless peak lapels are named, or it had them already.
      const peak = /\bpeak(?:ed)? lapels?\b/.test(text) || (!!kept.peakLapels && !/\bnotch(?:ed)? lapels?\b/.test(text));
      delete kept.peakLapels;
      product = withOptions({ ...product, neckline: 'crew' }, { ...kept, buttons: true, collar: true, coat: true, lapels: true, ...(peak ? { peakLapels: true } : {}) });
      garment.push(`garment: ${garmentName(product)} with ${peak ? 'peak' : 'notched'} lapels, ${topMeasurements(product).length} cm long`);
    } else if (base === product.base && id === 'coat') {
      // A top described as a coat keeps its styling and becomes one: a button front and collar on a round neck, at
      // least as long, roomy and long-sleeved as the coat template, and not cut at the waist.
      const coat = topMeasurements(template('coat')), m = topMeasurements(product);
      product.measurements = { ...m, chest: Math.max(m.chest, coat.chest), length: Math.max(m.length, coat.length), sleeve: Math.max(m.sleeve, coat.sleeve) };
      const kept = { ...optionsOf(product) };
      delete kept.waistSeam;
      product = withOptions({ ...product, neckline: 'crew' }, { ...kept, buttons: true, collar: true, coat: true });
      garment.push(`garment: ${garmentName(product)}, ${topMeasurements(product).length} cm long`);
    } else if (base === product.base && id === 'bomber') {
      // A sweatshirt described as a bomber keeps its styling and gains the front zip and rib stand collar, on a round neck.
      product = withOptions({ ...product, neckline: 'crew' }, { ...optionsOf(product), zip: true, collar: true });
      garment.push(`garment: ${garmentName(product)}`);
    } else if (base === product.base && id === 'crop-top') {
      // A tee described as a crop top keeps its styling and is shortened to end above the waist.
      const length = Math.min(topMeasurements(product).length, topMeasurements(template('crop-top')).length);
      product.measurements = { ...topMeasurements(product), length };
      garment.push(`garment: ${garmentName(product)}, ${length} cm long`);
    } else if (base === product.base) {
      garment.push(`garment: ${BASE_NAMES[base]}`);
    } else {
      // A new garment starts from its template; the design's spec and uploaded motifs stay with it.
      product = { ...template(id), ...(current.spec ? { spec: current.spec } : {}), ...(current.motifs ? { motifs: current.motifs } : {}) };
      garment.push(`garment: ${garmentName(product)}, started from its template`);
    }
    break;
  }
  const top = !isBottoms(product), reference = template(product.base === 'tee' ? 'blank' : product.base === 'sweatshirt' ? 'crew-sweat' : product.base === 'hoodie' ? 'hoodie' : product.base === 'skirt' ? 'flared-skirt' : 'trousers');

  // Neckline, sleeve length, hem and chest pocket.
  const neckline = take(/\bv[- ]?neck(?:ed|line)?\b/) ? 'v' : take(/\b(crew[- ]?neck(?:ed|line)?|round[- ]?neck(?:ed|line)?)\b/) ? 'crew' : null;
  if (neckline) {
    if (!top || (neckline === 'v' && product.base === 'hoodie')) notApplied.push(`${neckline === 'v' ? 'V-neck' : 'crew neck'} (not available on a ${BASE_NAMES[product.base].toLowerCase()})`);
    else { product.neckline = neckline; garment.push(`neckline: ${neckline === 'v' ? 'V-neck' : 'crew neck'}`); }
  }
  const sleeve = take(/\blong[- ]sleeved?s?\b/) ? SLEEVE_PRESETS[2] : take(/\bshort[- ]sleeved?s?\b/) ? SLEEVE_PRESETS[0] : take(/\belbow[- ](?:length )?sleeved?s?\b/) ? SLEEVE_PRESETS[1]
    : take(/\bsleeveless\b|\bno sleeves\b/) || tank ? SLEEVE_PRESETS[3] : null;
  if (sleeve) {
    if (!top) notApplied.push(`${sleeve.name.toLowerCase()} sleeves (no sleeves on ${BASE_NAMES[product.base].toLowerCase()})`);
    else if (sleeve.cm === 0 && product.base !== 'tee') notApplied.push(`sleeveless (only a T-shirt can be made sleeveless, not a ${BASE_NAMES[product.base].toLowerCase()})`);
    else { product = withSleeveLength(product, sleeve.cm); garment.push(sleeve.cm ? `sleeves: ${sleeve.name.toLowerCase()} (${sleeve.cm} cm)` : 'sleeveless'); }
  }
  const hem = take(/\b(curved|shirttail|shirt-tail) hem\b/) ? 'curved' : take(/\bstraight hem\b/) ? 'straight' : null;
  if (hem) {
    if (!top || !hemAllowed(product.base, hem)) notApplied.push(`${hem} hem (a ${BASE_NAMES[product.base].toLowerCase()} keeps its own hem)`);
    else { product = withOptions(product, { ...optionsOf(product), hem }); garment.push(`hem: ${hem === 'curved' ? 'curved shirttail' : 'straight'}`); }
  }
  // A front zip ("zip hoodie", "zip-up", "full-zip"), or none ("pullover"); a zip fly is trousers' (below).
  const zipped = take(/\b(?:full[- ]?)?zip(?:ped|[- ]?(?:up|through))?\b(?! fly)/) ? true : take(/\bpull[- ]?over\b/) ? false : null;
  if (zipped !== null && zipAllowed(product.base)) {
    const had = !!optionsOf(product).zip, before = garmentName(product), others = { ...optionsOf(product) };
    delete others.zip; delete others.zipOpen;
    product = withOptions(product, zipped ? { ...others, zip: true } : others);
    // The garment as now named ("Zip hoodie, started from its template").
    for (let i = 0; i < garment.length; i++) garment[i] = garment[i]!.replace(before, garmentName(product)).replace(BASE_NAMES[product.base], garmentName(product));
    if (zipped !== had) garment.push(zipped ? 'front zip added' : 'front zip removed');
  } else if (zipped) notApplied.push(`front zip (only a hoodie or a sweatshirt has one, not a ${garmentName(product).toLowerCase()})`);
  // A sweatshirt's rib stand collar ("funnel neck", "stand-up collar").
  if (take(/\b(?:funnel|mock)[- ]?necks?\b|\bstand(?:-up| up)? collars?\b/)) {
    if (product.base !== 'sweatshirt') notApplied.push(`stand collar (only a sweatshirt has one, not a ${garmentName(product).toLowerCase()})`);
    else if (!optionsOf(product).collar) {
      product = withOptions({ ...product, neckline: 'crew' }, { ...optionsOf(product), collar: true });
      garment.push(`rib stand collar added: ${garmentName(product)}`);
    }
  }
  // A shirt's back yoke: added by naming it ("a contrast yoke", "navy yoke"), taken off with "no yoke".
  const noYoke = take(/\b(?:no|without(?: a)?) (?:back )?yokes?\b/), yoked = /\byokes?\b/.test(text);
  if (noYoke && optionsOf(product).yoke) {
    product = withOptions(product, { ...optionsOf(product), yoke: false });
    garment.push('back yoke removed');
  } else if (!noYoke && yoked && !optionsOf(product).yoke) {
    if (yokeAllowed(product.base, optionsOf(product))) {
      product = withOptions(product, { ...optionsOf(product), yoke: true });
      garment.push(product.base === 'trousers' ? 'back yoke added: the back legs are cut across the seat' : 'back yoke added: the back is cut across below the neck');
    } else notApplied.push(`back yoke (it goes on a shirt with a button front or on trousers, not a ${garmentName(product).toLowerCase()})`);
  }
  if (take(/\bcontrast(?:ing)? (?:back )?yokes?\b/) && optionsOf(product).yoke) {
    // A contrast yoke without a colour named: the yoke in the collar's colour if that differs from the back, else navy.
    const parts = product.parts as Partial<Record<PartId, { color: string }>>;
    const back = product.parts.back.color, collar = parts.collar?.color;
    product.parts = { ...product.parts, yoke: { ...product.parts.yoke!, color: collar && collar !== back ? collar : '#1f2a4f' } };
    garment.push('contrast yoke');
  }
  // A long-sleeved shirt's cuffs: added by naming them ("white cuffs", "barrel cuffs"), taken off with "no cuffs".
  const noCuffs = take(/\b(?:no|without) cuffs?\b/), cuffed = /\b(?:barrel |shirt |buttoned |contrast(?:ing)? )?cuffs?\b/.test(text);
  if (noCuffs && optionsOf(product).cuffs) {
    product = withOptions(product, { ...optionsOf(product), cuffs: false });
    garment.push('cuffs removed');
  } else if (!noCuffs && cuffed && product.base === 'tee' && !optionsOf(product).cuffs) {
    if (cuffsAllowed(product, optionsOf(product))) {
      product = withOptions(product, { ...optionsOf(product), cuffs: true });
      garment.push('buttoned cuffs added');
    } else notApplied.push(`cuffs (they go on a long-sleeved shirt${optionsOf(product).buttons ? `: make the sleeves at least ${CUFFED_SLEEVE} cm` : ', with a button front'})`);
  }
  if (take(/\bcontrast(?:ing)? cuffs?\b/) && optionsOf(product).cuffs && product.base === 'tee') {
    // Contrast cuffs without a colour named: white, or navy on a white shirt.
    const contrast = product.parts.sleeveLeft.color.toLowerCase() === '#f7f7f4' ? '#1f2a4f' : '#f7f7f4';
    product.parts = { ...product.parts, cuffLeft: { ...product.parts.cuffLeft, color: contrast }, cuffRight: { ...product.parts.cuffRight, color: contrast } };
    garment.push('contrast cuffs');
  }
  // A coat's lapels: added by naming them ("notched lapels", "satin lapels", which also styles them), taken off with
  // "no lapels". They go on a coat or blazer only. They are notched unless named peak lapels, whose points rise above
  // the collar; "no peak lapels" makes them notched again.
  const noPeak = !!take(/\b(?:no|without) peak(?:ed)? lapels?\b/);
  const noLapels = !!take(/\b(?:no|without) (?:notched )?lapels?\b/), wantsLapels = !noLapels && /\blapels?\b/.test(text);
  const peaked = !!take(/\bpeak(?:ed)?(?= lapels?\b)/), notched = noPeak || !!take(/\bnotch(?:ed)?(?= lapels?\b)/);
  if (noLapels && optionsOf(product).lapels) {
    product = withOptions(product, { ...optionsOf(product), lapels: false });
    garment.push('lapels removed: buttoned up to the collar');
  } else if ((wantsLapels || noPeak) && optionsOf(product).lapels && peaked !== !!optionsOf(product).peakLapels && (peaked || notched)) {
    const others = { ...optionsOf(product) };
    delete others.peakLapels;
    product = withOptions(product, { ...others, ...(peaked ? { peakLapels: true } : {}) });
    garment.push(peaked ? 'peak lapels' : 'notched lapels');
  } else if (wantsLapels && !optionsOf(product).lapels) {
    if (lapelsAllowed(product, optionsOf(product))) {
      product = withOptions(product, { ...optionsOf(product), lapels: true, ...(peaked ? { peakLapels: true } : {}) });
      garment.push(`${peaked ? 'peak' : 'notched'} lapels added`);
    } else {
      notApplied.push(`lapels (they go on a coat or blazer, not a ${garmentName(product).toLowerCase()})`);
      while (take(/\blapels?\b/));
    }
  }
  // A coat's lining: added by naming it ("lined", "a red lining", which also styles it), taken off with "unlined" or
  // "no lining". It goes in a coat or blazer only.
  const noLining = !!take(/\b(?:unlined|(?:no|without)(?: a)? linings?)\b/), wantsLining = !noLining && /\b(?:lined|linings?)\b/.test(text);
  take(/\b(?:fully )?lined\b/);
  if (noLining && optionsOf(product).lining) {
    product = withOptions(product, { ...optionsOf(product), lining: false });
    garment.push('lining removed: the seams are bound');
  } else if (wantsLining && !optionsOf(product).lining) {
    if (liningAllowed(product, optionsOf(product))) {
      product = withOptions(product, { ...optionsOf(product), lining: true });
      garment.push('lined');
    } else {
      notApplied.push(`a lining (it goes in a coat or blazer, not a ${garmentName(product).toLowerCase()})`);
      while (take(/\blinings?\b/));
    }
  }
  const noPocket = take(/\b(no|without (?:a )?)(?: chest)? pockets?\b/);
  const pocket = noPocket ? false : /\bchest pockets?\b/.test(text) || (product.base !== 'hoodie' && /(?<!back )\bpockets?\b/.test(text) && top) ? true : null;
  if (pocket !== null) {
    if (pocket && !chestPocketAllowed(product.base)) notApplied.push(product.base === 'hoodie' ? 'chest pocket (a hoodie has a kangaroo pocket)' : 'chest pocket (goes on a top)');
    else {
      const had = optionsOf(product).chestPocket;
      product = withOptions(product, { ...optionsOf(product), chestPocket: pocket });
      garment.push(pocket ? (had ? 'chest pocket' : 'chest pocket added') : (had ? 'chest pocket removed' : 'no chest pocket'));
    }
  }
  // Trousers' front scoop pockets: added by naming them ("front pockets", "scoop pockets"), taken off with "no front
  // pockets" (or "no pockets"). On a top, a front pocket is its chest pocket (above).
  if (product.base === 'trousers') {
    const noFrontPockets = !!take(/\b(?:no|without) (?:front|scoop) pockets?\b/) || !!noPocket;
    if (noFrontPockets && optionsOf(product).frontPockets) {
      product = withOptions(product, { ...optionsOf(product), frontPockets: false });
      garment.push('front pockets removed');
    } else if (!noFrontPockets && /\b(?:front|scoop) pockets?\b/.test(text) && !optionsOf(product).frontPockets) {
      product = withOptions(product, { ...optionsOf(product), frontPockets: true });
      garment.push('front pockets added');
    }
  }
  // Trousers' fly front: added by naming it ("zip fly", "button fly", "fly front"), or belt loops, which need its
  // buttoned waistband; an elasticated or pull-on waist, or "no fly", takes it off, and its belt loops with it. Belt
  // loops come off alone with "no belt loops".
  if (product.base === 'trousers') {
    const noLoops = !!take(/\b(?:no|without) belt loops?\b/), noFly = !!take(/\b(?:no|without) (?:zip )?fly\b/) || /\belastic(?:ated)? waist(?:band)?\b|\bpull-on\b/.test(text);
    const wantsLoops = !noLoops && !noFly && /\bbelt loops?\b/.test(text), wantsFly = !noFly && (wantsLoops || /\b(?:zip |button )?fly(?: front)?\b/.test(text));
    const now = optionsOf(product);
    if (noFly && now.fly) {
      product = withOptions(product, { ...now, fly: false, beltLoops: false });
      garment.push(now.beltLoops ? 'fly front and belt loops removed: elasticated waist' : 'fly front removed: elasticated waist');
    } else if (wantsFly && (!now.fly || (wantsLoops && !now.beltLoops))) {
      product = withOptions(product, { ...now, fly: true, ...(wantsLoops || now.beltLoops ? { beltLoops: true } : {}) });
      garment.push(wantsLoops && !now.fly ? 'fly front and belt loops added: buttoned waistband' : wantsLoops ? 'belt loops added' : 'fly front added: buttoned waistband');
    }
    if (noLoops && optionsOf(product).beltLoops) {
      product = withOptions(product, { ...optionsOf(product), beltLoops: false });
      garment.push('belt loops removed');
    }
  } else if (/\bbelt loops?\b|\b(?:zip|button) fly\b|\bfly front\b/.test(text)) notApplied.push(`fly front and belt loops (they go on trousers or shorts, not a ${garmentName(product).toLowerCase()})`);
  // Trousers' back patch pockets: added by naming them ("back pockets", "white pockets"), taken off with "no back pockets"
  // (or "no pockets").
  const noBackPockets = !!take(/\b(?:no|without) back pockets?\b/) || (!!noPocket && product.base === 'trousers');
  const backPocketed = /\bback pockets?\b/.test(text) || (product.base === 'trousers' && /(?<!chest |kangaroo |front |scoop )\bpockets?\b/.test(text));
  if (noBackPockets && optionsOf(product).backPockets) {
    product = withOptions(product, { ...optionsOf(product), backPockets: false });
    garment.push('back pockets removed');
  } else if (!noBackPockets && backPocketed && !optionsOf(product).backPockets) {
    if (backPocketsAllowed(product.base)) {
      product = withOptions(product, { ...optionsOf(product), backPockets: true });
      garment.push('back pockets added');
    } else notApplied.push(`back pockets (they go on trousers or shorts, not a ${garmentName(product).toLowerCase()})`);
  }

  let skirtFitPreset: 'pencil' | 'straight' | null = null;
  // Fit sets sizes against the base's reference measurements, so describing the same fit twice changes nothing more.
  if (top) {
    // A shaped waist is read before "fitted" alone, which sets the chest: "a fitted waist" shapes the side seams.
    const waisted = take(/\b(?:fitted|shaped|tapered|nipped(?:[- ]in)?|cinched|defined) waist\b|\bwaisted\b/), straightSides = take(/\bstraight side(?: seam)?s\b|\bno waist shaping\b/);
    const unseamed = take(/\b(?:no|without a) waist seam\b/), seamed = take(/\bwaist seam\b/);
    // A dress skirt is gathered into its waist seam, not pleated (only skirts are pleated).
    const pleatedDress = optionsOf(product).waistSeam || /dress/.test(garmentName(product).toLowerCase()) ? take(/\b(?:knife[- ]|box[- ])?pleat(?:ed|s)?(?: skirt)?\b/) : null;
    if (pleatedDress) notApplied.push(`${pleatedDress[0]} (a dress skirt can be gathered into its waist seam, not pleated; skirts are pleated)`);
    const gatheredSkirt = take(/\b(?:gathered|dirndl) (?:skirt|waist)s?\b|\bdirndl\b/) ?? gatheredDress;
    const smoothSkirt = !gatheredSkirt && take(/\b(?:smooth|ungathered) skirt\b/);
    const puffed = take(/\b(?:puff(?:ed|y)?|balloon|gathered) sleeves?\b/), plainSleeves = !puffed && take(/\b(?:plain|flat|unpuffed|ungathered) sleeves?\b|\bno puff sleeves?\b/);
    // Waist darts shape a dress's bodice at the waist; bust darts shape the front over the bust.
    const unwaisted = take(/\b(?:no|without) (?:waist|fisheye|double[- ]pointed|contour) darts\b/), waistDarted = !unwaisted && take(/\b(?:waist|fisheye|double[- ]pointed|contour) darts?\b/);
    const undarted = take(/\b(?:no|without)(?: side)?(?: bust)? darts\b|\bundarted\b/), dartedFront = !undarted && take(/\b(?:side )?(?:bust )?darts?\b|\bdarted\b/);
    const chest = take(/\b(oversized|boxy|baggy)(?: fit)?\b/) ? 12 : take(/\b(relaxed|loose)(?: fit)?\b/) ? 6 : take(/\b(slim|fitted(?! hip\b))(?: fit)?\b/) ? -6 : take(/\b(regular|classic)(?: fit)\b/) ? 0 : null;
    const cropped = take(/\bcropped\b/);
    const m = topMeasurements(product), r = topMeasurements(reference), next = { ...m };
    if (chest !== null) next.chest = clampTo(LIMITS.chest as readonly [number, number], r.chest + chest);
    // Cropped ends above the waist, as crop tops do.
    if (cropped) next.length = clampTo(LIMITS.length as readonly [number, number], Math.min(m.length, r.length - 20));
    if (chest !== null) garment.push(`fit: ${next.chest} cm chest`);
    if (cropped) garment.push(`cropped: ${next.length} cm length`);
    product.measurements = next;
    if (undarted && next.bustDart) {
      const rest = { ...next };
      delete rest.bustDart;
      product.measurements = rest;
      garment.push('no bust darts');
    } else if (dartedFront && product.base !== 'tee') notApplied.push(`${dartedFront[0]} (bust darts go on T-shirts, shirts, coats and tee dresses; a knit sweatshirt or hoodie is shaped by its stretch)`);
    else if (dartedFront && !next.bustDart) {
      product.measurements = { ...next, bustDart: DEFAULT_BUST_DART };
      garment.push(`bust darts: ${DEFAULT_BUST_DART} cm taken in at each side seam`);
    }
    // Waist darts rise from a dress's waist seam, or run through the waist of a top in one piece that reaches below it.
    if ((unwaisted || undarted) && topMeasurements(product).waistDart) {
      const rest = { ...topMeasurements(product) };
      delete rest.waistDart;
      product.measurements = rest;
      garment.push('no waist darts');
    } else if (waistDarted && product.base !== 'tee') notApplied.push(`${waistDarted[0]} (waist darts go on T-shirts, shirts, coats and tee dresses; a knit sweatshirt or hoodie is shaped by its stretch)`);
    else if (waistDarted && !waistDartsAllowed(product)) notApplied.push(`${waistDarted[0]} (they need the top to reach at least ${FISHEYE_MIN_BELOW_CM} cm below its waist)`);
    else if (waistDarted && !topMeasurements(product).waistDart) {
      product.measurements = { ...topMeasurements(product), waistDart: DEFAULT_WAIST_DART };
      garment.push(`waist darts: ${DEFAULT_WAIST_DART} cm taken in by each, two in front and two at the back${optionsOf(product).waistSeam ? '' : ', pointed at both ends through the waist'}`);
    }
    // A fitted waist takes 8 cm off each side of the front and back at the waist (16 cm round), from this chest.
    if (straightSides && product.fit && WAIST_FIT_KEYS.some(key => product.fit![key] !== undefined)) {
      const rest = { ...product.fit };
      for (const key of WAIST_FIT_KEYS) delete rest[key];
      if (Object.keys(rest).length) product.fit = rest; else delete product.fit;
      garment.push('straight side seams: no waist shaping');
    } else if (straightSides) garment.push('straight side seams');
    if (waisted && !waistShapeable(product)) notApplied.push(`${waisted[0]} (only T-shirts, shirts and tee dresses are shaped at the waist)`);
    else if (waisted) {
      const width = Math.round((next.chest / 2 + 2 - 8) * 2) / 2;
      product.fit = { ...product.fit, waistWidth: width };
      garment.push(`fitted waist: ${width} cm waist width (½)`);
    }
    // A waist seam cuts a dress into a bodice and a skirt, each styled on its own.
    if (unseamed && optionsOf(product).waistSeam) {
      const modules = { ...optionsOf(product) };
      delete modules.waistSeam;
      product = withOptions(product, modules);
      garment.push('no waist seam: the body is cut in one piece');
    } else if (seamed && !waistSeamAllowed(product)) notApplied.push(`waist seam (it goes on a dress at least ${DRESS_LENGTH} cm long)`);
    else if (seamed && !optionsOf(product).waistSeam) {
      product = withOptions(product, { ...optionsOf(product), waistSeam: true });
      garment.push('waist seam: a bodice and a skirt');
    }
    // A gathered skirt hangs from a waist seam, its waist edge cut one and a half times the seam and gathered into it.
    // As gathered skirts are cut, its hem is widened to that edge when narrower, within the hem's limit.
    if (gatheredSkirt && !unseamed && product.base === 'tee' && !optionsOf(product).waistSeam && waistSeamAllowed(product)) {
      product = withOptions(product, { ...optionsOf(product), waistSeam: true });
      garment.push('waist seam: a bodice and a skirt');
    }
    if (gatheredSkirt && (product.base !== 'tee' || !optionsOf(product).waistSeam)) {
      notApplied.push(`${gatheredSkirt[0]}${gatheredSkirt === gatheredDress ? ' dress' : ''} (a gathered skirt goes on a T-shirt dress at least ${DRESS_LENGTH} cm long, cut at the waist)`);
    } else if (gatheredSkirt) {
      // A straight side seam would move out with a wider hem, so the waist keeps its width as the hem is widened, taken
      // in to the chest's width where a flared hem had let it out wider.
      const d = teeDimensions(product), hem = 2 * d.hemHalf;
      const seam = product.fit?.waistWidth ?? Math.min(Math.round(2 * seamHalfAt(d, d.waistY) * 2) / 2, Math.floor(4 * d.half) / 2);
      const gather = Math.min(1.5, Math.floor(Math.max(hem, LIMITS.fit.hemWidth[1]) / seam * 20) / 20);
      if (gather < DRESS_GATHER[0]) notApplied.push(`${gatheredSkirt[0]} (this waist seam is too wide to gather)`);
      else {
        const edge = Math.ceil(seam * gather * 2) / 2, widened = edge > hem + 1e-9;
        product.measurements = { ...topMeasurements(product), gather };
        product.fit = { ...product.fit, waistWidth: product.fit?.waistWidth ?? seam, ...(widened ? { hemWidth: edge } : {}) };
        garment.push(`gathered skirt: ${gather} times the waist seam${widened ? `, hem widened to ${edge} cm (½)` : ''}`);
      }
    } else if (smoothSkirt && topMeasurements(product).gather) {
      const smooth = { ...topMeasurements(product) };
      delete smooth.gather;
      product.measurements = smooth;
      garment.push('smooth skirt: no gathers');
    }
    // Puff sleeves: each cap is cut one and a half times its armhole and gathered into it.
    if (puffed && (product.base !== 'tee' || topMeasurements(product).sleeve === 0)) {
      notApplied.push(`${puffed[0]} (${product.base !== 'tee' ? 'they go on T-shirts, shirts and tee dresses' : 'a sleeveless top has no sleeves'})`);
    } else if (puffed) {
      product.measurements = { ...topMeasurements(product), sleeveGather: 1.5 };
      garment.push('puff sleeves: each cap cut 1.5 times its armhole and gathered into it');
    } else if (plainSleeves && topMeasurements(product).sleeveGather) {
      const plain = { ...topMeasurements(product) };
      delete plain.sleeveGather;
      product.measurements = plain;
      garment.push('plain sleeves: no gathers at the cap');
    }
  } else if (product.base === 'trousers') {
    const m = legMeasurements(product), r = legMeasurements(reference), next = { ...m };
    const widest = Math.min(LIMITS.legOpening[1], Math.floor(m.hip * 0.8));
    const leg = take(/\bwide[- ]leg(?:ged)?\b|\bwide\b/) ? r.legOpening + 16 : take(/\b(slim|skinny|tapered)(?:[- ]leg(?:ged)?| fit)?\b/) ? r.legOpening - 10
      : take(/\bstraight[- ]leg(?:ged)?\b/) ? r.legOpening : null;
    if (leg !== null) { next.legOpening = Math.min(widest, Math.max(LIMITS.legOpening[0], leg)); garment.push(`leg opening: ${next.legOpening} cm`); }
    if (take(/\bcropped\b/)) { next.inseam = 58; garment.push('cropped: 58 cm inseam'); }
    product.measurements = next;
  } else if (product.base === 'skirt') {
    // Gathering keeps the panels flaring: the cut waist edge stays 10 cm shorter than the hem. Pleats replace gathers:
    // knife pleats about 3 cm apart, box pleats about 6 cm wide, each folded half as deep as it can be.
    const gathered = take(/\b(?:gathered|dirndl)(?: waist)?\b/), smooth = !gathered && take(/\b(?:smooth|flat|ungathered)(?: waist)?\b/);
    // A pencil, straight or fitted skirt follows the hip (about a third more than the waist), a pencil skirt narrowing
    // to its hem.
    const pencil = take(/\b(?:pencil|wiggle|hobble)\b/), straight = !pencil && take(/\b(?:straight|fitted(?! hip\b)|tailored|tight)\b/), flowing = !pencil && !straight && take(/\b(?:flared|flowing|a-?line|circle)\b/);
    const plain = take(/\b(?:unpleated|no pleats|without pleats)\b/), boxed = !plain && take(/\bbox[- ]?pleat(?:ed|s)?\b/);
    const knife = !plain && !boxed && take(/\b(?:knife[- ]?)?pleat(?:ed|s)\b/);
    const m = product.measurements as SkirtMeasures, bare: SkirtMeasures = { ...m };
    delete bare.pleats; delete bare.gather;
    if (gathered) {
      const most = Math.floor((m.hem - 10) / m.waist * 20) / 20, gather = Math.min(1.5, most);
      if (gather >= GATHER[0]) { product.measurements = { ...bare, gather }; garment.push(`gathered waist: ${gather} times the waist`); }
      else notApplied.push('gathered waist (the hem is too narrow to gather this waist)');
    } else if (boxed || knife) {
      const style: PleatStyle = boxed ? 'box' : 'knife', count = Math.max(PLEAT_COUNT[0], Math.min(PLEAT_COUNT[1], 2 * Math.round(m.waist / (boxed ? 12 : 6))));
      const depth = Math.max(PLEAT_DEPTH[0], Math.floor(pleatDepthLimit(style, count, m.waist) / 2 * 10) / 10);
      try { product.measurements = validateSkirtMeasures({ ...bare, pleats: { style, count, depth } }); garment.push(`${style} pleats: ${count}, folded ${depth} cm deep at the waist`); }
      catch { notApplied.push(`${style} pleats (this skirt flares too much to pleat)`); }
    } else if (smooth && m.gather) {
      product.measurements = bare; garment.push('smooth waist: no gathers');
    } else if (plain && m.pleats) {
      product.measurements = { ...bare, ...(m.gather ? { gather: m.gather } : {}) }; garment.push('no pleats');
    }
    if (pencil || straight) {
      // Wait for explicit dimensions before judging the fitted geometry.
      skirtFitPreset = pencil ? 'pencil' : 'straight';
    } else if (flowing && (product.measurements as SkirtMeasures).hip !== undefined) {
      const flared: SkirtMeasures = { ...(product.measurements as SkirtMeasures) }; delete flared.hip;
      product.measurements = flared; garment.push('flared skirt: no longer fitted');
    }
  }

  // Explicit garment dimensions override rough fit presets. Only a named measurement next to a unit is read;
  // a print repeat such as "stripes 6 cm" remains with the style interpreter.
  const labels = [...Object.keys(TOP_FIT_LABELS), 'waistband(?: height)?|ankle cuffs?(?: height)?|fitted hip|leg opening|sleeve length|sleeves?|chest|length|waist|hip|inseam|rise|hem|slant'].join('|');
  const number = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
  const measured = new RegExp(`\\b(${labels})\\s*(?:of|:|=)?\\s*(${number})\\s*(cm|mm)\\b|(?<![\\w.+-])(?<!\\d,)(${number})\\s*(cm|mm)\\s+(${labels})\\b`, 'g');
  const values = new Map<string, number>(), fitValues = new Map<FitKey, number>();
  const measuredParts: { start: number; parts: PartId[] }[] = [];
  const supported = new Set(top ? ['chest', 'length', 'sleeve'] : product.base === 'trousers'
    ? ['waist', 'hip', 'inseam', 'rise', 'legOpening', 'ankle cuff height']
    : ['waist', 'hem', 'slant', 'waistband height', ...(skirtFitPreset || (product.measurements as SkirtMeasures).hip !== undefined ? ['hip'] : [])]);
  for (const match of text.matchAll(measured)) {
    const label = match[1] ?? match[6], raw = match[2] ?? match[4], unit = match[3] ?? match[5];
    // On skirts, "hem width" still describes the full hem, as in the existing hem measurement.
    const key = label.startsWith('sleeve') ? 'sleeve' : label === 'leg opening' ? 'legOpening'
      : label === 'hem width' && supported.has('hem') ? 'hem'
      : label === 'fitted hip' && product.base === 'skirt' ? 'hip' : label.startsWith('waistband') ? 'waistband height'
      : label.startsWith('ankle cuff') ? 'ankle cuff height' : label;
    // Convert the written decimal in one step so equivalent cm and mm values compare equally.
    const value = Number(unit === 'mm' ? `${raw}e-1` : raw);
    const fit = TOP_FIT_LABELS[label];
    if (fit && top) {
      if (fitValues.has(fit) && fitValues.get(fit) !== value) throw new Error(`Conflicting ${label} measurements. Give one value in cm or mm.`);
      fitValues.set(fit, value);
    } else if (!supported.has(key)) { notApplied.push(`${match[0]} (not a supported measurement on this garment)`); }
    else {
      if (values.has(key) && values.get(key) !== value) throw new Error(`Conflicting ${label} measurements. Give one value in cm or mm.`);
      values.set(key, value);
    }
    const start = match.index!;
    // A measured trim scopes adjacent styling to that trim, even if it was removed or the height is unsupported.
    if (key === 'waistband height') measuredParts.push({ start, parts: ['waistband'] });
    if (key === 'ankle cuff height') measuredParts.push({ start, parts: ['cuffLeft', 'cuffRight'] });
    const remaining = key === 'sleeve' && supported.has(key) ? 'sleeves' : '';
    text = text.slice(0, start) + remaining.padEnd(match[0].length) + text.slice(start + match[0].length);
  }
  if (skirtFitPreset) {
    const m = product.measurements as SkirtMeasures, fitted: SkirtMeasures = { ...m };
    delete fitted.gather; delete fitted.pleats;
    const waist = values.get('waist') ?? m.waist, hip = values.get('hip') ?? m.hip ?? Math.round(waist * 1.36);
    const hem = values.get('hem') ?? (skirtFitPreset === 'pencil' ? hip - 6 : hip);
    const slant = values.get('slant') ?? Math.max(m.slant, 40);
    try {
      product.measurements = validateSkirtMeasures({ ...fitted, waist, hip, hem, slant });
      keepArtworkInside(product);
      garment.push(`${skirtFitPreset} skirt: fitted to a ${hip} cm hip with darts, ${hem} cm hem`);
    } catch (error) {
      if (['waist', 'hip', 'hem', 'slant'].some(key => values.has(key))) throw error;
      notApplied.push(`${skirtFitPreset} skirt (this waist cannot be fitted)`);
    }
  }
  if (values.size) {
    const { 'waistband height': waistband, 'ankle cuff height': cuff, ...dimensions } = Object.fromEntries(values);
    product.measurements = { ...product.measurements, ...dimensions } as Product['measurements'];
    keepArtworkInside(product);
    // These change the available parts as well as the measurements. Apply after merging the other dimensions.
    if (waistband !== undefined) product = withSkirtWaistband(product, waistband);
    if (cuff !== undefined) product = withLegCuffs(product, cuff);
    if (top && values.has('sleeve')) product = withSleeveLength(product, values.get('sleeve')!);
    for (const [key, value] of values) garment.push(`${key === 'legOpening' ? 'leg opening' : key}: ${value} cm`);
  }

  if (fitValues.size) {
    product.fit = { ...product.fit, ...Object.fromEntries(fitValues) };
    for (const [key, value] of fitValues) garment.push(`${FIT_NAMES[key].toLowerCase()}: ${value} cm`);
    // A narrower sleeve or armhole moves the sleeves' artwork to stay on them.
    keepArtworkInside(product);
  }
  if (values.size || fitValues.size) product = validateProduct(product);

  // Clauses: a clause that names parts styles them; the others are read together as the whole garment's style.
  const available = new Set(partsOf(product));
  let clauseStart = 0;
  const clauses = text.split(/(,|;|\band\b|\bwith\b|\bbut\b|\bplus\b)/).flatMap((clause, index) => {
    const start = clauseStart;
    clauseStart += clause.length;
    if (index % 2) return [];
    let words = clause, parts: PartId[] = [];
    const named: string[] = [];
    for (const [pattern, resolve] of PART_WORDS) {
      for (let match; (match = pattern.exec(words));) {
        words = words.slice(0, match.index) + ' '.repeat(match[0].length) + words.slice(match.index + match[0].length);
        named.push(match[0]);
        parts.push(...resolve(available));
      }
    }
    const measured = words.trim() ? measuredParts.filter(item => item.start >= start && item.start < clauseStart) : [];
    parts.push(...measured.flatMap(item => item.parts));
    // A part word for a part this garment does not have ("skirt" on a dress not cut at the waist) is reported with its
    // words rather than dropped.
    if (named.length && !parts.length) {
      const dressSkirt = named.some(word => /skirt|bodice/.test(word)) && product.base === 'tee';
      notApplied.push(`${clause.replace(/\s+/g, ' ').trim()} (${dressSkirt ? 'a dress has a separate skirt and bodice when cut at the waist: say “waist seam”' : `not on this ${garmentName(product).toLowerCase()}`})`);
      return [];
    }
    const missing = parts.filter(id => !available.has(id));
    for (const id of new Set(missing)) if (!notApplied.some(item => item.startsWith(PART_NAMES[id].toLowerCase()))) notApplied.push(`${PART_NAMES[id].toLowerCase()} (not on this ${BASE_NAMES[product.base].toLowerCase()})`);
    parts = [...new Set(parts.filter(id => available.has(id)))];
    return [{ words: words.trim(), parts, named: named.length > 0 || measured.length > 0, explicit: named.length > 0 }];
  });
  const stylesSomething = (words: string) => !!words && readStylePrompt(words, product.parts.front, { allowUnapplied: true }).understood.length > 0;
  // "Navy sleeves and cuffs": a part clause without style words takes the next part clause's words, else the previous.
  clauses.forEach((clause, index) => {
    if (!clause.explicit || stylesSomething(clause.words)) return;
    const later = clauses.slice(index + 1).find(other => other.named && stylesSomething(other.words));
    const earlier = clauses.slice(0, index).reverse().find(other => other.named && stylesSomething(other.words));
    const donor = later ?? earlier;
    if (donor) { donor.parts = [...new Set([...donor.parts, ...clause.parts])]; clause.parts = []; }
  });

  const scopes: DesignScope[] = [], ignored: string[] = [];
  if (garment.length) scopes.push({ label: 'Garment', understood: garment });
  const whole = clauses.filter(clause => !clause.named).map(clause => clause.words).filter(Boolean).join(' and ');
  if (whole) {
    // Like "Use this style on every part": rib trims keep their rib knit and stay plain.
    const readings = [...available].map(id => [id, readStylePrompt(whole, product.parts[id], { allowUnapplied: true })] as const);
    const understood = readings.find(([, reading]) => reading.understood.length)?.[1];
    if (understood) {
      for (const [id, reading] of readings) {
        product.parts[id] = RIB_PARTS.has(id) || id === 'waistband' ? { ...product.parts[id], material: product.parts[id].material, color: reading.style.color, print: null } : reading.style;
      }
      scopes.push({ label: 'Whole garment', understood: understood.understood });
    }
    ignored.push(...(understood ?? readings[0]![1]).ignored);
  }
  for (const clause of clauses.filter(other => other.named && other.parts.length)) {
    if (!clause.words) continue;
    let understood: string[] = [];
    for (const id of clause.parts) {
      const reading = readStylePrompt(clause.words, product.parts[id], { allowUnapplied: true });
      if (!reading.understood.length) continue;
      product.parts[id] = reading.style;
      understood = reading.understood;
    }
    const reading = readStylePrompt(clause.words, product.parts[clause.parts[0]!], { allowUnapplied: true });
    ignored.push(...reading.ignored);
    if (understood.length) scopes.push({ label: clause.parts.map(id => partName(product, id)).join(', '), understood });
  }
  let printed: TextRequest | undefined;
  if (slogan && isSleeveArtwork(slogan.request.side) && (isBottoms(product) || !partsOf(product).includes(slogan.request.side))) {
    // Text for a sleeve on a garment without sleeves says why it was left off.
    notApplied.push(`text “${slogan.request.text}” on ${textPlace(slogan.request)} (${isBottoms(product) ? `${garmentName(product).toLowerCase()} have` : 'a sleeveless top has'} no sleeves)`);
  } else if (slogan) {
    printed = { ...slogan.request, color: slogan.request.color ?? contrastingInk(product.parts.front.color) };
    scopes.push({ label: 'Artwork', understood: [`text “${printed.text}” on ${textPlace(printed)}`] });
  }
  for (const item of notApplied) ignored.push(item);
  if (!scopes.length) {
    // Words that were understood but cannot apply to this design say why.
    if (notApplied.length) throw new Error(`Nothing in “${prompt.trim().slice(0, 60)}” could be applied: ${notApplied.join('; ')}.`);
    throw new Error(`Nothing in “${prompt.trim().slice(0, 60)}” could be applied. Try a garment, part, fabric, colour or print, for example "white tee with navy sleeves".`);
  }
  return { product: validateProduct(product), scopes, ignored: [...new Set(ignored)], ...(printed ? { text: printed } : {}) };
}
