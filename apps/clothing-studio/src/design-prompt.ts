// "Describe a design": a local, deterministic reading of a whole-garment description ("oversized navy hoodie with
// a cream hood and white cuffs") into edits of the design. Garment words choose the base product, neckline, sleeve
// length, hem, chest pocket and fit; clauses that name a part ("cream hood") style that part; everything else styles
// the whole garment. Each change is reported with its scope, and words that were not understood are listed. Style
// words are read by the part-level interpreter in style-prompt.ts. No network and no model.
import { readStylePrompt } from './style-prompt.ts';
import {
  BASE_NAMES, LIMITS, PART_NAMES, RIB_PARTS, SLEEVE_PRESETS, chestPocketAllowed, hemAllowed, isBottoms, legMeasurements, optionsOf, partName, partsOf,
  template, topMeasurements, validateProduct, withOptions, type Base, type PartId, type Product,
} from './product.ts';

export interface DesignScope { label: string; understood: string[] }
export interface DesignReading { product: Product; scopes: DesignScope[]; ignored: string[] }

/** The template a garment word starts from, and its base. */
const GARMENTS: [RegExp, string, Base][] = [
  [/\b(hoodies?|hooded (?:sweatshirt|top|jumper))\b/, 'hoodie', 'hoodie'],
  [/\b(sweatshirts?|jumpers?|sweaters?|crew ?neck sweat(?:shirt)?s?)\b/, 'crew-sweat', 'sweatshirt'],
  [/\b(t-?shirts?|tees?)\b/, 'blank', 'tee'],
  [/\bshorts\b/, 'shorts', 'trousers'],
  [/\b(trousers|pants|joggers|chinos|jeans)\b/, 'trousers', 'trousers'],
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
  let text = fold(prompt).slice(0, 200);
  if (!text) throw new Error('Describe the garment, for example "oversized navy hoodie with a cream hood and white cuffs".');
  const garment: string[] = [], notApplied: string[] = [];
  // Garment words are blanked out once read, keeping positions, so they are not read again as style or part words.
  const take = (pattern: RegExp): RegExpExecArray | null => {
    const match = pattern.exec(text);
    if (match) text = text.slice(0, match.index) + ' '.repeat(match[0].length) + text.slice(match.index + match[0].length);
    return match;
  };

  // The garment: a different base starts from that base's template; shorts and trousers switch leg length.
  let product = structuredClone(current);
  for (const [pattern, id, base] of GARMENTS) {
    const match = take(pattern);
    if (!match) continue;
    if (base === 'trousers' && product.base === 'trousers') {
      const inseam = id === 'shorts' ? 18 : 78;
      product.measurements = { ...legMeasurements(product), inseam };
      garment.push(`${id === 'shorts' ? 'shorts' : 'full-length legs'}: ${inseam} cm inseam`);
    } else if (base === product.base) {
      garment.push(`garment: ${BASE_NAMES[base]}`);
    } else {
      // A new garment starts from its template; the design's spec and uploaded motifs stay with it.
      product = { ...template(id), ...(current.spec ? { spec: current.spec } : {}), ...(current.motifs ? { motifs: current.motifs } : {}) };
      garment.push(`garment: ${BASE_NAMES[base]}, started from its template`);
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
  const sleeve = take(/\blong[- ]sleeved?s?\b/) ? SLEEVE_PRESETS[2] : take(/\bshort[- ]sleeved?s?\b/) ? SLEEVE_PRESETS[0] : take(/\belbow[- ](?:length )?sleeved?s?\b/) ? SLEEVE_PRESETS[1] : null;
  if (sleeve) {
    if (!top) notApplied.push(`${sleeve.name.toLowerCase()} sleeves (no sleeves on ${BASE_NAMES[product.base].toLowerCase()})`);
    else { product.measurements = { ...topMeasurements(product), sleeve: sleeve.cm }; garment.push(`sleeves: ${sleeve.name.toLowerCase()} (${sleeve.cm} cm)`); }
  }
  const hem = take(/\b(curved|shirttail|shirt-tail) hem\b/) ? 'curved' : take(/\bstraight hem\b/) ? 'straight' : null;
  if (hem) {
    if (!top || !hemAllowed(product.base, hem)) notApplied.push(`${hem} hem (a ${BASE_NAMES[product.base].toLowerCase()} keeps its own hem)`);
    else { product = withOptions(product, { ...optionsOf(product), hem }); garment.push(`hem: ${hem === 'curved' ? 'curved shirttail' : 'straight'}`); }
  }
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
    if (cropped) next.length = clampTo(LIMITS.length as readonly [number, number], r.length - 10);
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
  for (const item of notApplied) ignored.push(item);
  if (!scopes.length) {
    throw new Error(`Nothing in “${prompt.trim().slice(0, 60)}” could be applied. Try a garment, part, fabric, colour or print, for example "white tee with navy sleeves".`);
  }
  return { product: validateProduct(product), scopes, ignored: [...new Set(ignored)] };
}
