// "Describe a design": a local, deterministic reading of a whole-garment description ("oversized navy hoodie with
// a cream hood and white cuffs") into edits of the design. Garment words choose the base product, neckline, sleeve
// length, hem, chest pocket and fit; clauses that name a part ("cream hood") style that part; everything else styles
// the whole garment. Each change is reported with its scope, and words that were not understood are listed. Style
// words are read by the part-level interpreter in style-prompt.ts. No network and no model.
import { readStylePrompt } from './style-prompt.ts';
import { contrastingInk, readSlogan, type TextRequest } from './text-artwork.ts';
import { GATHER, type SkirtMeasures } from './product-skirt.ts';
import {
  BASE_NAMES, DRESS_LENGTH, LIMITS, withSleeveLength, PART_NAMES, RIB_PARTS, SLEEVE_PRESETS, chestPocketAllowed, garmentName, hemAllowed, isBottoms, legMeasurements, optionsOf, partName, partsOf,
  template, topMeasurements, validateProduct, withLegCuffs, withOptions, type Base, type PartId, type Product,
} from './product.ts';

export interface DesignScope { label: string; understood: string[] }
export interface DesignReading { product: Product; scopes: DesignScope[]; ignored: string[]; /** Words in quotes, to print on the garment. */ text?: TextRequest }

/** The template a garment word starts from, and its base. */
const GARMENTS: [RegExp, string, Base][] = [
  // A tank top is a sleeveless tee, and a crop top a short one.
  [/\bcrop(?:ped)? tops?\b/, 'crop-top', 'tee'],
  [/\b(?:tank|vest|sleeveless) tops?\b|\btanks?\b|\bsinglets?\b/, 'blank', 'tee'],
  // Dresses are long tops; a plain "dress" keeps the current top's base.
  [/\b(?:hoodie|hooded) dress(?:es)?\b/, 'hoodie', 'hoodie'],
  [/\b(?:sweatshirt|sweat|jumper|sweater) dress(?:es)?\b/, 'sweat-dress', 'sweatshirt'],
  [/\b(?:t-?shirt|tee) dress(?:es)?\b/, 'tee-dress', 'tee'],
  [/\bdress(?:es)?\b/, 'tee-dress', 'tee'],
  [/\b(hoodies?|hooded (?:sweatshirt|top|jumper))\b/, 'hoodie', 'hoodie'],
  [/\b(sweatshirts?|jumpers?|sweaters?|crew ?neck sweat(?:shirt)?s?)\b/, 'crew-sweat', 'sweatshirt'],
  [/\bpolo(?: shirt)?s?\b/, 'polo', 'tee'],
  [/\b(t-?shirts?|tees?)\b/, 'blank', 'tee'],
  [/\bshorts\b/, 'shorts', 'trousers'],
  [/\b(joggers|sweat ?pants|track ?pants|jogging bottoms|track ?suit bottoms)\b/, 'joggers', 'trousers'],
  [/\b(trousers|pants|chinos|jeans)\b/, 'trousers', 'trousers'],
  [/\bskirts?\b/, 'flared-skirt', 'skirt'],
];

/** Part words, longest first; each names the parts it means on this design. */
const PART_WORDS: [RegExp, (parts: ReadonlySet<PartId>) => PartId[]][] = [
  [/\bleft sleeves?\b/, () => ['sleeveLeft']],
  [/\bright sleeves?\b/, () => ['sleeveRight']],
  [/\bleft cuffs?\b/, () => ['cuffLeft']],
  [/\bright cuffs?\b/, () => ['cuffRight']],
  [/\bchest pockets?\b/, () => ['chestPocket']],
  [/\b(kangaroo pockets?|pouch|pockets?)\b/, parts => [parts.has('pocket') ? 'pocket' : 'chestPocket']],
  [/\b(rib trims?|trims?)\b/, parts => ['neckband', 'cuffLeft', 'cuffRight', 'hemBand', 'waistband'].filter(id => parts.has(id as PartId)) as PartId[]],
  [/\b(hem ?bands?|hem ribs?|bottom bands?)\b/, () => ['hemBand']],
  [/\b(waist ?bands?)\b/, () => ['waistband']],
  [/\b(sleeves?|arms?)\b/, () => ['sleeveLeft', 'sleeveRight']],
  [/\bcuffs?\b/, () => ['cuffLeft', 'cuffRight']],
  [/\bhoods?\b/, () => ['hood']],
  [/\b(collars?|neck ?bands?|neck ribs?|necklines?|neck)\b/, () => ['neckband']],
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

  // The garment: a different base starts from that base's template; shorts and trousers switch leg length.
  let product = structuredClone(current);
  let tank = false;
  for (const [pattern, id, chosen] of GARMENTS) {
    const match = take(pattern);
    if (!match) continue;
    tank = id === 'blank' && /tank|vest|sleeveless|singlet/.test(match[0]);
    const dress = /dress/.test(match[0]);
    const base = dress && match[0].startsWith('dress') && !isBottoms(current) ? current.base : chosen;
    if (dress) {
      if (base !== product.base) product = { ...template(id), ...(current.spec ? { spec: current.spec } : {}), ...(current.motifs ? { motifs: current.motifs } : {}) };
      // Shoulder-to-hem lengths for a mid-height body: a mini ends at mid-thigh, a midi below the knee.
      const length = take(/\bmini\b/) ? DRESS_LENGTH : take(/\b(?:midi|mid[- ]calf|calf[- ]length)\b/) ? 115 : take(/\bknee[- ]length\b/) ? 100
        : Math.max(topMeasurements(product).length, base === 'tee' ? 100 : 92);
      const flared = template(base === 'tee' ? 'tee-dress' : 'sweat-dress').fit!.hemWidth!;
      product.measurements = { ...topMeasurements(product), length };
      if (product.fit?.hemWidth === undefined) product.fit = { ...product.fit, hemWidth: flared };
      garment.push(`garment: ${garmentName(product)}${base !== current.base ? ', started from its template' : ''}, ${length} cm long`);
      break;
    }
    if (base === 'trousers' && product.base === 'trousers') {
      const inseam = id === 'shorts' ? 18 : 78, cuffs = legMeasurements(product).cuffHeight;
      // Shorts lose ankle cuffs; joggers gain them.
      if (id === 'shorts' && cuffs) product = withLegCuffs(product, 0);
      product.measurements = { ...legMeasurements(product), inseam };
      garment.push(`${id === 'shorts' ? 'shorts' : 'full-length legs'}: ${inseam} cm inseam`);
      if (id === 'joggers' && !cuffs) {
        product = withLegCuffs(product, legMeasurements(template('joggers')).cuffHeight!);
        garment.push('ankle cuffs: joggers');
      }
    } else if (base === product.base && id === 'polo') {
      // A tee described as a polo keeps its styling and gains the collar and placket, on a round neck.
      product = withOptions({ ...product, neckline: 'crew' }, { ...optionsOf(product), collar: true });
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
  // A front zip ("zip hoodie", "zip-up", "full-zip"), or none ("pullover").
  const zipped = take(/\b(?:full[- ]?)?zip(?:ped|[- ]?(?:up|through))?\b/) ? true : take(/\bpull[- ]?over\b/) ? false : null;
  if (zipped !== null && product.base === 'hoodie') {
    const had = !!optionsOf(product).zip, others = { ...optionsOf(product) };
    delete others.zip;
    product = withOptions(product, zipped ? { ...others, zip: true } : others);
    // The garment as now named ("Zip hoodie, started from its template").
    for (let i = 0; i < garment.length; i++) garment[i] = garment[i]!.replace(BASE_NAMES.hoodie, garmentName(product));
    if (zipped !== had) garment.push(zipped ? 'front zip added' : 'front zip removed');
  } else if (zipped) notApplied.push(`front zip (only a hoodie has one, not a ${garmentName(product).toLowerCase()})`);
  const noPocket = take(/\b(no|without (?:a )?)(?: chest)? pockets?\b/);
  const pocket = noPocket ? false : /\bchest pockets?\b/.test(text) || (product.base !== 'hoodie' && /\bpockets?\b/.test(text) && top) ? true : null;
  if (pocket !== null) {
    if (pocket && !chestPocketAllowed(product.base)) notApplied.push(product.base === 'hoodie' ? 'chest pocket (a hoodie has a kangaroo pocket)' : 'chest pocket (goes on a top)');
    else {
      const had = optionsOf(product).chestPocket;
      product = withOptions(product, { ...optionsOf(product), chestPocket: pocket });
      garment.push(pocket ? (had ? 'chest pocket' : 'chest pocket added') : (had ? 'chest pocket removed' : 'no chest pocket'));
    }
  }

  // Fit sets sizes against the base's reference measurements, so describing the same fit twice changes nothing more.
  if (top) {
    const chest = take(/\b(oversized|boxy|baggy)(?: fit)?\b/) ? 12 : take(/\b(relaxed|loose)(?: fit)?\b/) ? 6 : take(/\b(slim|fitted)(?: fit)?\b/) ? -6 : take(/\b(regular|classic)(?: fit)\b/) ? 0 : null;
    const cropped = take(/\bcropped\b/);
    const m = topMeasurements(product), r = topMeasurements(reference), next = { ...m };
    if (chest !== null) next.chest = clampTo(LIMITS.chest as readonly [number, number], r.chest + chest);
    // Cropped ends above the waist, as crop tops do.
    if (cropped) next.length = clampTo(LIMITS.length as readonly [number, number], Math.min(m.length, r.length - 20));
    if (chest !== null) garment.push(`fit: ${next.chest} cm chest`);
    if (cropped) garment.push(`cropped: ${next.length} cm length`);
    product.measurements = next;
  } else if (product.base === 'trousers') {
    const m = legMeasurements(product), r = legMeasurements(reference), next = { ...m };
    const widest = Math.min(LIMITS.legOpening[1], Math.floor(m.hip * 0.8));
    const leg = take(/\bwide[- ]leg(?:ged)?\b|\bwide\b/) ? r.legOpening + 16 : take(/\b(slim|skinny|tapered)(?:[- ]leg(?:ged)?| fit)?\b/) ? r.legOpening - 10
      : take(/\bstraight[- ]leg(?:ged)?\b/) ? r.legOpening : null;
    if (leg !== null) { next.legOpening = Math.min(widest, Math.max(LIMITS.legOpening[0], leg)); garment.push(`leg opening: ${next.legOpening} cm`); }
    if (take(/\bcropped\b/)) { next.inseam = 58; garment.push('cropped: 58 cm inseam'); }
    product.measurements = next;
  } else if (product.base === 'skirt') {
    // Gathering keeps the panels flaring: the cut waist edge stays 10 cm shorter than the hem.
    const gathered = take(/\b(?:gathered|dirndl)(?: waist)?\b/), smooth = !gathered && take(/\b(?:smooth|flat|ungathered)(?: waist)?\b/);
    const m = product.measurements as SkirtMeasures;
    if (gathered) {
      const most = Math.floor((m.hem - 10) / m.waist * 20) / 20, gather = Math.min(1.5, most);
      if (gather >= GATHER[0]) { product.measurements = { ...m, gather }; garment.push(`gathered waist: ${gather} times the waist`); }
      else notApplied.push('gathered waist (the hem is too narrow to gather this waist)');
    } else if (smooth && m.gather) {
      const rest = { ...m }; delete rest.gather; product.measurements = rest; garment.push('smooth waist: no gathers');
    }
  }

  // Clauses: a clause that names parts styles them; the others are read together as the whole garment's style.
  const available = new Set(partsOf(product));
  const clauses = text.split(/,|;|\band\b|\bwith\b|\bbut\b|\bplus\b/).map(clause => {
    let words = clause, parts: PartId[] = [];
    const named: string[] = [];
    for (const [pattern, resolve] of PART_WORDS) {
      for (let match; (match = pattern.exec(words));) {
        words = words.slice(0, match.index) + ' '.repeat(match[0].length) + words.slice(match.index + match[0].length);
        named.push(match[0]);
        parts.push(...resolve(available));
      }
    }
    const missing = parts.filter(id => !available.has(id));
    for (const id of new Set(missing)) if (!notApplied.some(item => item.startsWith(PART_NAMES[id].toLowerCase()))) notApplied.push(`${PART_NAMES[id].toLowerCase()} (not on this ${BASE_NAMES[product.base].toLowerCase()})`);
    parts = [...new Set(parts.filter(id => available.has(id)))];
    return { words: words.trim(), parts, named: named.length > 0 };
  });
  const stylesSomething = (words: string) => !!words && readStylePrompt(words, product.parts.front, { allowUnapplied: true }).understood.length > 0;
  // "Navy sleeves and cuffs": a part clause without style words takes the next part clause's words, else the previous.
  clauses.forEach((clause, index) => {
    if (!clause.named || stylesSomething(clause.words)) return;
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
        product.parts[id] = RIB_PARTS.has(id) || id === 'waistband' ? { material: product.parts[id].material, color: reading.style.color, print: null } : reading.style;
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
  if (slogan && isBottoms(product)) notApplied.push(`text “${slogan.request.text}” (goes on a top)`);
  else if (slogan) {
    printed = { ...slogan.request, color: slogan.request.color ?? contrastingInk(product.parts.front.color) };
    scopes.push({ label: 'Artwork', understood: [`text “${printed.text}” on the ${printed.side}`] });
  }
  for (const item of notApplied) ignored.push(item);
  if (!scopes.length) {
    throw new Error(`Nothing in “${prompt.trim().slice(0, 60)}” could be applied. Try a garment, part, fabric, colour or print, for example "white tee with navy sleeves".`);
  }
  return { product: validateProduct(product), scopes, ignored: [...new Set(ignored)], ...(printed ? { text: printed } : {}) };
}
