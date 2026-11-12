import { buildOutfitBundle } from './outfit-bundle.ts';
import { replaceOutfitProduct, switchOutfitEditing, type OutfitLayer } from './outfit-edit.ts';
import { FITTED_HIP_DEPTH, GATHER, PLEAT_COUNT, PLEAT_DEPTH, pleatDepthLimit, skirtBandHeight, skirtDraft, skirtFit, skirtGather, skirtPleats, type PleatStyle } from './product-skirt.ts';
import {mountTopBodyProfiles} from './top-body-profiles-view.ts';
import {mountGarmentComparison} from './garment-comparison-view.ts';
import {placementFromSurface} from './artwork-placement.ts';
import { GARMENT_FRAMES, LONG_GARMENT_FRAMES, previewDrapeFrames, BODY_CHEST, BODY_WAIST, BODY_HIP, BODY_CHEST_DEPTH, BODY_HEIGHT, BODY_HIP_DEPTH, BODY_UPPER_ARM_GIRTH, BODY_NECK_GIRTH, BODY_UNDERBUST, canTuck, defaultBodyChest, garmentBody, outfitShape, threePiece, validateBodyChest, validateTopBodyShape, type GarmentDrapeResult } from './garment-drape.ts';
import { listDesigns, readDesign } from './design-library.ts';
import { gradedProduct, gradedOutfit } from './size-grades.ts';
import { decodeProductFile } from './media.ts';
// The product editor: start from a template, style each part in real-time 3D, place artwork, see the
// linked pattern pieces, and export renders or a 3D model. Every change is one undoable project edit.
import { onMotifImage, motifImage, paintTile } from './fabric-texture.ts';
import {
  WAISTBAND_CM, LAYOUTS, LAYOUT_NAMES, LIMITS, MATERIALS, MOTIFS, MOTIF_NAMES, RIB_PARTS, TEMPLATES, partsOf, HEMS, HEM_NAMES, SLEEVE_PRESETS, withSleeveLength,
  chestPocketAllowed, collarAllowed, buttonsAllowed, zipAllowed, hemAllowed, optionsOf, withOptions, withSkirtWaistband, withLegCuffs, LEG_PRESETS, FIT_KEYS, POCKET_FIT_KEYS, FIT_NAMES, flare, teeDimensions, type FitKey, isBottoms, canWearTogether, layerOrder, legMeasurements, partName, topMeasurements,
  CURRENCIES, SIZES, fitValues, material, printName, patternPieces, template, validateProduct, type Artwork, type Costing, type PartId, type Print, type PrintMotif, type Product, type Size,
} from './product.ts';
import { validateProject, type Project } from './model.ts';
import { buildTechPack, measurementDiagram, techPackHtml, techPackSections, techPackXlsx } from './techpack.ts';
import { patternDxf, patternSvg } from './pattern-export.ts';
import { readStylePrompt } from './style-prompt.ts';
import { paletteColorway, photoColours } from './photo-colours.ts';
import { readDesignPrompt } from './design-prompt.ts';
import { MAX_TEXT, TEXT_FONTS, renderText, textArtwork, type TextFont } from './text-artwork.ts';
import { drapeTestMarkup, mountDrapeTest } from './drape-test-view.ts';
import { costing, CURRENCY_SYMBOLS, DEFAULT_COSTING, nextColorwayId, rangePlan, rangePlanXlsx } from './range.ts';

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const PALETTE = ['#f4f2ec', '#1c1c1e', '#1f2a4f', '#3f5468', '#9fae91', '#d89476', '#b23a2e', '#e9c46a', '#efe8d8', '#7b6d8d'];
const DRAG_TYPE = 'application/x-clothing-swatch';
// Shorts and trousers: input id, label and LIMITS key of each leg measurement.
const LEG_FIELDS = [['product-waist', 'Waist, relaxed', 'waist'], ['product-hip', 'Hip', 'hip'], ['product-rise', 'Front rise', 'rise'],
  ['product-inseam', 'Inseam', 'inseam'], ['product-leg-opening', 'Leg opening', 'legOpening'], ['product-waistband-height', 'Waistband height', 'waistbandHeight']] as const;
const SKIRT_FIELDS = [['product-skirt-waist', 'Skirt waist', 'waist', 50, 150], ['product-skirt-hem', 'Skirt hem circumference', 'hem', 70, 300], ['product-skirt-slant', 'Skirt side seam slant', 'slant', 20, 120]] as const;
type Swatch = { kind: 'material'; id: string } | { kind: 'color'; value: string } | { kind: 'print'; motif: PrintMotif };

export const productMarkup = `<section class="panel product-panel" id="product-editor" aria-labelledby="product-heading">
  <div class="product-head"><div><p class="eyebrow">3D PRODUCT DESIGN</p><h3 id="product-heading">Style a garment in 3D</h3>
  <p>Start from a template, then drag fabrics, colors and prints onto any part of the garment, or select a part and choose from the library. Fabrics and prints render at real size.</p></div>
  <div class="product-name"><label class="field">Product name<input id="product-name" maxlength="80" autocomplete="off"></label></div></div>
  <div class="inline-actions"><button id="discard-product-drafts" class="quiet" disabled>Discard all product drafts</button><span id="product-draft-state" class="fine-print" role="status"></span></div>
  <div class="product-templates" role="list" aria-label="Templates">${TEMPLATES.map(t => `<div role="listitem"><button class="template-card" data-template="${t.id}" aria-label="Use the ${t.name} template: ${t.description}"><strong>${t.name}</strong><span>${t.description}</span></button></div>`).join('')}</div>
  <div class="product-grid">
    <aside class="product-library" aria-label="Library">
      <p class="eyebrow">FABRICS</p><div class="library-list" id="material-list">${MATERIALS.map(m => `<button class="library-swatch" draggable="true" data-swatch='${JSON.stringify({ kind: 'material', id: m.id })}' aria-label="Apply ${m.name}"><canvas width="44" height="44" data-material-preview="${m.id}" aria-hidden="true"></canvas><span>${m.name}<small>${m.gsm} gsm</small></span></button>`).join('')}</div>
      <p class="eyebrow">COLORS</p><div class="color-chips">${PALETTE.map(c => `<button class="color-chip" draggable="true" style="background:${c}" data-swatch='${JSON.stringify({ kind: 'color', value: c })}' aria-label="Apply color ${c}"></button>`).join('')}</div>
      <p class="eyebrow">FROM A PHOTO</p>
      <label class="button quiet file-button">Pick colours from a photo<input id="photo-colours-file" type="file" accept="image/png,image/jpeg,image/webp"></label>
      <div class="color-chips" id="photo-colours" role="group" aria-label="Colours from your photo"></div>
      <div class="inline-actions" id="photo-colour-actions" hidden><button id="apply-photo-colours">Use them on the garment</button><button id="clear-photo-colours" class="quiet">Remove photo colours</button></div>
      <p class="fine-print">A product shot, mood picture or fabric swatch. The photo is read on this device and not kept: only its main colours are saved with the design.</p>
      <p class="eyebrow">PRINTS</p><div class="library-list">${MOTIFS.map(m => `<button class="library-swatch" draggable="true" data-swatch='${JSON.stringify({ kind: 'print', motif: m })}' aria-label="Apply ${MOTIF_NAMES[m]} print"><canvas width="44" height="44" data-print-preview="${m}" aria-hidden="true"></canvas><span>${MOTIF_NAMES[m]}</span></button>`).join('')}</div>
      <div class="library-list" id="uploaded-motifs" aria-label="Your motifs"></div>
      <label class="button quiet file-button">Upload your own motif<input id="motif-file" type="file" accept="image/png,image/jpeg,image/webp"></label>
      <p class="fine-print">PNG, JPEG or WebP; transparent PNGs repeat best. It repeats in the chosen layout and size.</p>
      <p class="fine-print">Drag onto the garment, or select a part and click.</p>
    </aside>
    <div class="product-stage">
      <canvas id="product-canvas" aria-label="3D garment. Drag to orbit; click a part to select it." tabindex="0"></canvas>
      <div class="view-buttons" role="group" aria-label="Camera view">${['front', 'back', 'left', 'right'].map(v => `<button data-view="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div>
      <div class="drape-controls" id="garment-drape-controls"><label class="field">Body chest girth (cm)<input id="garment-drape-chest" type="number" min="${BODY_CHEST[0]}" max="${BODY_CHEST[1]}" step="1"></label>
        <details id="top-body-shape"><summary>Bust, waist, hip, depth, height, arms and neck (optional)</summary><div class="measure-grid"><label class="field">Underbust girth (cm, optional)<input id="garment-drape-underbust" type="number" min="${BODY_UNDERBUST[0]}" max="${BODY_UNDERBUST[1]}" step="0.1" aria-describedby="underbust-help"></label><p id="underbust-help" class="fine-print">For a body with a bust: measure just under the bust, and give the chest round the fullest part of the bust. Blank gives a body without a bust.</p><label class="field">Body waist girth (cm, optional)<input id="garment-drape-waist" type="number" min="${BODY_WAIST[0]}" max="${BODY_WAIST[1]}" step="0.1"></label><label class="field">Body hip girth (cm, optional)<input id="garment-drape-hip" type="number" min="${BODY_HIP[0]}" max="${BODY_HIP[1]}" step="0.1"></label><label class="field">Waist-to-hip depth (cm, optional)<input id="garment-drape-hip-depth" type="number" min="${BODY_HIP_DEPTH[0]}" max="${BODY_HIP_DEPTH[1]}" step="0.1"></label><label class="field">Body height (cm, optional)<input id="garment-drape-height" type="number" min="${BODY_HEIGHT[0]}" max="${BODY_HEIGHT[1]}" step="0.5"></label><label class="field">Upper-arm girth (cm, optional)<input id="garment-drape-arm-girth" type="number" min="${BODY_UPPER_ARM_GIRTH[0]}" max="${BODY_UPPER_ARM_GIRTH[1]}" step="0.1" aria-describedby="arm-girth-help"></label><p id="arm-girth-help" class="fine-print">Measure around the fullest upper arm. An entered girth is kept even if the sleeve is tight; blank uses automatic proportions that may narrow to the sleeve. Forearms, wrists, shoulder position and pose remain assumed. Fit is not validated.</p><label class="field">Neck girth (cm, optional)<input id="garment-drape-neck-girth" type="number" min="${BODY_NECK_GIRTH[0]}" max="${BODY_NECK_GIRTH[1]}" step="0.1" aria-describedby="neck-girth-help"></label><p id="neck-girth-help" class="fine-print">Measure around the base of the neck. This sets the circular neck on the top or shared outfit body without changing the garment neckline. Blank uses chest-based proportions; neck position, head and shoulders remain assumed. Fit is not validated.</p><label class="field">Chest front-to-back depth (cm, optional)<input id="garment-drape-depth" type="number" min="${BODY_CHEST_DEPTH[0]}" max="${BODY_CHEST_DEPTH[1]}" step="0.1"></label></div><p class="fine-print">Blank uses chest-based proportions. Measure chest depth as a straight front-to-back distance at chest level, not a curved tape arc. Chest depth changes chest and waist cross-sections at the entered girths. Height sets torso heights, arm length and trouser leg length as typical proportions; without it they follow the chest. Waist-to-hip depth is the vertical distance from the waist to the fullest hip; blank keeps the current proportions. For trousers, the hip must lie above the displayed crotch. Shoulders remain assumed. Applied body settings are saved with this design. Unapplied fields stay as drafts. These measurements do not establish physical fit.</p></details>
        <label class="field">Drape time<select id="garment-drape-frames" aria-describedby="garment-drape-time-help"><option value="${GARMENT_FRAMES}">Standard (3 s)</option><option value="${LONG_GARMENT_FRAMES}">Longer (12 s)</option></select></label>
        <p id="garment-drape-time-help" class="fine-print">Times are simulated, per garment. Longer restarts the drape and takes more time to run. The result can still show motion or excessive stretch.</p>
        <button id="apply-garment-body" class="quiet">Apply body settings</button><button id="garment-drape-on">Drape on a body</button><button id="garment-drape-off" class="quiet" hidden>Show styling shell</button>
        <label class="field">Size shown<select id="garment-size" aria-describedby="garment-size-status"></select></label><label class="check-field"><input id="garment-size-outfit" type="checkbox" disabled aria-describedby="garment-size-help"> Apply shown size to the whole outfit</label><p id="garment-size-help" class="fine-print">Off: only the garment being edited is graded. On: each outfit piece is graded from its own sample to Size shown, on the same body. Saved samples and export size choices stay unchanged.</p>
        <label class="field">Wear with<select id="garment-wear-with"></select></label><button type="button" id="remove-outfit-companion" class="quiet" hidden>Remove worn garment</button><label class="field">And with<select id="garment-wear-also" disabled aria-describedby="wear-also-help"></select></label><p id="wear-also-help" class="fine-print">A third garment: a T-shirt under a sweatshirt or hoodie, with shorts, trousers or a skirt.</p><button id="edit-worn-garment" class="quiet" disabled aria-describedby="edit-worn-help">Edit worn garment</button><label id="outfit-edit-picker" class="field" hidden>Garment to edit<select id="outfit-edit-layer" aria-describedby="edit-worn-help"></select></label><p id="edit-worn-help" class="fine-print">Switch which garment you edit, keeping the outfit together. Apply or discard product drafts first. You can undo the switch.</p><label class="check-field"><input id="garment-tuck" type="checkbox" disabled aria-describedby="garment-tuck-help"> Tuck the top in</label><p id="garment-tuck-help" class="fine-print">Choose bottoms with Wear with to tuck a top in.</p>
        <p class="fine-print">Another size is the design graded from its sample size, shown and draped on the same body to compare fit; the tech pack measures every size the same way. A top drapes over shorts, trousers or a skirt on the same body. The other garment is kept with this design as a copy: choose a saved design again to pick up its later changes.</p>
        <p id="garment-drape-status" class="fine-print" role="status"></p></div>
      <p id="garment-size-status" class="fine-print" role="status"></p>
      <div class="part-list" id="part-list" role="radiogroup" aria-label="Garment parts"></div>
      <p id="product-status" class="fine-print" role="status"></p><p class="fine-print" id="product-preview-unavailable" role="status" hidden>This browser could not start the 3D view. You can still edit patterns and download the garment as GLB.</p>
    </div>
    <aside class="product-inspector" aria-label="Selected part">
      <h4 id="inspector-heading">Front body</h4>
      <div class="describe-style"><label class="field">Describe a style<input id="style-prompt" maxlength="200" autocomplete="off" placeholder="e.g. oversized navy hoodie with a cream hood"></label>
        <div class="inline-actions"><button id="describe-part">Apply to this part</button><button id="describe-all" class="quiet">Apply to the garment</button></div>
        <p id="describe-result" class="fine-print" role="status"></p></div>
      <label class="field">Fabric<select id="part-material">${MATERIALS.map(m => `<option value="${m.id}">${m.name} · ${m.gsm} gsm</option>`).join('')}</select></label>
      ${drapeTestMarkup}
      <div class="color-row"><label for="part-color">Fabric color</label><input id="part-color" type="color"></div>
      <label class="field">Print<select id="part-print"><option value="">No print</option>${MOTIFS.map(m => `<option value="${m}">${MOTIF_NAMES[m]}</option>`).join('')}</select></label>
      <div class="print-options"><div class="color-row"><label for="print-color">Print color</label><input id="print-color" type="color"></div>
        <label class="field">Repeat<select id="print-layout">${LAYOUTS.map(l => `<option value="${l}">${LAYOUT_NAMES[l]}</option>`).join('')}</select></label>
        <label class="field">Stripe direction<select id="stripe-direction"><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option></select></label>
        <label class="field">Repeat size (cm)<input id="print-scale" type="number" min="${LIMITS.scaleCm[0]}" max="${LIMITS.scaleCm[1]}" step="0.5"></label></div>
      <button id="apply-all-parts" class="quiet">Use this style on every part</button>
      <p class="eyebrow">MEASUREMENTS</p>
      <div class="measure-grid" id="top-measures"><label class="field">Chest (cm)<input id="product-chest" type="number" min="${LIMITS.chest[0]}" max="${LIMITS.chest[1]}" step="1"></label>
        <label class="field">Body length (cm)<input id="product-length" type="number" min="${LIMITS.length[0]}" max="${LIMITS.length[1]}" step="1"></label>
        <label class="field">Sleeve length (cm)<input id="product-sleeve" type="number" min="0" max="${LIMITS.sleeve[1]}" step="1" title="0 makes a T-shirt sleeveless (a tank top)" aria-description="0 makes a T-shirt sleeveless (a tank top)"></label>
        <label class="field">Neckline<select id="product-neckline"><option value="crew">Crew neck</option><option value="v">V-neck</option></select></label></div>
      <div class="measure-grid" id="leg-measures" hidden>${LEG_FIELDS.map(([id, label, key]) => `<label class="field">${label} (cm)<input id="${id}" type="number" min="${LIMITS[key][0]}" max="${LIMITS[key][1]}" step="${key === 'waistbandHeight' ? '0.1' : '1'}"></label>`).join('')}<label class="field">Ankle cuff height (cm, 0 for none)<input id="product-leg-cuff" type="number" min="0" max="${LIMITS.legCuffHeight[1]}" step="0.5" aria-describedby="leg-cuff-help"></label><p id="leg-cuff-help" class="fine-print">Rib cuffs gather the leg openings, making joggers. The inseam is measured to the cuff edge.</p></div>
      <div class="measure-grid" id="skirt-measures" hidden>${SKIRT_FIELDS.map(([id,label,,min,max])=>`<label class="field">${label} (cm)<input id="${id}" type="number" min="${min}" max="${max}" step="0.5"></label>`).join('')}<label class="field">Skirt waistband height (cm)<input id="product-skirt-band" type="number" min="0" max="10" step="0.5" aria-describedby="skirt-band-note"></label><label class="field">Waist gathering (× waist)<input id="product-skirt-gather" type="number" min="1" max="${GATHER[1]}" step="0.05" aria-describedby="skirt-gather-note"></label><p class="fine-print" id="skirt-gather-note">1 means a smooth waist. ${GATHER[0]}–${GATHER[1]} cuts the panels' waist edge that many times the waist and gathers it in; the drape forms the gathers. It must stay at least 10 cm shorter than the hem.</p><label class="field">Fitted hip (cm)<input id="product-skirt-hip" type="number" min="70" max="200" step="0.5" aria-describedby="skirt-hip-note"></label><p class="fine-print" id="skirt-hip-note">Blank for a flared skirt. A hip measurement fits the skirt to the hip, ${FITTED_HIP_DEPTH} cm below the waist: its side seams curve in above the hip and waist darts take in the rest, and the waist-to-hem slant becomes its length. A hem narrower than the hip makes a pencil skirt.</p><label class="field">Pleats<select id="product-skirt-pleats" aria-describedby="skirt-pleat-note"><option value="">None</option><option value="knife">Knife pleats</option><option value="box">Box pleats</option></select></label><label class="field">Number of pleats<input id="product-skirt-pleat-count" type="number" min="${PLEAT_COUNT[0]}" max="${PLEAT_COUNT[1]}" step="2"></label><label class="field">Pleat depth at the waist (cm)<input id="product-skirt-pleat-depth" type="number" min="${PLEAT_DEPTH[0]}" max="${PLEAT_DEPTH[1]}" step="0.1"></label><p class="fine-print" id="skirt-pleat-note">Knife pleats all fold the same way; box pleats are pairs folded away from each other. Each pleat folds twice its depth of fabric under (a box four times), so the panels are cut that much wider, the folds deepening toward the hem as the skirt flares. Left blank, the number gives pleats about 3 cm apart at the waist and the depth half that (a quarter for boxes). Pleats replace gathering. In 3D the folds are pressed: they stay folded, opening a little toward the hem.</p><p class="fine-print" id="skirt-band-note">0 means no waistband; 2–10 cm adds a folded band above the waist seam, styled as its own part. The strip cuts twice that height. Panels keep their side seam slant. The drape holds the upper edge and simulates only the outer surface; the inner facing and closure are not modelled. Fit is not verified. Existing skirt construction remains available separately.</p></div>
      <button id="apply-measurements">Apply measurements</button>
      <details class="fit-panel" id="fit-panel"><summary>Fit: shoulders, neck/hood, sleeves, hem & pocket</summary>
        <p class="fine-print">Points of measure at the sample size, as in the tech pack. Untouched values keep their defaults; chest-based dimensions keep scaling. Back neck drop defaults to 2 cm; shoulder drop defaults to 4 cm. Finished neck rib height defaults to 2 cm; the cutting strip is twice that height. Hood side dimensions default to 32 cm high and 26 cm wide. Side width scales the illustrative front/back projection; the neckline attachment and extra 3 cm crown loft remain. The hood still uses a modelled cloth metric, not a physically flattened hood. Sweatshirt/hoodie cuffs and hem bands default to 6 cm; edit each finished height independently while total sleeve/body lengths stay fixed.</p>
        <div class="measure-grid">${FIT_KEYS.filter(key => !POCKET_FIT_KEYS.some(pocket => pocket === key)).map(key => `<label class="field">${FIT_NAMES[key]} (cm)<input id="fit-${key}" type="number" min="${LIMITS.fit[key][0]}" max="${LIMITS.fit[key][1]}" step="0.5"></label>`).join('')}</div>
        <div id="pocket-fit-fields" hidden><p class="eyebrow">CHEST POCKET CONSTRUCTION</p><p class="fine-print">Finished size; top measured below the high-point shoulder line. Positive centre offset moves toward the wearer’s left, negative toward the right. Keep the pocket at least 0.5 cm inside the front sewing outline.</p><div class="measure-grid">${POCKET_FIT_KEYS.map(key => `<label class="field">${FIT_NAMES[key]} (cm)<input id="fit-${key}" type="number" min="${LIMITS.fit[key][0]}" max="${LIMITS.fit[key][1]}" step="0.5"></label>`).join('')}</div></div>
        <div class="inline-actions"><button id="apply-fit">Apply fit</button><button id="reset-fit" class="quiet">Back to proportional</button></div>
      </details>
      <p class="eyebrow">MODULES</p>
      <div id="top-modules"><div class="measure-grid"><label class="field">Hem<select id="product-hem">${HEMS.map(h => `<option value="${h}">${HEM_NAMES[h]}</option>`).join('')}</select></label>
        <label class="check-field"><input id="product-chest-pocket" type="checkbox"> Add a chest pocket</label><label class="check-field"><input id="product-collar" type="checkbox"> <span id="product-collar-name">Polo collar and placket</span></label><label class="check-field"><input id="product-zip" type="checkbox"> Front zip</label><label class="check-field"><input id="product-buttons" type="checkbox"> Button front</label><label class="check-field"><input id="product-zip-open" type="checkbox"> Worn open</label></div>
      <div class="inline-actions sleeve-presets" role="group" aria-label="Sleeve length presets"><span class="fine-print">Sleeve</span>${SLEEVE_PRESETS.map(p => `<button class="quiet" data-sleeve-preset="${p.cm}" aria-label="${p.name} sleeve, ${p.cm} cm">${p.name}</button>`).join('')}</div></div>
      <div class="inline-actions sleeve-presets" id="leg-modules" role="group" aria-label="Leg length presets" hidden><span class="fine-print">Leg</span>${LEG_PRESETS.map(p => `<button class="quiet" data-leg-preset="${p.inseam}" aria-label="${p.name}, ${p.inseam} cm inseam">${p.name}</button>`).join('')}</div>
      <p id="module-help" class="fine-print"></p>
      <p class="eyebrow">ARTWORK</p>
      <p id="artwork-note" class="fine-print" hidden>Artwork placement is available on tops.</p>
      <div id="artwork-controls" class="artwork-controls">
      <label class="field">Artwork side<select id="artwork-side"><option value="front">Front</option><option value="back">Back</option></select></label>
      <label class="button quiet file-button">Upload artwork (PNG, JPEG, WebP)<input id="artwork-file" type="file" accept="image/png,image/jpeg,image/webp"></label>
      <div class="measure-grid"><label class="field">Text to print<input id="artwork-text" maxlength="${MAX_TEXT}" autocomplete="off"></label><label class="field">Text font<select id="artwork-font">${Object.entries(TEXT_FONTS).map(([id, name]) => `<option value="${id}">${name}</option>`).join('')}</select></label></div>
      <div class="inline-actions"><label class="color-row">Text colour<input id="artwork-text-colour" type="color" value="#1b1c1b"></label><button id="add-text-artwork" class="quiet">Print this text</button></div><p class="fine-print">Text replaces the artwork on the chosen side, as an image you can resize and move like uploaded artwork. Long text wraps at about 20 characters a line.</p>
      <div class="measure-grid"><label class="field">Artwork width (cm)<input id="artwork-width" type="number" min="${LIMITS.artworkWidthCm[0]}" max="${LIMITS.artworkWidthCm[1]}" step="0.5"></label>
        <label class="field">From centre (cm)<input id="artwork-x" type="number" step="0.5"></label>
        <label class="field">Below shoulder (cm)<input id="artwork-y" type="number" step="0.5"></label><label class="field">Artwork rotation (degrees)<input id="artwork-rotation" type="number" min="-180" max="180" step="1"></label></div><p class="fine-print">Positive angles turn clockwise when viewed from outside. Rotation is about the artwork centre; width and position stay unchanged.</p>
      <div class="inline-actions"><button id="apply-artwork">Apply placement</button><button id="remove-artwork" class="quiet">Remove artwork</button><button id="pick-artwork" class="quiet" aria-pressed="false" disabled>Pick artwork centre in 3D</button></div><p id="artwork-placement-status" class="fine-print" role="status">Pick a centre on the visible garment, then Apply placement. Numeric fields are the keyboard alternative; Escape cancels picking.</p></div>
    </aside>
  </div>
  <div class="pattern-strip"><div><p class="eyebrow">LINKED PATTERN PIECES</p><p class="fine-print">Finished size in cm, without seam allowance. The same fabrics and prints as the 3D garment; click a piece to select its part.</p></div><div id="product-pieces"></div>
    <label class="field">Pattern export size<select id="pattern-export-size" aria-describedby="pattern-export-help"></select></label><p id="pattern-export-help" class="fine-print"></p>
    <div class="product-exports"><button id="pattern-dxf" class="product-export">Download pattern (DXF) ↓</button><button id="pattern-svg" class="product-export">Download printable pattern (SVG, 1:1) ↓</button></div>
    <p class="fine-print">Exports add a 1 cm seam allowance around each finished piece and mark the sewing line, grainline, piece name, size and cut count. DXF is in millimetres for cutting software and plotters.</p></div>
  <div class="product-exports"><button id="product-png-front" class="product-export">Export front render PNG ↓</button><button id="product-png-back" class="product-export">Export back render PNG ↓</button><button id="product-glb" class="product-export">Export 3D model (GLB) ↓</button><button id="product-turntable" class="product-export">Export turntable video (WebM) ↓</button><label class="check-field"><input id="export-outfit" type="checkbox" aria-describedby="export-outfit-help"> Include worn garment in PNG, GLB and video</label><label class="field">Outfit export size<select id="outfit-export-size" aria-describedby="outfit-bundle-help"><option value="">Each garment’s sample</option>${SIZES.map(size => `<option value="${size}">${size}</option>`).join('')}</select></label><button id="outfit-bundle" class="product-export" aria-describedby="outfit-bundle-help">Download outfit patterns and tech packs (ZIP) ↓</button></div><p id="outfit-bundle-help" class="fine-print">All outfit garments at their own applied sample sizes or graded to the chosen outfit size: SVG, DXF, Excel and printable tech packs with measurement diagrams, plus applied artwork and uploaded repeat images. Apply or discard drafts first. No drape is needed.</p><p id="export-outfit-help" class="fine-print">Choose Wear with in Body &amp; drape, then drape the outfit to export both garments. The body is never exported.</p>
  <p class="fine-print">PNG, GLB and video use the size shown in 3D: the styling shell, or the current settled drape. The turntable video records one turn in real time, so it takes a few seconds. Include the worn garment to export the settled outfit together; patterns and tech packs remain garment-specific.</p>
  <section class="techpack" aria-labelledby="techpack-heading">
    <div class="techpack-head"><div><p class="eyebrow">TECH PACK</p><h4 id="techpack-heading">Factory-ready tech pack</h4>
    <p class="fine-print">Generated from this design and kept in sync with every change: bill of materials with fabric consumption, graded points of measure, construction and artwork placement.</p></div>
    <div class="techpack-fields"><label class="field">Style number<input id="spec-style" maxlength="40" autocomplete="off"></label>
      <label class="field">Season<input id="spec-season" maxlength="40" autocomplete="off" placeholder="e.g. SS27"></label>
      <label class="field">Sample size<select id="spec-size">${SIZES.map(size => `<option value="${size}">${size}</option>`).join('')}</select></label>
      <button id="apply-spec">Apply details</button></div></div>
    <div id="techpack-preview" class="techpack-preview"></div>
    <div class="product-exports"><button id="techpack-xlsx" class="product-export">Download tech pack (Excel) ↓</button><button id="techpack-html" class="product-export">Download printable tech pack ↓</button></div>
    <p class="fine-print">The printable tech pack includes front and back renders; open it in a browser and print or save as PDF.</p>
  </section>
  <section class="range" aria-labelledby="range-heading">
    <div class="techpack-head"><div><p class="eyebrow">COLORWAYS AND RANGE PLAN</p><h4 id="range-heading">Colorways and costing</h4>
    <p class="fine-print">Save the current styling as a colorway, compare colorways side by side, and plan units, cost and margin. Fabric cost follows each colorway's fabrics and the garment's measurements.</p></div>
    <div class="range-save"><label class="field">Colorway name<input id="colorway-name" maxlength="${LIMITS.colorwayName}" autocomplete="off" placeholder="e.g. Navy and ecru"></label>
      <button id="save-colorway">Save as colorway</button></div></div>
    <div id="colorway-list" class="colorway-list" role="list" aria-label="Colorways"></div>
    <div class="inline-actions"><button id="apply-colorway-details" disabled>Apply colorway details</button><button id="discard-colorway-details" class="quiet" disabled>Discard colorway details</button></div>
    <p class="fine-print">Names and units are drafts until applied together. The range plan and exports use applied details.</p>
    <details class="costing" open><summary>Costing inputs</summary>
      <div class="costing-grid"><label class="field">Currency<select id="cost-currency">${CURRENCIES.map(c => `<option value="${c}">${c}</option>`).join('')}</select></label>
        <label class="field">Retail price<input id="cost-retail" type="number" min="0" max="${LIMITS.price[1]}" step="0.01"></label>
        <label class="field">Make (CMT) per unit<input id="cost-make" type="number" min="0" max="${LIMITS.price[1]}" step="0.01"></label>
        <label class="field">Trims per unit<input id="cost-trims" type="number" min="0" max="${LIMITS.price[1]}" step="0.01"></label>
        <label class="field">Print per artwork<input id="cost-print" type="number" min="0" max="${LIMITS.price[1]}" step="0.01"></label></div>
      <p class="fine-print">Fabric prices per metre of 150 cm wide fabric (indicative defaults; replace them with your quotes):</p>
      <div id="fabric-prices" class="costing-grid"></div>
      <button id="apply-costing">Apply costing</button>
    </details>
    <div id="range-table" class="techpack-preview"></div>
    <div class="product-exports"><button id="range-xlsx" class="product-export">Download range plan (Excel) ↓</button></div>
  </section>
</section>`;

export function mountProduct(options: { current: () => Project; commit: (next: Project) => void; notice: (text: string, error?: boolean) => void; download: (blob: Blob, suffix: string, title?: string) => void }) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const canvas = $('product-canvas') as HTMLCanvasElement;
  // A decode belongs to the project and editing intent that started it, never the current selection later.
  let assetGeneration = 0;
  const retireAssets = (event?: Event) => {
    // Opening/closing a view does not change the design or retire its pending image decode.
    if (event?.target instanceof Element && event.target.closest('[data-workspace-navigation],[data-independent-experiment]')) return;
    assetGeneration++;
  };
  const root = document.getElementById('app')!;
  for (const event of ['input', 'change', 'pointerdown', 'keydown', 'click', 'drop']) root.addEventListener(event, retireAssets, true);
  window.addEventListener('pagehide', retireAssets);
  const beginAsset = () => {
    const generation = ++assetGeneration, origin = options.current();
    return () => generation === assetGeneration && options.current() === origin;
  };
  let selected: PartId = 'front', scene: import('./product-3d.ts').ProductScene | null = null, shown = '';
  const ready = import('./product-3d.ts').then(({ ProductScene }) => { scene = new ProductScene(canvas); shown = ''; render(options.current()); return scene; })
    .catch(() => { $('product-preview-unavailable').hidden = false; return null; });

  // Draping on a body: simulated in a worker, and kept while the design's shape, fabrics and the body stay the same, so
  // recolouring keeps the drape and a change of measurements, fit, modules or fabric drapes again. The body is a view
  // setting stored with the design; legacy projects keep proportional defaults.
  let draping = false, bodyChest: number | null = null, bodyWaist: number | null = null, bodyHip: number | null = null, bodyDepth: number | null = null, bodyHeight: number | null = null, bodyHipDepth: number | null = null, bodyArmGirth: number | null = null, bodyNeckGirth: number | null = null, bodyUnderbust: number | null = null, drape: { key: string; result: GarmentDrapeResult } | null = null;
  let drapeFrames = GARMENT_FRAMES;
  let drapeWorker: Worker | null = null, drapeTimer = 0, drapeKey = '', failedDrapeKey = '';
  let departed = false, shownBody = '';
  // The size shown in 3D (null: the sample). A view setting for this session: the design itself stays the sample.
  let shownSize: Size | null = null;
  let wholeOutfitSize = false;
  let patternSize: Size | null = null;
  const sampleOf = (design: Product): Size => design.spec?.sampleSize ?? 'M';
  const viewed = (design: Product): Product => {
    if (!shownSize || shownSize === sampleOf(design)) return design;
    try { return gradedProduct(design, shownSize); } catch { return design; }
  };
  // An outfit: the garment worn with the design, when one is a top and the other bottoms, or a T-shirt under a
  // sweatshirt or hoodie (layers).
  const companionOf = (design: Product) => { const worn = options.current().wornWith; return worn && canWearTogether(worn, design) ? worn : null; };
  // A three-piece outfit: a third garment that, with these two, is a T-shirt under a sweatshirt or hoodie, with bottoms.
  const alsoOf = (design: Product) => { const companion = companionOf(design), also = options.current().wornAlso; return companion && also && threePiece([design, companion, also]) ? also : null; };
  const outfitViewed = (design: Product, companion = companionOf(design), also = alsoOf(design)) => wholeOutfitSize
    ? gradedOutfit(design, companion, also, shownSize ?? sampleOf(design))
    : { product: viewed(design), companion, also };
  const piecesOf = (design: Product) => { const companion = companionOf(design), also = alsoOf(design); return companion && also ? threePiece([design, companion, also]) : null; };
  const layersOf = (design: Product) => { const companion = companionOf(design); return piecesOf(design) ?? (companion ? layerOrder(design, companion) : null); };
  const outfitTop = (design: Product) => isBottoms(design) ? companionOf(design) : design;
  // A top worn with bottoms can be tucked in; a dress, or a top worn over another, cannot.
  const tuckedFor = (design: Product) => { const top = outfitTop(design); return !!options.current().tucked && !!companionOf(design) && !layersOf(design) && !!top && canTuck(top); };
  // The bottoms of an outfit, if it has any.
  const outfitBottoms = (design: Product) => piecesOf(design)?.bottoms ?? (isBottoms(design) ? (companionOf(design) ? design : null) : companionOf(design) && isBottoms(companionOf(design)!) ? companionOf(design) : null);
  // Layers are draped on a body for the top underneath, nearest the body.
  const chestFor = (design: Product) => bodyChest ?? defaultBodyChest(layersOf(design)?.inner ?? outfitTop(design) ?? design);
  const shapeFor = (design: Product) => validateTopBodyShape(chestFor(design), {waist:bodyWaist??undefined,hip:bodyHip??undefined,chestDepth:bodyDepth??undefined,height:bodyHeight??undefined,hipDepth:bodyHipDepth??undefined,upperArmGirth:bodyArmGirth??undefined,neckGirth:bodyNeckGirth??undefined,underbust:bodyUnderbust??undefined});
  // Trousers default to the waist and hip they were drafted for, rather than proportions of a chest.
  // An outfit's automatic girths are ones both garments can be worn on.
  const drapeShapeFor = (design: Product) => {
    const companion = companionOf(design);
    const entered = {waist:bodyWaist??undefined,hip:bodyHip??undefined,chestDepth:bodyDepth??undefined,height:bodyHeight??undefined,hipDepth:bodyHipDepth??undefined,upperArmGirth:bodyArmGirth??undefined,neckGirth:bodyNeckGirth??undefined,underbust:bodyUnderbust??undefined};
    // Girths the bottoms cannot be worn on are left for the drape to explain.
    const bottomsWorn = companion ? outfitBottoms(design) : null;
    if (bottomsWorn) try { return outfitShape(bottomsWorn, chestFor(design), entered); } catch { return entered; }
    if (design.base === 'trousers') {
      const drafted = legMeasurements(design);
      return {waist:bodyWaist??drafted.waist,hip:bodyHip??drafted.hip,height:bodyHeight??undefined,hipDepth:bodyHipDepth??undefined,upperArmGirth:bodyArmGirth??undefined,neckGirth:bodyNeckGirth??undefined};
    }
    return shapeFor(design);
  };
  const shapeKey = (design: Product) => [design.base, design.measurements, design.fit ?? null, design.options ?? null, design.neckline, partsOf(design).map(id => design.parts[id].material)];
  const appliedBodyReference = (design: Product) => wholeOutfitSize || shownSize !== null
    ? [design, ...(companionOf(design) ? [companionOf(design)!] : []), ...(alsoOf(design) ? [alsoOf(design)!] : [])]
    : null;
  // A fabric comparison drapes on the same body; a skirt's or trousers' waist and hip are the ones their drape uses.
  const comparisonBody = (design: Product) => {
    if (!isBottoms(design)) return {chest:chestFor(design),...validateTopBodyShape(chestFor(design), drapeShapeFor(design))};
    const body = garmentBody(design, chestFor(design), drapeShapeFor(design));
    return {chest:chestFor(design),waist:body.waist,hip:body.hip,...(bodyHipDepth===null?{}:{hipDepth:bodyHipDepth}),...(bodyHeight===null?{}:{height:bodyHeight})};
  };
  const drapeKeyOf = (design: Product) => { const { product: shownProduct, companion, also } = outfitViewed(design); return JSON.stringify([shapeKey(shownProduct), companion ? shapeKey(companion) : null, also ? shapeKey(also) : null, tuckedFor(design), chestFor(design), drapeShapeFor(design), drapeFrames, appliedBodyReference(design)?.map(shapeKey) ?? null]); };
  const currentDrape = (design: Product) => (draping && drape?.key === drapeKeyOf(design) ? drape.result : null);
  function stopDrape() { drapeWorker?.terminate(); drapeWorker = null; window.clearTimeout(drapeTimer); drapeKey = ''; }
  function startDrape(design: Product) {
    const key = drapeKeyOf(design);
    if (departed || drapeKey === key || failedDrapeKey === key) return;
    stopDrape(); drapeKey = key;
    $('garment-drape-status').textContent = 'Draping on the body…';
    // Rapid edits (typing a measurement) start one simulation, for the last of them.
    drapeTimer = window.setTimeout(() => {
      let worker: Worker;
      try { worker = new Worker(new URL('./garment-drape.worker.ts', import.meta.url), { type: 'module' }); }
      catch { failedDrapeKey = key; stopDrape(); $('garment-drape-status').textContent = 'The drape worker could not start. Choose Drape again to retry, or Show styling shell.'; return; }
      drapeWorker = worker;
      worker.onmessage = (event: MessageEvent<{ kind: 'progress'; frame: number; frames: number } | { kind: 'result'; result: GarmentDrapeResult } | { kind: 'error'; message: string }>) => {
        if (worker !== drapeWorker || departed) return;
        if (key !== drapeKeyOf(options.current().product ?? template('blank'))) { stopDrape(); return; }
        const data = event.data;
        if (data.kind === 'progress') { $('garment-drape-status').textContent = `Draping on the body… ${Math.round(100 * data.frame / data.frames)}%`; return; }
        worker.terminate(); drapeWorker = null; drapeKey = '';
        if (data.kind === 'result') { drape = { key, result: data.result }; shown = ''; render(options.current()); }
        else { failedDrapeKey = key; $('garment-drape-status').textContent = `${data.message} Choose Drape again to retry, or Show styling shell.`; }
      };
      worker.onerror = () => { if (worker === drapeWorker) { failedDrapeKey = key; stopDrape(); $('garment-drape-status').textContent = 'The drape simulation could not run. Choose Drape again to retry, or Show styling shell.'; } };
      const { product: shownProduct, companion, also } = outfitViewed(design), bodyReference = appliedBodyReference(design);
      try { worker.postMessage({ product: shownProduct, ...(bodyReference ? { bodyReference } : {}), ...(companion ? { companion, tucked: tuckedFor(design) } : {}), ...(also ? { also } : {}), bodyChest: chestFor(design), bodyShape:drapeShapeFor(design), frames: drapeFrames }); }
      catch { failedDrapeKey = key; stopDrape(); $('garment-drape-status').textContent = 'The drape worker could not receive this design. Choose Drape again to retry.'; }
    }, 250);
  }
  // Where the garment ends on this body, rounded to whole centimetres.
  function fitSentence(result: GarmentDrapeResult, tucked = false): string {
    const fit = result.metrics.fit, cm = (value: number) => Math.round(Math.abs(value)), parts: string[] = [];
    // A tucked top's hem is inside the bottoms.
    if (fit?.hemBelowHip !== undefined && !tucked) parts.push(fit.hemBelowHip >= 0 ? `the hem falls ${cm(fit.hemBelowHip)} cm below the hip` : `the hem ends ${cm(fit.hemBelowHip)} cm above the hip`);
    // Short sleeves end well above the wrist by design; only sleeves near it are reported.
    if (fit?.sleeveBeyondWrist !== undefined && fit.sleeveBeyondWrist > -12) parts.push(fit.sleeveBeyondWrist >= 0 ? `the sleeves reach ${cm(fit.sleeveBeyondWrist)} cm past the wrists` : `the sleeves end ${cm(fit.sleeveBeyondWrist)} cm short of the wrists`);
    if (fit?.hemAboveFloor !== undefined) parts.push(fit.hemAboveFloor >= 0 ? `the hems end ${cm(fit.hemAboveFloor)} cm above the floor` : `the hems would reach ${cm(fit.hemAboveFloor)} cm below the floor, too long for this body`);
    const height = result.body.landmarks?.height;
    return parts.length ? ` On this ${height ? `${height} cm ` : ''}body ${parts.join(', ')}.` : '';
  }
  function drapeSummary(design: Product, result: GarmentDrapeResult): string {
    const companion = result.companion && companionOf(design), tucked = !!companion && tuckedFor(design), layers = layersOf(design), pieces = result.also ? piecesOf(design) : null;
    const worn = !companion ? '' : pieces ? (pieces.bottoms === design ? ` Worn under the ${pieces.inner.name} and the ${pieces.outer.name}: these bottoms drape first, the ${pieces.inner.name} drapes over them and the ${pieces.outer.name} over both.`
        : pieces.inner === design ? ` Worn under the ${pieces.outer.name}, over the ${pieces.bottoms.name}: the ${pieces.bottoms.name} drape first, then this top, on a body posed for the ${pieces.outer.name}, and the ${pieces.outer.name} rests on both.`
        : ` Worn over the ${pieces.inner.name} and the ${pieces.bottoms.name}: they drape first on the same body, and this top rests on both.`)
      : layers ? (layers.inner === design ? ` Worn under the ${companion.name}: this top drapes first, on a body posed for the ${companion.name}, and the ${companion.name} rests on it.`
        : ` Worn over the ${companion.name}: the ${companion.name} drapes first on the same body, and this top rests on it.`)
      : tucked ? (isBottoms(design) ? ` Worn with the ${companion.name} tucked in: the top drapes first, held close to the body below the waistband, and these bottoms drape over it.`
        : ` Tucked into the ${companion.name}: this top drapes first, held close to the body below the waistband, and the bottoms drape over it.`)
      : isBottoms(design) ? ` Worn under the ${companion.name}: the top drapes over these bottoms on the same body.`
      : ` Worn over the ${companion.name}: the bottoms drape first on the same body and do not carry this garment's weight.`;
    const size = wholeOutfitSize ? `Whole outfit size ${shownSize ?? sampleOf(design)}, each garment graded from its own sample. ` : viewed(design) === design ? '' : `Size ${shownSize}, graded from ${sampleOf(design)}. `;
    return size + drapeDescription(viewed(design), result) + worn + fitSentence(result, tucked && !isBottoms(design)) + ` ${result.settings.frames * result.settings.frameSeconds} simulated seconds${companion ? ' per garment' : ''}.`;
  }
  function drapeDescription(design: Product, result: GarmentDrapeResult): string {
    const { ease, contact, residualSpeed, maxStrain } = result.metrics;
    if (design.base === 'skirt') return `Draped on a body with a ${Number(result.body.waist.toFixed(2))} cm waist and ${Number(result.body.hip.toFixed(2))} cm hip, held at the waistline with ${Math.round(ease * 10) / 10} cm of waist ease; `
      + `the fabric rests on the body over ${Math.round(contact * 100)}% of its surface${residualSpeed > 10 ? ' and was still settling' : ''}. Stiffer fabrics hold more of the flare.`
      + (maxStrain > 1 ? ` Excessive numerical stretch (${Math.round(maxStrain * 100)}% maximum structural-edge extension).` : '');
    if (design.base === 'trousers') return `Draped on a body with a ${Number(result.body.waist.toFixed(2))} cm waist and ${Number(result.body.hip.toFixed(2))} cm hip, the elastic waistband gathered onto the waist, with ${Math.round(ease * 10) / 10} cm of hip ease; `
      + `the fabric rests on the body over ${Math.round(contact * 100)}% of its surface${residualSpeed > 10 ? ' and was still settling' : ''}.`
      + (maxStrain > 1 ? ` Excessive numerical stretch (${Math.round(maxStrain * 100)}% maximum structural-edge extension).` : '');
    return `Draped on a body with a ${result.body.underbust === undefined ? `${result.body.chest} cm chest` : `${result.body.chest} cm bust over a ${result.body.underbust} cm underbust`}: ${ease >= 0 ? `${Math.round(ease * 10) / 10} cm of ease` : `${Math.round(-ease * 10) / 10} cm smaller than the body`} at the chest; ${Number(result.body.waist.toFixed(2))} cm waist / ${Number(result.body.hip.toFixed(2))} cm hip / ${Number(result.body.chestDepth.toFixed(2))} cm chest depth on the proxy${result.body.neckGirth === undefined ? '' : ` / ${result.body.neckGirth} cm neck girth`}${result.body.upperArmGirth === undefined ? '' : ` / ${result.body.upperArmGirth} cm upper-arm girth`}; `
      + `the fabric rests on the body over ${Math.round(contact * 100)}% of its surface${residualSpeed > 10 ? ' and was still settling' : ''}. ${partName(design, 'front')} and every other part keep their fabrics and prints.`
      + (maxStrain > 1 ? ` Excessive numerical stretch (${Math.round(maxStrain * 100)}% maximum structural-edge extension). Enlarge the garment or reduce the proxy girths before interpreting this preview.` : '');
  }
  function applyBody(persistDefaults = true): boolean {
    const raw = ($('garment-drape-chest') as HTMLInputElement).value;
    const waistRaw=($('garment-drape-waist') as HTMLInputElement).value,hipRaw=($('garment-drape-hip') as HTMLInputElement).value,depthRaw=($('garment-drape-depth') as HTMLInputElement).value,heightRaw=($('garment-drape-height') as HTMLInputElement).value,hipDepthRaw=($('garment-drape-hip-depth') as HTMLInputElement).value,armRaw=($('garment-drape-arm-girth') as HTMLInputElement).value,neckRaw=($('garment-drape-neck-girth') as HTMLInputElement).value,underbustRaw=($('garment-drape-underbust') as HTMLInputElement).value;
    try {
      if(['garment-drape-chest','garment-drape-waist','garment-drape-hip','garment-drape-depth','garment-drape-height','garment-drape-hip-depth','garment-drape-arm-girth','garment-drape-neck-girth','garment-drape-underbust'].some(id=>($<HTMLInputElement>(id)).validity.badInput))throw new Error('Enter complete body measurements, or clear an optional field.');
      if (!raw.trim()) throw new Error('Body chest must be from 70 to 140 cm.');
      const chest=validateBodyChest(Number(raw)),waist=waistRaw.trim()?Number(waistRaw):null,hip=hipRaw.trim()?Number(hipRaw):null,depth=depthRaw.trim()?Number(depthRaw):null,height=heightRaw.trim()?Number(heightRaw):null,hipDepth=hipDepthRaw.trim()?Number(hipDepthRaw):null,upperArmGirth=armRaw.trim()?Number(armRaw):null,neckGirth=neckRaw.trim()?Number(neckRaw):null,underbust=underbustRaw.trim()?Number(underbustRaw):null;
      validateTopBodyShape(chest,{waist:waist??undefined,hip:hip??undefined,chestDepth:depth??undefined,height:height??undefined,hipDepth:hipDepth??undefined,upperArmGirth:upperArmGirth??undefined,neckGirth:neckGirth??undefined,underbust:underbust??undefined});
      // Starting a view on an untouched legacy body must not create a design edit.
      if(!persistDefaults&&!hasDrafts('body')){
        bodyChest=chest;bodyWaist=waist;bodyHip=hip;bodyDepth=depth;bodyHeight=height;bodyHipDepth=hipDepth;bodyArmGirth=upperArmGirth;bodyNeckGirth=neckGirth;bodyUnderbust=underbust;return true;
      }
      const next=validateProject({...options.current(),topBody:{chest,waist,hip,chestDepth:depth,...(height===null?{}:{height}),...(hipDepth===null?{}:{hipDepth}),...(upperArmGirth===null?{}:{upperArmGirth}),...(neckGirth===null?{}:{neckGirth}),...(underbust===null?{}:{underbust})}});
      for(const id of ['garment-drape-chest','garment-drape-waist','garment-drape-hip','garment-drape-depth','garment-drape-height','garment-drape-hip-depth','garment-drape-arm-girth','garment-drape-neck-girth','garment-drape-underbust'])drafts.delete(id);
      draftState();failedDrapeKey='';commit(next);return true;
    } catch (error) { options.notice((error as Error).message, true); return false; }
  }
  function setDraping(on: boolean) {
    if (on && !applyBody(false)) return;
    if (!on) { stopDrape(); drape = null; }
    else { drape = null; failedDrapeKey = ''; stopDrape(); }
    draping = on; shown = ''; render(options.current());
  }
  const sizeSelect = $('garment-size') as HTMLSelectElement, sizeOutfit = $('garment-size-outfit') as HTMLInputElement;
  function renderSizeSelect(design: Product) {
    const sample = sampleOf(design), html = SIZES.map(size => `<option value="${size}">${size}${size === sample ? ' (sample)' : ''}</option>`).join('');
    if (sizeSelect.dataset.html !== html) { sizeSelect.dataset.html = html; sizeSelect.innerHTML = html; }
    sizeSelect.value = shownSize ?? sample;
    sizeOutfit.disabled = !companionOf(design); sizeOutfit.checked = wholeOutfitSize;
  }
  sizeSelect.addEventListener('change', () => {
    const design = product() ?? template('blank'), size = sizeSelect.value as Size;
    if (!SIZES.includes(size)) return;
    try { if (wholeOutfitSize) gradedOutfit(design, companionOf(design), alsoOf(design), size); else gradedProduct(design, size); }
    catch (error) { options.notice(error instanceof Error ? error.message : 'That size cannot be shown.', true); renderSizeSelect(design); return; }
    shownSize = size === sampleOf(design) ? null : size;
    $('garment-size-status').textContent = '';
    shown = ''; render(options.current());
    options.notice(wholeOutfitSize ? `Showing the whole outfit in size ${size}, each garment graded from its own sample on the same body. Saved designs are unchanged.` : shownSize ? `Showing size ${size}, graded from ${sampleOf(design)}, on the same body. The design itself is unchanged.` : `Showing the sample size ${size}.`);
  });
  sizeOutfit.addEventListener('change', () => {
    const design = product() ?? template('blank'), enabled = sizeOutfit.checked;
    if (enabled) try { gradedOutfit(design, companionOf(design), alsoOf(design), shownSize ?? sampleOf(design)); }
    catch (error) { sizeOutfit.checked = wholeOutfitSize; options.notice(error instanceof Error ? error.message : 'That outfit size cannot be shown.', true); return; }
    wholeOutfitSize = enabled; shown = ''; $('garment-size-status').textContent = '';
    render(options.current());
    options.notice(enabled ? `Showing the whole outfit in size ${shownSize ?? sampleOf(design)} on the same body. Saved designs are unchanged.` : 'Only the edited garment follows Size shown; worn pieces use their applied samples.');
  });
  // Independent export setting: neither the saved sample nor the 3D size is edited.
  const patternSizeSelect = $('pattern-export-size') as HTMLSelectElement;
  function renderPatternSize(design: Product) {
    const sample = sampleOf(design);
    patternSizeSelect.innerHTML = SIZES.map(size => `<option value="${size}">${size}${size === sample ? ' (sample)' : ''}</option>`).join('');
    patternSizeSelect.value = patternSize ?? sample;
    $('pattern-export-help').textContent = `Downloads use size ${patternSize ?? sample}. Pattern previews and saved measurements remain the sample size ${sample}; the size shown in 3D is separate. Apply measurement changes before exporting.`;
  }
  patternSizeSelect.addEventListener('change', () => {
    const size = patternSizeSelect.value as Size;
    if (!SIZES.includes(size)) return;
    const design = product() ?? template('blank');
    patternSize = size === sampleOf(design) ? null : size;
    renderPatternSize(design);
  });
  // Wear with: templates of the other kind, the kept copy, and saved designs of the other kind (read when the list opens).
  const wearWith = $('garment-wear-with') as HTMLSelectElement, wearAlso = $('garment-wear-also') as HTMLSelectElement;
  const removeCompanion = $('remove-outfit-companion') as HTMLButtonElement;
  let savedOutfits = new Map<string, Product>(), loadingSaved = false;
  function renderWearWith(design: Product) {
    const companion = companionOf(design), also = alsoOf(design), other = (item: Product) => canWearTogether(item, design);
    const option = (value: string, text: string) => `<option value="${value}">${escapeHtml(text)}</option>`;
    const html = option('', also ? 'Remove both worn garments' : 'Nothing else') + (companion ? option('kept', `${companion.name} (kept with this design)`) : '')
      + `<optgroup label="Templates">${TEMPLATES.filter(item => other(item.product)).map(item => option(`t:${item.id}`, item.name)).join('')}</optgroup>`
      + ([...savedOutfits].some(([, item]) => other(item)) ? `<optgroup label="Saved designs">${[...savedOutfits].filter(([, item]) => other(item)).map(([id, item]) => option(`s:${id}`, item.name)).join('')}</optgroup>` : '');
    if (wearWith.dataset.html !== html) { wearWith.dataset.html = html; wearWith.innerHTML = html; }
    wearWith.value = companion ? 'kept' : '';
    // And with: a third garment, when these two can be worn with one.
    removeCompanion.hidden = !also;
    if (also && companion) removeCompanion.textContent = `Remove only ${companion.name}`;
    const third = (item: Product) => !!companion && !!threePiece([design, companion, item]);
    const thirds = TEMPLATES.filter(item => third(item.product)), savedThirds = [...savedOutfits].filter(([, item]) => third(item));
    const alsoHtml = option('', 'Nothing else') + (also ? option('kept', `${also.name} (kept with this design)`) : '')
      + (thirds.length ? `<optgroup label="Templates">${thirds.map(item => option(`t:${item.id}`, item.name)).join('')}</optgroup>` : '')
      + (savedThirds.length ? `<optgroup label="Saved designs">${savedThirds.map(([id, item]) => option(`s:${id}`, item.name)).join('')}</optgroup>` : '');
    if (wearAlso.dataset.html !== alsoHtml) { wearAlso.dataset.html = alsoHtml; wearAlso.innerHTML = alsoHtml; }
    wearAlso.value = also ? 'kept' : '';
    wearAlso.disabled = !companion || (!thirds.length && !savedThirds.length && !also);
  }
  async function loadSavedOutfits() {
    if (loadingSaved) return;
    loadingSaved = true;
    try {
      const found = new Map<string, Product>();
      for (const receipt of await listDesigns()) {
        try { const saved = await readDesign(receipt); if (saved.product) found.set(receipt.id, { ...saved.product, name: receipt.name }); } catch { /* A damaged copy is left out of the list. */ }
      }
      savedOutfits = found; renderWearWith(product() ?? template('blank'));
    } catch { /* Without saved designs, templates are still offered. */ }
    finally { loadingSaved = false; }
  }
  wearWith.addEventListener('focus', () => void loadSavedOutfits());
  wearAlso.addEventListener('focus', () => void loadSavedOutfits());
  wearAlso.addEventListener('change', () => {
    const value = wearAlso.value, design = product() ?? template('blank'), companion = companionOf(design);
    if (value === 'kept' || !companion) return;
    const worn = value.startsWith('t:') ? template(value.slice(2)) : value.startsWith('s:') ? savedOutfits.get(value.slice(2)) : undefined;
    const rest = { ...options.current() };
    delete rest.wornAlso; delete rest.tucked;
    retireAssets();
    try {
      commit(worn ? { ...rest, wornAlso: validateProduct(structuredClone(worn)) } : rest);
      options.notice(worn ? `The ${design.name} is worn with the ${companion.name} and the ${worn.name}.${draping ? '' : ' Drape on a body to see them together.'} You can undo this.` : `The ${design.name} is worn with the ${companion.name} only. You can undo this.`);
    } catch (error) { options.notice(error instanceof Error ? error.message : 'That garment cannot be worn with these.', true); renderWearWith(design); }
  });
  removeCompanion.addEventListener('click', () => {
    const current = options.current();
    const design = current.product ?? template('blank');
    const { wornWith: removed, wornAlso: kept } = current;
    if (!removed || !kept || !threePiece([design, removed, kept]) || !canWearTogether(design, kept)) return;
    const next = { ...current, wornWith: kept };
    delete next.wornAlso; delete next.tucked;
    retireAssets();
    try {
      commit(next);
      wearWith.focus();
      options.notice(`Removed ${removed.name}. The ${kept.name} stays in the outfit. You can undo this.`);
    } catch (error) { options.notice(error instanceof Error ? error.message : 'Could not remove that worn garment.', true); }
  });
  wearWith.addEventListener('change', () => {
    const value = wearWith.value, current = options.current(), design = current.product ?? template('blank');
    if (value === 'kept') return;
    const worn = value.startsWith('t:') ? template(value.slice(2)) : value.startsWith('s:') ? savedOutfits.get(value.slice(2)) : undefined;
    if (value && (!worn || !canWearTogether(design, worn))) {
      options.notice('That garment is no longer available for this outfit.', true); renderWearWith(design); return;
    }
    const also = current.wornAlso;
    const keepAlso = worn && also && threePiece([design, worn, also]) ? also : undefined;
    if (also && !keepAlso) {
      const question = worn
        ? `“${also.name}” cannot stay with “${worn.name}” in this outfit. Remove the third garment and continue? You can undo this.`
        : `Remove both worn garments, including “${also.name}”? You can undo this.`;
      if (!window.confirm(question)) { renderWearWith(design); return; }
    }
    const rest = { ...current };
    delete rest.wornWith; delete rest.wornAlso; delete rest.tucked;
    const keepTucked = current.tucked && worn && !keepAlso && isBottoms(design) !== isBottoms(worn)
      && canTuck(isBottoms(design) ? worn : design);
    retireAssets();
    try {
      commit(worn ? { ...rest, wornWith: validateProduct(structuredClone(worn)), ...(keepAlso ? { wornAlso: keepAlso } : {}), ...(keepTucked ? { tucked: true } : {}) } : rest);
      options.notice(worn
        ? `The ${design.name} is worn with the ${worn.name}${keepAlso ? ` and the ${keepAlso.name}` : ''}.${draping ? '' : ' Drape on a body to see them together.'} You can undo this.`
        : `The ${design.name} is worn on its own. You can undo this.`);
    } catch (error) { options.notice(error instanceof Error ? error.message : 'That garment cannot be worn with this one.', true); renderWearWith(design); }
  });
  const drapeTime = $('garment-drape-frames') as HTMLSelectElement;
  drapeTime.addEventListener('change', () => {
    if (hasDrafts()) {
      drapeTime.value = String(drapeFrames);
      options.notice('Apply or discard product drafts before changing drape time.', true);
      return;
    }
    drapeFrames = previewDrapeFrames(Number(drapeTime.value));
    stopDrape(); drape = null; failedDrapeKey = ''; shown = '';
    render(options.current());
  });
  $('garment-drape-on').addEventListener('click', () => setDraping(true));
  $('garment-drape-off').addEventListener('click', () => setDraping(false));
  $('apply-garment-body').addEventListener('click', () => { if (applyBody()) { shown = ''; render(options.current()); options.notice('Body settings saved with this design. You can undo this.'); } });
  window.addEventListener('pagehide', () => { departed = true; stopDrape(); draping = false; drape = null; });
  window.addEventListener('pageshow', () => { departed = false; shown = ''; render(options.current()); });


  // Library previews use the same tiles as the garment.
  for (const preview of document.querySelectorAll<HTMLCanvasElement>('[data-material-preview]')) {
    const tile = paintTile({ material: preview.dataset.materialPreview!, color: '#d8d2c4', print: null }).canvas;
    preview.getContext('2d')!.drawImage(tile, 0, 0, 44, 44);
  }
  for (const preview of document.querySelectorAll<HTMLCanvasElement>('[data-print-preview]')) {
    const tile = paintTile({ material: 'jersey-180', color: '#efe8d8', print: { motif: preview.dataset.printPreview as Print['motif'], color: '#1f2a4f', scaleCm: 6, layout: 'grid' } }).canvas;
    preview.getContext('2d')!.drawImage(tile, 0, 0, 44, 44);
  }

  // Validate the complete recoverable graph before invoking the parent commit or reporting success.
  const commit = (next: Project) => options.commit(validateProject(next));
  type DraftGroup = 'measurements' | 'fit' | 'artwork' | 'spec' | 'costing' | 'name' | 'body' | 'colorways';
  const drafts = new Map<string, string>();
  const measurementIds = new Set(['product-chest', 'product-length', 'product-sleeve', 'product-neckline', 'product-skirt-band', 'product-skirt-gather', 'product-skirt-hip', 'product-skirt-pleats', 'product-skirt-pleat-count', 'product-skirt-pleat-depth', 'product-leg-cuff', ...LEG_FIELDS.map(([id]) => id), ...SKIRT_FIELDS.map(([id])=>id)]);
  const groupOf = (id: string): DraftGroup | null => ['garment-drape-chest','garment-drape-waist','garment-drape-hip','garment-drape-depth','garment-drape-height','garment-drape-hip-depth','garment-drape-arm-girth','garment-drape-neck-girth','garment-drape-underbust'].includes(id) ? 'body' : measurementIds.has(id) ? 'measurements' : id.startsWith('fit-') ? 'fit'
    : ['artwork-width', 'artwork-x', 'artwork-y', 'artwork-rotation'].includes(id) ? 'artwork' : id.startsWith('spec-') ? 'spec' : id.startsWith('cost-') ? 'costing' : id === 'product-name' ? 'name' : /^range-(name|units)-/.test(id) ? 'colorways' : null;
  const hasDrafts = (group?: DraftGroup) => [...drafts.keys()].some(id => !group || groupOf(id) === group);
  const draftState = () => {
    ($('discard-product-drafts') as HTMLButtonElement).disabled = !drafts.size;
    for (const id of ['apply-colorway-details','discard-colorway-details']) ($<HTMLButtonElement>(id)).disabled = !hasDrafts('colorways');
    $('product-draft-state').textContent = drafts.size ? 'Unapplied product edits. Apply the relevant group, or discard all product drafts.' : '';
  };
  const captureDraft = (event: Event) => {
    const field = event.target;
    if ((field instanceof HTMLInputElement || field instanceof HTMLSelectElement) && groupOf(field.id)) { drafts.set(field.id, field.value); draftState(); }
  };
  $('product-editor').addEventListener('input', captureDraft, true);
  $('product-editor').addEventListener('change', captureDraft, true);
  const restoreDrafts = () => {
    for (const [id, value] of drafts) { const field = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null; if (field && field.value !== value) field.value = value; }
    draftState();
  };
  $('discard-product-drafts').addEventListener('click', () => { drafts.clear(); shown = ''; render(options.current()); options.notice('All product drafts discarded. Committed design unchanged.'); });
  const refuseDrafts = () => { options.notice('Apply or discard pending product edits before replacing the design. Your drafts are kept.', true); };
  const product = () => options.current().product ?? null;
  const label = (part: PartId) => partName(product() ?? template('blank'), part);
  const removedOutfit = (removed: Product[]) => removed.length
    ? ` This also removes ${removed.map(item => `“${item.name}”`).join(' and ')} from this outfit.` : '';
  function update(mutate: (draft: Product) => void, text: string, appliedGroup?: DraftGroup) {
    const current = product() ?? template('blank');
    const draft = structuredClone(current);
    const savedDrafts = new Map(drafts);
    try {
      mutate(draft);
      const edited = validateProduct(draft), previous = options.current();
      const changingBase = edited.base !== current.base;
      if (changingBase && hasDrafts()) { refuseDrafts(); return false; }
      const replace = changingBase || (previous.tucked && !isBottoms(edited) && !canTuck(edited));
      const plan = replace ? replaceOutfitProduct(previous, edited) : { project: { ...previous, product: edited }, removed: [] };
      if (plan.removed.length && !window.confirm(`Change the edited garment to “${edited.name}”?${removedOutfit(plan.removed)} You can undo this.`)) return false;
      const next = validateProject(plan.project);
      if (appliedGroup) for (const id of drafts.keys()) if (groupOf(id) === appliedGroup) drafts.delete(id);
      commit(next); options.notice(text); return true;
    }
    catch (error) { drafts.clear(); for (const [id, value] of savedDrafts) drafts.set(id, value); restoreDrafts(); options.notice(error instanceof Error ? error.message : 'That change is not valid.', true); return false; }
  }
  const fabricComparison=mountGarmentComparison($('garment-drape-controls'),{
    capture:()=>{if(hasDrafts())throw new Error('Apply or discard pending product edits before comparing or choosing a fabric.');const design=product();if(!design)throw new Error('Choose a garment to compare fabrics.');return{product:design,body:comparisonBody(design)};},
    apply:id=>{retireAssets();return update(draft=>{for(const part of partsOf(draft))if(!RIB_PARTS.has(part))draft.parts[part].material=id;},'Comparison fabric applied to non-rib parts.');},
  });
  const bodyProfiles=mountTopBodyProfiles($('garment-drape-controls'),{
    capture:()=>{const design=product();if(!design||isBottoms(design))throw new Error('Choose a top to save body measurements.');if(hasDrafts('body'))throw new Error('Apply or discard body drafts before saving a profile.');return{chest:chestFor(design),waist:bodyWaist,hip:bodyHip,chestDepth:bodyDepth,...(bodyHeight===null?{}:{height:bodyHeight}),...(bodyHipDepth===null?{}:{hipDepth:bodyHipDepth}),...(bodyArmGirth===null?{}:{upperArmGirth:bodyArmGirth}),...(bodyNeckGirth===null?{}:{neckGirth:bodyNeckGirth}),...(bodyUnderbust===null?{}:{underbust:bodyUnderbust})};},
    use:body=>{const design=product();if(!design||isBottoms(design))throw new Error('Choose a top to use a body profile.');if(hasDrafts('body'))throw new Error('Apply or discard body drafts before using a profile.');validateTopBodyShape(body.chest,{waist:body.waist??undefined,hip:body.hip??undefined,chestDepth:body.chestDepth??undefined,height:body.height??undefined,hipDepth:body.hipDepth??undefined,upperArmGirth:body.upperArmGirth??undefined,neckGirth:body.neckGirth??undefined,underbust:body.underbust??undefined});retireAssets();stopDrape();drape=null;failedDrapeKey='';commit({...options.current(),topBody:{...body}});shown='';render(options.current());},
    download:options.download,
  });
  function applySwatch(part: PartId, swatch: Swatch) {
    update(draft => {
      const style = draft.parts[part];
      if (swatch.kind === 'material') { material(swatch.id); style.material = swatch.id; }
      else if (swatch.kind === 'color') style.color = swatch.value;
      else style.print = { motif: swatch.motif, color: style.print?.color ?? '#1f2a4f', scaleCm: style.print?.scaleCm ?? 6, layout: style.print?.layout ?? 'grid' };
    }, `${label(part)}: ${swatch.kind === 'material' ? material(swatch.id).name : swatch.kind === 'color' ? `color ${swatch.value}` : `${printName({ motif: swatch.motif, color: '', scaleCm: 6, layout: 'grid' }, product() ?? {})} print`}.`);
  }
  const parseSwatch = (raw: string | undefined): Swatch | null => { try { return raw ? JSON.parse(raw) as Swatch : null; } catch { return null; } };

  // Library: click applies to the selected part; drag applies to the part under the drop point.
  for (const button of document.querySelectorAll<HTMLElement>('#product-editor [data-swatch]')) {
    button.addEventListener('click', () => { const swatch = parseSwatch(button.dataset.swatch); if (swatch) applySwatch(selected, swatch); });
    button.addEventListener('dragstart', event => { event.dataTransfer?.setData(DRAG_TYPE, button.dataset.swatch!); event.dataTransfer!.effectAllowed = 'copy'; });
  }
  // Uploaded motifs: their swatches are rebuilt with the design, so they use delegated events.
  $('uploaded-motifs').addEventListener('click', event => {
    const target = event.target as Element, remove = target.closest<HTMLButtonElement>('[data-remove-motif]');
    if (remove) {
      const id = remove.dataset.removeMotif!, upload = `upload:${id}`, name = product()?.motifs?.find(m => m.id === id)?.name ?? 'motif';
      update(draft => {
        const clear = (parts: Product['parts']) => { for (const part of partsOf(draft)) if (parts[part].print?.motif === upload) parts[part].print = null; };
        clear(draft.parts); for (const colorway of draft.colorways ?? []) clear(colorway.parts);
        draft.motifs = draft.motifs!.filter(m => m.id !== id); if (!draft.motifs.length) delete draft.motifs;
      }, `Removed the motif “${name}” and its prints. You can undo this.`);
      return;
    }
    const swatch = parseSwatch(target.closest<HTMLElement>('[data-swatch]')?.dataset.swatch);
    if (swatch) applySwatch(selected, swatch);
  });
  $('uploaded-motifs').addEventListener('dragstart', event => {
    const button = (event.target as Element).closest<HTMLElement>('[data-swatch]');
    if (button) { event.dataTransfer?.setData(DRAG_TYPE, button.dataset.swatch!); event.dataTransfer!.effectAllowed = 'copy'; }
  });
  // Photo colours: rebuilt with the design, so their chips use delegated events like uploaded motifs.
  $('photo-colours').addEventListener('click', event => {
    const swatch = parseSwatch((event.target as Element).closest<HTMLElement>('[data-swatch]')?.dataset.swatch);
    if (swatch) applySwatch(selected, swatch);
  });
  $('photo-colours').addEventListener('dragstart', event => {
    const button = (event.target as Element).closest<HTMLElement>('[data-swatch]');
    if (button) { event.dataTransfer?.setData(DRAG_TYPE, button.dataset.swatch!); event.dataTransfer!.effectAllowed = 'copy'; }
  });
  $('photo-colours-file').addEventListener('change', async () => {
    const input = $('photo-colours-file') as HTMLInputElement, file = input.files?.[0]; input.value = '';
    if (!file) return;
    const owned = beginAsset();
    let bitmap: ImageBitmap | undefined;
    try {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Choose a PNG, JPEG or WebP photo.');
      bitmap = await decodeProductFile(file);
      if (!owned()) return;
      const scale = Math.min(1, 160 / Math.max(bitmap.width, bitmap.height)), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bitmap.width * scale)); c.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = c.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(bitmap, 0, 0, c.width, c.height);
      const found = photoColours(context.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
      if (!found.length) throw new Error('No colours could be read from that photo; it may be fully transparent.');
      update(draft => { draft.palette = found.map(colour => colour.hex); },
        `${found.length} colour${found.length === 1 ? '' : 's'} from the photo, most used first. Drag them onto parts, or use them on the garment.`);
    } catch (error) { if (owned()) options.notice(error instanceof Error ? error.message : 'That photo could not be read.', true); }
    finally { bitmap?.close(); }
  });
  $('apply-photo-colours').addEventListener('click', () => {
    const palette = product()?.palette;
    if (!palette) return;
    update(draft => { draft.parts = paletteColorway(draft, palette); }, 'Photo colours applied: the main colour on the body, a contrasting one on trims and prints. Fabrics stay. You can undo this.');
  });
  $('clear-photo-colours').addEventListener('click', () => update(draft => { delete draft.palette; }, 'Photo colours removed. The garment keeps its colours; you can undo this.'));
  $('motif-file').addEventListener('change', async () => {
    const input = $('motif-file') as HTMLInputElement, file = input.files?.[0]; input.value = '';
    if (!file) return;
    const owned = beginAsset();
    let bitmap: ImageBitmap | undefined;
    const target = selected;
    try {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 10 * 1024 * 1024) throw new Error('Choose a PNG, JPEG or WebP image of at most 10 MB.');
      if ((product()?.motifs?.length ?? 0) >= LIMITS.motifs) throw new Error(`Keep at most ${LIMITS.motifs} uploaded motifs; remove one first.`);
      bitmap = await decodeProductFile(file);
      if (!owned()) return;
      let edge = Math.min(768, Math.max(bitmap.width, bitmap.height)), dataUrl = '', width = 0, height = 0;
      for (;;) {
        const scale = edge / Math.max(bitmap.width, bitmap.height), c = document.createElement('canvas');
        width = c.width = Math.max(1, Math.round(bitmap.width * scale)); height = c.height = Math.max(1, Math.round(bitmap.height * scale));
        c.getContext('2d')!.drawImage(bitmap, 0, 0, width, height); dataUrl = c.toDataURL('image/png');
        if (dataUrl.length <= LIMITS.motifBytes * 1.33 || edge <= 64) break;
        edge = Math.max(64, Math.round(edge * 0.75));
      }
      if (dataUrl.length > LIMITS.motifBytes * 1.33) throw new Error('That image is too detailed to use as a motif; try a simpler or smaller one.');
      const name = file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Uploaded motif';
      update(draft => {
        const motifs = draft.motifs ?? [];
        let n = 1; while (motifs.some(m => m.id === `m${n}`)) n++;
        draft.motifs = [...motifs, { id: `m${n}`, name, dataUrl, width, height }];
        const current = draft.parts[target].print;
        draft.parts[target].print = { motif: `upload:m${n}`, color: current?.color ?? '#1f2a4f', scaleCm: current?.scaleCm ?? 8, layout: current?.layout ?? 'grid' };
      }, `“${name}” repeats on the ${label(target).toLowerCase()}. Choose its repeat and size in cm below, or drag it onto other parts.`);
    } catch (error) { if (owned()) options.notice(error instanceof Error ? error.message : 'That image could not be used.', true); }
    finally { bitmap?.close(); }
  });
  // Repaint the garment, pieces and thumbnails once an uploaded motif has decoded.
  onMotifImage(() => { shown = ''; render(options.current()); });

  canvas.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes(DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
  canvas.addEventListener('drop', event => {
    event.preventDefault();
    const swatch = parseSwatch(event.dataTransfer?.getData(DRAG_TYPE)), part = scene?.pick(event.clientX, event.clientY);
    if (!swatch) return;
    if (!part) { options.notice('Drop the swatch onto a part of the garment.', true); return; }
    selected = part; applySwatch(part, swatch);
  });
  let down: { x: number; y: number } | null = null;
  let pickOwner:{design:Product;side:Artwork['part']}|null=null;
  function finishPicking(message:string) {
    pickOwner=null;
    $('pick-artwork').setAttribute('aria-pressed','false');
    canvas.style.cursor='';
    $('artwork-placement-status').textContent=message;
  }
  $('pick-artwork').addEventListener('click',()=>{
    if(pickOwner){finishPicking('Picking cancelled. Placement drafts are kept.');return;}
    const design=product(),side=($('artwork-side') as HTMLSelectElement).value as Artwork['part'];
    const art=design?.artwork.find(item=>item.part===side),width=($('artwork-width') as HTMLInputElement).valueAsNumber;
    if(!scene||!design||!art){finishPicking('Upload artwork and wait for the 3D view before picking.');return;}
    if(!Number.isFinite(width)||width<LIMITS.artworkWidthCm[0]||width>LIMITS.artworkWidthCm[1]){finishPicking('Artwork width must be from 3 to 40 cm before picking.');return;}
    pickOwner={design,side};$('pick-artwork').setAttribute('aria-pressed','true');canvas.style.cursor='crosshair';
    $('artwork-placement-status').textContent=`Click the visible ${side} body panel at the artwork centre. Drag to orbit; Escape cancels.`;
    scene.setView(side);canvas.scrollIntoView({block:'center'});canvas.focus({preventScroll:true});
  });
  window.addEventListener('keydown',event=>{
    if(pickOwner&&event.key==='Escape'){event.preventDefault();event.stopPropagation();finishPicking('Picking cancelled. Placement drafts are kept.');$('pick-artwork').focus({preventScroll:true});}
  },true);
  window.addEventListener('pagehide',()=>finishPicking('Picking stopped on leaving the page.'));
  root.addEventListener('click',event=>{
    if(pickOwner&&event.target instanceof Element&&event.target.closest('[data-workspace-navigation],#workspace-mode'))finishPicking('Picking cancelled on leaving the artwork tool. Placement drafts are kept.');
  },true);
  canvas.addEventListener('pointerdown', event => { down = { x: event.clientX, y: event.clientY }; });
  canvas.addEventListener('pointerup', event => {
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) { down = null; return; }
    if(pickOwner){
      down=null;if(event.button!==0||!event.isPrimary)return;
      const owner=pickOwner,design=product(),side=($('artwork-side') as HTMLSelectElement).value;
      if(design!==owner.design||side!==owner.side){finishPicking('The design or artwork side changed. Pick again.');return;}
      try{
        const point=scene?.pickArtworkPoint(event.clientX,event.clientY,owner.side),art=design.artwork.find(item=>item.part===owner.side);
        if(!point||!art)throw new Error(`Choose a point on the visible ${owner.side} body panel.`);
        const placement=placementFromSurface(design,art,point,($('artwork-width') as HTMLInputElement).valueAsNumber);
        for(const [id,value]of [['artwork-x',placement.xCm],['artwork-y',placement.yCm]] as const){const field=$(id) as HTMLInputElement;field.value=String(value);field.dispatchEvent(new Event('input',{bubbles:true}));}
        finishPicking('Point chosen. Review the coordinates, then Apply placement; Discard restores your previous placement.');
        $('apply-artwork').focus();
      }catch(error){$('artwork-placement-status').textContent=error instanceof Error?error.message:'Choose a point on the garment.';}
      return;
    }
    down = null; const part = scene?.pick(event.clientX, event.clientY);
    if (part) { selected = part; render(options.current()); }
  });
  // The parts list follows the base product, so it is rebuilt with the design and uses a delegated listener.
  $('part-list').addEventListener('change', event => {
    const radio = (event.target as Element).closest<HTMLInputElement>('input[name=product-part]');
    if (radio) { selected = radio.value as PartId; render(options.current()); }
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) button.addEventListener('click', () => scene?.setView(button.dataset.view as 'front'));
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-template]')) button.addEventListener('click', () => {
    if (hasDrafts()) { refuseDrafts(); return; }
    const current = product();
    const name = TEMPLATES.find(item => item.id === button.dataset.template)?.name ?? 'chosen';
    // Colours picked from a photo stay for the next garment.
    const next = { ...template(button.dataset.template!), ...(current?.palette ? { palette: current.palette } : {}) };
    const plan = replaceOutfitProduct(options.current(), next);
    if ((current || plan.removed.length) && !window.confirm(`${current ? `Replace “${current.name}” with the ${name} template?` : `Use the ${name} template?`}${removedOutfit(plan.removed)} You can undo this.`)) return;
    commit(plan.project); options.notice(`${next.name} template loaded. Style any part to make it yours.`);
  });

  const editLayer = $('outfit-edit-layer') as HTMLSelectElement;
  let currentLayer: OutfitLayer | null = null;
  function editOutfitGarment(layer?: OutfitLayer) {
    if (hasDrafts()) { refuseDrafts(); return; }
    try {
      const next = switchOutfitEditing(options.current(), layer);
      retireAssets();
      shownSize = null; wholeOutfitSize = false; patternSize = null; selected = 'front'; shown = '';
      $('garment-size-status').textContent = '';
      commit(next);
      options.notice(next.wornAlso ? `Editing the ${next.product!.name}. The ${next.wornWith!.name} and the ${next.wornAlso.name} stay in this outfit; you can undo the switch.`
        : `Editing the ${next.product!.name}. The ${next.wornWith!.name} stays in this outfit. Both garments are kept; you can undo the switch.`);
    } catch (error) { options.notice(error instanceof Error ? error.message : 'The worn garment cannot be edited.', true); }
  }
  $('edit-worn-garment').addEventListener('click', () => editOutfitGarment());
  editLayer.addEventListener('change', () => {
    const layer = editLayer.value;
    if (!currentLayer || layer === currentLayer || (layer !== 'inner' && layer !== 'outer' && layer !== 'bottoms')) return;
    // Restore the displayed selection before switching; a refused draft leaves it on the active garment.
    editLayer.value = currentLayer;
    editOutfitGarment(layer);
  });

  $('garment-tuck').addEventListener('change', () => {
    const box = $('garment-tuck') as HTMLInputElement, current = options.current(), design = product() ?? template('blank'), top = outfitTop(design), bottoms = isBottoms(design) ? design : companionOf(design);
    if (!top || !bottoms || !canTuck(top)) { box.checked = false; return; }
    const rest = { ...current };
    delete rest.tucked;
    commit(box.checked ? { ...rest, tucked: true } : rest);
    options.notice(box.checked ? `The ${top.name} is tucked into the ${bottoms.name}.${draping ? '' : ' Drape on a body to see it.'} You can undo this.` : `The ${top.name} is worn untucked, over the ${bottoms.name}. You can undo this.`);
  });

  // The drape test follows the selected part's fabric.
  const drapeTestPanel = mountDrapeTest(() => product()?.parts[selected].material ?? MATERIALS[0]!.id);
  // Inspector fields commit on change.
  $('part-material').addEventListener('change', () => applySwatch(selected, { kind: 'material', id: ($('part-material') as HTMLSelectElement).value }));
  $('part-color').addEventListener('change', () => applySwatch(selected, { kind: 'color', value: ($('part-color') as HTMLInputElement).value }));
  $('part-print').addEventListener('change', () => {
    const motif = ($('part-print') as HTMLSelectElement).value;
    if (motif) applySwatch(selected, { kind: 'print', motif: motif as Print['motif'] });
    else update(draft => { draft.parts[selected].print = null; }, `${label(selected)}: print removed.`);
  });
  for (const id of ['print-color', 'print-layout', 'print-scale']) $(id).addEventListener('change', () => update(draft => {
    const print = draft.parts[selected].print;
    if (!print) throw new Error('Choose a print for this part first.');
    print.color = ($('print-color') as HTMLInputElement).value; print.layout = ($('print-layout') as HTMLSelectElement).value as Print['layout'];
    print.scaleCm = Number(($('print-scale') as HTMLInputElement).value);
  }, `${label(selected)}: print updated.`));
  $('stripe-direction').addEventListener('change', () => update(draft => {
    const print = draft.parts[selected].print;
    if (print?.motif !== 'stripe') throw new Error('Choose stripes before setting their direction.');
    print.direction = ($('stripe-direction') as HTMLSelectElement).value as Print['direction'];
  }, `${label(selected)}: stripe direction updated.`));
  $('apply-all-parts').addEventListener('click', () => update(draft => {
    const style = draft.parts[selected];
    for (const id of partsOf(draft)) if (id !== selected) draft.parts[id] = RIB_PARTS.has(id) ? { ...structuredClone(style), material: draft.parts[id].material, print: null } : structuredClone(style);
  }, `Every part now uses the ${label(selected).toLowerCase()} style (rib trims keep their rib knit).`));
  // Describe a style: read locally, applied as one undoable edit, with what was understood and ignored reported.
  // For one part the words style that part; for the garment, garment words and named parts are read too.
  const describe = (garment: boolean) => {
    const prompt = ($('style-prompt') as HTMLInputElement).value;
    let summary = '';
    const applied = update(draft => {
      if (garment) {
        const reading = readDesignPrompt(prompt, draft);
        for (const key of Object.keys(draft) as (keyof Product)[]) delete draft[key];
        Object.assign(draft, reading.product);
        // Words in quotes are printed on their side of the garment, replacing that side's artwork.
        if (reading.text) {
          draft.artwork = draft.artwork.filter(art => art.part !== reading.text!.side);
          draft.artwork.push(textArtwork(reading.text, renderText(reading.text), topMeasurements(draft).chest));
        }
        summary = `${reading.scopes.map(scope => `${scope.label}: ${scope.understood.join('; ')}`).join('. ')}.${reading.ignored.length ? ` Not applied: ${reading.ignored.join(', ')}.` : ''}`;
        return;
      }
      const reading = readStylePrompt(prompt, draft.parts[selected]);
      draft.parts[selected] = reading.style;
      summary = `Understood: ${reading.understood.join('; ')}.${reading.ignored.length ? ` Not understood: ${reading.ignored.join(', ')}.` : ''}`;
    }, garment ? 'The description now shapes the garment. You can undo this.' : `${label(selected)} restyled from the description. You can undo this.`);
    $('describe-result').textContent = applied ? summary : '';
  };
  $('describe-part').addEventListener('click', () => describe(false));
  $('describe-all').addEventListener('click', () => describe(true));
  $('style-prompt').addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Enter') { event.preventDefault(); describe(false); } });
  $('product-name').addEventListener('change', () => update(draft => { draft.name = ($('product-name') as HTMLInputElement).value; }, 'Product renamed.', 'name'));
  $('apply-measurements').addEventListener('click', () => update(draft => {
    const value = (id: string) => Number(($(id) as HTMLInputElement).value);
    if (draft.base === 'skirt') {
      const gatherRaw=($('product-skirt-gather') as HTMLInputElement).value.trim(), gather=gatherRaw ? Number(gatherRaw) : 1;
      if (!Number.isFinite(gather) || gather < 1) throw new Error('Fill in waist gathering from 1 (none) to 2.');
      // Pleats left without a number or depth get pleats about 3 cm apart, folded half that deep (a box a quarter).
      const style=($('product-skirt-pleats') as HTMLSelectElement).value as PleatStyle | '', waist=value('product-skirt-waist');
      const countRaw=($('product-skirt-pleat-count') as HTMLInputElement).value.trim(), depthRaw=($('product-skirt-pleat-depth') as HTMLInputElement).value.trim();
      const count=countRaw ? Number(countRaw) : Math.max(PLEAT_COUNT[0], Math.min(PLEAT_COUNT[1], 2 * Math.round(waist / 6)));
      const depth=depthRaw ? Number(depthRaw) : Math.max(PLEAT_DEPTH[0], Math.floor(pleatDepthLimit(style || 'knife', count, waist) / 2 * 10) / 10);
      const hipRaw=($('product-skirt-hip') as HTMLInputElement).value.trim();
      draft.measurements = {waist,hem:value('product-skirt-hem'),slant:value('product-skirt-slant'),...(gather > 1 ? {gather} : {}),...(style ? {pleats:{style,count,depth}} : {}),...(hipRaw ? {hip:Number(hipRaw)} : {})};
      const raw=($('product-skirt-band') as HTMLInputElement).value;
      if(!raw.trim()) throw new Error('Fill in skirt waistband height, or 0 for none.');
      Object.assign(draft,withSkirtWaistband(draft,Number(raw)));
      return;
    }
    if (isBottoms(draft)) {
      const cuff = ($('product-leg-cuff') as HTMLInputElement).value.trim();
      if (cuff && (!Number.isFinite(Number(cuff)) || (Number(cuff) !== 0 && (Number(cuff) < LIMITS.legCuffHeight[0] || Number(cuff) > LIMITS.legCuffHeight[1])))) {
        throw new Error(`Ankle cuff height must be from ${LIMITS.legCuffHeight[0]} to ${LIMITS.legCuffHeight[1]} cm, or 0 for none.`);
      }
      draft.measurements = Object.fromEntries(LEG_FIELDS.map(([id, , key]) => [key, value(id)])
        .filter(([key, value]) => key !== 'waistbandHeight' || value !== WAISTBAND_CM)) as unknown as Product['measurements'];
      Object.assign(draft, withLegCuffs(draft, cuff ? Number(cuff) : 0));
      return;
    }
    const m = { chest: value('product-chest'), length: value('product-length'), sleeve: topMeasurements(draft).sleeve };
    draft.measurements = m;
    withSleeveLength(draft, value('product-sleeve'));
    draft.neckline = ($('product-neckline') as HTMLSelectElement).value as Product['neckline'];
    // Artwork that no longer fits the panel is pulled back inside rather than rejected.
    for (const art of draft.artwork) { const half = m.chest / 4 + 1; art.xCm = Math.max(-half, Math.min(half, art.xCm)); art.yCm = Math.min(art.yCm, m.length); }
  }, 'Measurements applied to the 3D garment and its pattern pieces.', 'measurements'));
  // Fit: a point of measure is stored only when it differs from its proportional value.
  $('apply-fit').addEventListener('click', () => update(draft => {
    const proportional = fitValues({ ...draft, fit: undefined }), fit: Product['fit'] = {};
    for (const key of FIT_KEYS) {
      if ((key === 'hoodHeight' || key === 'hoodWidth') && draft.base !== 'hoodie' || POCKET_FIT_KEYS.some(pocket => pocket === key) || key === 'neckRibHeight' && draft.base === 'hoodie' || (key === 'cuffHeight' || key === 'hemBandHeight') && draft.base === 'tee') continue;
      const raw = ($(`fit-${key}`) as HTMLInputElement).value;
      if (raw.trim() === '') throw new Error(`Fill in ${FIT_NAMES[key].toLowerCase()}.`);
      const value = Number(raw);
      // Displayed values are rounded to 0.1 cm, so an untouched field differs by at most 0.05.
      if (Math.abs(value - proportional[key]) > 0.06) fit[key] = value;
    }
    // Untouched pocket fields retain exact authored values or remain derived from the new body fit.
    const pocketDefaults = fitValues({ ...draft, fit });
    for (const key of POCKET_FIT_KEYS) {
      if (!optionsOf(draft).chestPocket || !drafts.has(`fit-${key}`)) {
        if (draft.fit?.[key] !== undefined) fit[key] = draft.fit[key];
        continue;
      }
      const raw = ($(`fit-${key}`) as HTMLInputElement).value;
      if (raw.trim() === '') throw new Error(`Fill in ${FIT_NAMES[key].toLowerCase()}.`);
      const value = Number(raw);
      if (Math.abs(value - pocketDefaults[key]) > 0.06) fit[key] = value;
    }
    if (Object.keys(fit).length) draft.fit = fit; else delete draft.fit;
  }, 'Fit applied: the pattern pieces, 3D garment and tech pack follow it.', 'fit'));
  $('reset-fit').addEventListener('click', () => update(draft => { delete draft.fit; }, 'Fit is proportional to the chest again. You can undo this.', 'fit'));
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-leg-preset]')) button.addEventListener('click', () => update(draft => {
    legMeasurements(draft).inseam = Number(button.dataset.legPreset);
  }, `${button.getAttribute('aria-label')}: the legs, pattern and tech pack follow it.`));

  // Artwork: transparent PNG kept, scaled to at most 1024 px.
  $('add-text-artwork').addEventListener('click', () => {
    const text = ($('artwork-text') as HTMLInputElement).value.trim().replace(/\s+/g, ' '), side = ($('artwork-side') as HTMLSelectElement).value as Artwork['part'];
    if (!text) { options.notice('Type the text to print first.', true); return; }
    update(draft => {
      if ([...text].length > MAX_TEXT) throw new Error(`Text on a garment can be up to ${MAX_TEXT} characters.`);
      const request = { text, side, color: ($('artwork-text-colour') as HTMLInputElement).value, font: ($('artwork-font') as HTMLSelectElement).value as TextFont };
      draft.artwork = draft.artwork.filter(art => art.part !== side);
      draft.artwork.push(textArtwork(request, renderText(request), topMeasurements(draft).chest));
    }, `“${text}” printed on the ${side}. Adjust its width and position below.`);
  });
  $('artwork-file').addEventListener('change', async () => {
    const input = $('artwork-file') as HTMLInputElement, file = input.files?.[0]; input.value = '';
    if (!file) return;
    const owned = beginAsset();
    let bitmap: ImageBitmap | undefined;
    const side = ($('artwork-side') as HTMLSelectElement).value as Artwork['part'];
    try {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 10 * 1024 * 1024) throw new Error('Choose a PNG, JPEG or WebP image of at most 10 MB.');
      bitmap = await decodeProductFile(file);
      if (!owned()) return;
      let edge = Math.min(1024, Math.max(bitmap.width, bitmap.height)), dataUrl = '', width = 0, height = 0;
      for (;;) {
        const scale = edge / Math.max(bitmap.width, bitmap.height), c = document.createElement('canvas');
        width = c.width = Math.max(1, Math.round(bitmap.width * scale)); height = c.height = Math.max(1, Math.round(bitmap.height * scale));
        c.getContext('2d')!.drawImage(bitmap, 0, 0, width, height); dataUrl = c.toDataURL('image/png');
        if (dataUrl.length <= LIMITS.artworkBytes * 1.33 || edge <= 128) break;
        edge = Math.max(128, Math.round(edge * 0.75));
      }
      update(draft => {
        draft.artwork = draft.artwork.filter(art => art.part !== side);
        draft.artwork.push({ part: side, dataUrl, width, height, name: file.name.slice(0, 120), xCm: 0, yCm: side === 'front' ? 10 : 12, widthCm: Math.min(24, topMeasurements(draft).chest / 4) });
      }, `Artwork placed on the ${side}. Adjust its width and position below.`);
    } catch (error) { if (owned()) options.notice(error instanceof Error ? error.message : 'That image could not be used.', true); }
    finally { bitmap?.close(); }
  });
  $('apply-artwork').addEventListener('click', () => update(draft => {
    const side = ($('artwork-side') as HTMLSelectElement).value, art = draft.artwork.find(item => item.part === side);
    if (!art) throw new Error(`Upload artwork for the ${side} first.`);
    art.widthCm = Number(($('artwork-width') as HTMLInputElement).value); art.xCm = Number(($('artwork-x') as HTMLInputElement).value); art.yCm = Number(($('artwork-y') as HTMLInputElement).value);
    art.rotation = ($('artwork-rotation') as HTMLInputElement).valueAsNumber;
  }, 'Artwork placement applied.', 'artwork'));
  $('remove-artwork').addEventListener('click', () => update(draft => {
    const side = ($('artwork-side') as HTMLSelectElement).value;
    if (!draft.artwork.some(art => art.part === side)) throw new Error(`There is no artwork on the ${side}.`);
    draft.artwork = draft.artwork.filter(art => art.part !== side);
  }, 'Artwork removed.'));
  let artworkSide = ($('artwork-side') as HTMLSelectElement).value;
  $('artwork-side').addEventListener('change', () => {
    const field = $('artwork-side') as HTMLSelectElement;
    if (hasDrafts('artwork')) { field.value = artworkSide; options.notice('Apply or discard artwork placement drafts before changing side. Your drafts are kept.', true); return; }
    artworkSide = field.value; render(options.current(), true);
  });

  // Modules: each switch is one undoable edit, and every view follows it.
  const setModules = (change: (current: ReturnType<typeof optionsOf>) => ReturnType<typeof optionsOf>, text: string) => {
    if (hasDrafts('fit')) { options.notice('Apply or discard pending fit edits before changing modules. Your drafts are kept.', true); render(options.current()); return; }
    const current = product() ?? template('blank');
    try { commit({ ...options.current(), product: validateProduct(withOptions(current, change(optionsOf(current)))) }); options.notice(text); }
    catch (error) { options.notice(error instanceof Error ? error.message : 'That module is not available.', true); render(options.current()); }
  };
  $('product-hem').addEventListener('change', () => {
    const hem = ($('product-hem') as HTMLSelectElement).value as (typeof HEMS)[number];
    setModules(current => ({ ...current, hem }), `${HEM_NAMES[hem]} hem: the 3D garment, pattern pieces and tech pack follow it.`);
  });
  $('product-collar').addEventListener('change', () => {
    const on = ($('product-collar') as HTMLInputElement).checked;
    if (on) selected = 'collar';
    else if (selected === 'collar' || selected === 'placket') selected = 'front';
    const current = product() ?? template('blank'), polo = current.base === 'tee' && !optionsOf(current).buttons, shirt = current.base === 'tee' && !polo;
    setModules(current => { const others = { ...current }; delete others.collar; return on ? { ...others, collar: true } : others; },
      shirt ? (on ? 'Shirt collar added, in the shirt’s own fabric. You can undo this.' : 'Shirt collar removed. You can undo this.')
        : polo ? (on ? 'Polo collar and placket added: a flat-knit collar in the neck rib’s style, and a three-button placket. You can undo this.' : 'Polo collar removed: a round neck rib again. You can undo this.')
        : on ? 'Rib stand collar added in the neck rib’s style: with a front zip, a bomber jacket. You can undo this.' : 'Stand collar removed: a round neck rib again. You can undo this.');
  });
  $('product-zip').addEventListener('change', () => {
    const on = ($('product-zip') as HTMLInputElement).checked;
    setModules(current => { const others = { ...current }; delete others.zip; delete others.zipOpen; return on ? { ...others, zip: true } : others; },
      on ? `Front zip added: the front${(product() ?? template('blank')).base === 'hoodie' ? ', pocket' : ''} and hem band are cut as halves, and the tech pack lists the zip. You can undo this.`
        : `Front zip removed: a pullover ${(product() ?? template('blank')).base === 'hoodie' ? 'hoodie' : 'sweatshirt'} again. You can undo this.`);
  });
  $('product-zip-open').addEventListener('change', () => {
    const on = ($('product-zip-open') as HTMLInputElement).checked, buttoned = !!optionsOf(product() ?? template('blank')).buttons;
    setModules(current => { const others = { ...current }; delete others.zipOpen; return on ? { ...others, zipOpen: true } : others; },
      buttoned ? (on ? 'Worn open: the front halves part at the placket, and hang apart when draped. You can undo this.' : 'Buttoned up again. You can undo this.')
        : on ? 'Worn open: the front halves and hem band part at the zip, and hang apart when draped. You can undo this.' : 'Zipped up again. You can undo this.');
  });
  $('product-buttons').addEventListener('change', () => {
    const on = ($('product-buttons') as HTMLInputElement).checked;
    if (on) selected = 'placket';
    else if (selected === 'placket' && !optionsOf(product() ?? template('blank')).collar) selected = 'front';
    setModules(current => { const others = { ...current }; delete others.buttons; delete others.zipOpen; return on ? { ...others, buttons: true } : others; },
      on ? 'Button front added: the front is cut as halves joined by a buttoned placket; with the collar it is a shirt. You can undo this.' : 'Button front removed. You can undo this.');
  });
  $('product-chest-pocket').addEventListener('change', () => {
    const on = ($('product-chest-pocket') as HTMLInputElement).checked;
    if (on) selected = 'chestPocket';
    setModules(current => ({ ...current, chestPocket: on }), on ? 'Chest pocket added in the front body’s style. Style it like any other part.' : 'Chest pocket removed. You can undo this.');
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-sleeve-preset]')) button.addEventListener('click', () => update(draft => {
    if (Number(button.dataset.sleevePreset) === 0 && draft.base !== 'tee') throw new Error('Only a T-shirt can be made sleeveless.');
    withSleeveLength(draft, Number(button.dataset.sleevePreset));
  }, `${button.getAttribute('aria-label')}: the sleeves, pattern and tech pack follow it.`));

  function captureDrape(design: Product): GarmentDrapeResult | null {
    const result = currentDrape(design);
    if (draping && !result) throw new Error('Wait for the garment to settle, or choose Show styling shell before exporting.');
    return result ? structuredClone(result) : null;
  }

  // Exports.
  const exporting = async (action: () => Promise<void>) => { try { await action(); } catch (error) { options.notice(error instanceof Error ? error.message : 'Export failed.', true); } };
  for (const [id, kind, suffix] of [['product-png-front', 'front', '-front.png'], ['product-png-back', 'back', '-back.png'], ['product-glb', 'glb', '.glb'], ['product-turntable', 'turntable', '-turntable.webm']] as const) {
    const button = $(id) as HTMLButtonElement;
    button.addEventListener('click', () => void exporting(async () => {
      if (button.disabled) return;
      const snapshot = structuredClone(options.current()), sample = snapshot.product ?? template('blank'), includeWorn = ($('export-outfit') as HTMLInputElement).checked;
      const appliedCompanion = includeWorn ? snapshot.wornWith ?? null : null, appliedAlso = includeWorn && snapshot.wornAlso && appliedCompanion && threePiece([sample, appliedCompanion, snapshot.wornAlso]) ? snapshot.wornAlso : null;
      const { product: design, companion, also } = outfitViewed(sample, appliedCompanion, appliedAlso);
      if (includeWorn && (!companion || !draping)) throw new Error('Drape the outfit and wait for it to settle before exporting both garments.');
      const settled = captureDrape(sample);
      if (includeWorn && (!settled?.companion || (also && !settled.also))) throw new Error('Drape the outfit and wait for it to settle before exporting its garments together.');
      button.disabled = true;
      try {
        if (kind !== 'glb' && !await ready) throw new Error('The 3D view is unavailable.');
        const exports = await import('./product-3d.ts');
        const blob = kind === 'glb' ? new Blob([await exports.productSnapshotGlb(design, settled, companion, also)], {type:'model/gltf-binary'})
          : kind === 'turntable' ? await exports.productSnapshotTurntable(design, settled, companion, also)
          : await exports.productSnapshotPng(design, kind, settled, companion, also);
        options.download(blob, `${includeWorn ? '-outfit' : ''}${suffix}`, snapshot.title);
      } finally { button.disabled = false; }
    }));
  }

  $('outfit-bundle').addEventListener('click', () => void exporting(async () => {
    if (hasDrafts()) { refuseDrafts(); return; }
    const snapshot = structuredClone(options.current()), value = ($('outfit-export-size') as HTMLSelectElement).value;
    if (value && !SIZES.includes(value as Size)) throw new Error('Choose an outfit export size from XS to XL.');
    const size = value ? value as Size : undefined;
    options.download(new Blob([buildOutfitBundle(snapshot, today(), size)], { type: 'application/zip' }), `${size ? `-size-${size}` : ''}-outfit-patterns-tech-packs.zip`, snapshot.title);
  }));

  // Tech pack: details are part of the design; the pack itself is always derived from it.
  $('apply-spec').addEventListener('click', () => update(draft => {
    draft.spec = { styleNumber: ($('spec-style') as HTMLInputElement).value, season: ($('spec-season') as HTMLInputElement).value, sampleSize: ($('spec-size') as HTMLSelectElement).value as Size };
  }, 'Tech pack details applied.', 'spec'));
  const today = () => new Date().toISOString().slice(0, 10);
  const dataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('The render could not be read.')); reader.readAsDataURL(blob); });
  $('techpack-xlsx').addEventListener('click', () => void exporting(async () => {
    const pack = buildTechPack(product() ?? template('blank'), today());
    options.download(new Blob([techPackXlsx(pack)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), '-tech-pack.xlsx');
  }));
  $('techpack-html').addEventListener('click', () => void exporting(async () => {
    const button = $('techpack-html') as HTMLButtonElement;
    if (button.disabled) return;
    const snapshot = structuredClone(options.current()), design = snapshot.product ?? template('blank'), date = today();
    // The diagram and tables describe the sample, so a different size's drape cannot supply its images.
    const settled = viewed(design) === design ? captureDrape(design) : null;
    button.disabled = true;
    try {
      const available = await ready;
      const renders = available ? await (await import('./product-3d.ts')).productSnapshotRenders(design, settled) : null;
      const images = { diagram: measurementDiagram(design), ...(renders ? { front: await dataUrl(renders.front), back: await dataUrl(renders.back) } : {}) };
      options.download(new Blob([techPackHtml(buildTechPack(design, date), images)], { type: 'text/html' }), '-tech-pack.html', snapshot.title);
    } finally { button.disabled = false; }
  }));

  // Colorways: snapshots of the part styles, applied back as one undoable edit; units feed the range plan.
  const nameOf = (id: string) => product()?.colorways?.find(c => c.id === id)?.name ?? 'colorway';
  $('save-colorway').addEventListener('click', () => {
    const name = ($('colorway-name') as HTMLInputElement).value.trim() || `Colorway ${(product()?.colorways?.length ?? 0) + 1}`;
    update(draft => {
      const colorways = draft.colorways ?? [];
      if (colorways.length >= LIMITS.colorways) throw new Error(`Keep at most ${LIMITS.colorways} colorways; delete one first.`);
      draft.colorways = [...colorways, { id: nextColorwayId(colorways), name, parts: structuredClone(draft.parts), units: 0 }];
    }, `Saved the current styling as the colorway “${name}”.`);
    ($('colorway-name') as HTMLInputElement).value = '';
  });
  $('colorway-list').addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-colorway-action]');
    if (!button) return;
    const id = button.dataset.colorway!, name = nameOf(id);
    if (button.dataset.colorwayAction === 'apply') update(draft => { draft.parts = structuredClone(draft.colorways!.find(c => c.id === id)!.parts); }, `The editor now shows the colorway “${name}”.`);
    if (button.dataset.colorwayAction === 'replace') update(draft => { draft.colorways!.find(c => c.id === id)!.parts = structuredClone(draft.parts); }, `Updated “${name}” from the current styling.`);
    if (button.dataset.colorwayAction === 'delete' && hasDrafts('colorways')) { options.notice('Apply or discard colorway details before deleting a colorway. Your drafts are kept.', true); return; }
    if (button.dataset.colorwayAction === 'delete') update(draft => { draft.colorways = draft.colorways!.filter(c => c.id !== id); if (!draft.colorways.length) delete draft.colorways; }, `Deleted the colorway “${name}”. You can undo this.`);
  });
  $('apply-colorway-details').addEventListener('click', () => {
    const changed = update(draft => {
      for (const colorway of draft.colorways ?? []) {
        const name=$<HTMLInputElement>(`range-name-${colorway.id}`),units=$<HTMLInputElement>(`range-units-${colorway.id}`);
        if (!name.value.trim()) throw new Error('Name each colorway before applying the details.');
        if (units.validity.badInput || !units.value.trim()) throw new Error('Fill in a whole planned quantity for every colorway.');
        colorway.name=name.value; colorway.units=Number(units.value);
      }
    }, 'Colorway names and planned units applied together. You can undo this.', 'colorways');
    if (changed) { shown=''; render(options.current()); }
  });
  $('discard-colorway-details').addEventListener('click', () => {
    for (const id of drafts.keys()) if (groupOf(id)==='colorways') drafts.delete(id);
    shown=''; render(options.current()); options.notice('Colorway details discarded. Applied collection unchanged.');
  });
  $('apply-costing').addEventListener('click', () => update(draft => {
    const number = (id: string) => { const value = ($(id) as HTMLInputElement).value; if (value.trim() === '') throw new Error('Fill in every costing value.'); return Number(value); };
    const prices = { ...costing(draft).fabricPrices };
    for (const input of document.querySelectorAll<HTMLInputElement>('#fabric-prices input[data-fabric-price]')) prices[input.dataset.fabricPrice!] = number(input.id);
    draft.costing = { currency: ($('cost-currency') as HTMLSelectElement).value as Costing['currency'], retail: number('cost-retail'), make: number('cost-make'),
      trims: number('cost-trims'), printPerArtwork: number('cost-print'), fabricPrices: prices };
  }, 'Costing applied to the range plan.', 'costing'));
  for (const format of ['dxf', 'svg'] as const) $('pattern-' + format).addEventListener('click', () => void exporting(async () => {
    const design = product() ?? template('blank'), size = patternSize ?? sampleOf(design);
    // Validate again against the latest applied measurements. Never substitute sample geometry for an invalid grade.
    const graded = gradedProduct(design, size), suffix = size === sampleOf(design) ? '' : `-size-${size}`;
    const content = format === 'dxf' ? patternDxf(graded) : patternSvg(graded);
    options.download(new Blob([content], { type: format === 'dxf' ? 'application/dxf' : 'image/svg+xml' }), `${suffix}-pattern.${format}`);
  }));
  $('range-xlsx').addEventListener('click', () => void exporting(async () => {
    options.download(new Blob([rangePlanXlsx(product() ?? template('blank'), today())], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), '-range-plan.xlsx');
  }));

  // Colorway thumbnails are front renders from the 3D view, made one at a time and cached by look.
  const thumbnails = new Map<string, string>();
  let thumbnailRun = 0;
  const lookOf = (design: Product, parts: Product['parts']) =>
    JSON.stringify([design.measurements, design.neckline, optionsOf(design), design.fit ?? null, design.artwork, parts, (design.motifs ?? []).map(m => [m.id, m.dataUrl.length, !!motifImage(m.dataUrl)])]);
  let thumbnailScene: Promise<import('./product-3d.ts').ProductScene | null> | null = null;
  async function refreshThumbnails(design: Product) {
    const run = ++thumbnailRun;
    // A separate, detached scene, so the garment being edited never changes on screen.
    thumbnailScene ??= ready.then(async visible => visible && new (await import('./product-3d.ts')).ProductScene(document.createElement('canvas')));
    const s = await thumbnailScene;
    if (!s || run !== thumbnailRun) return;
    for (const colorway of design.colorways ?? []) {
      const look = lookOf(design, colorway.parts);
      if (!thumbnails.has(look)) {
        s.setProduct({ ...design, parts: colorway.parts }, null);
        thumbnails.set(look, URL.createObjectURL(await s.png('front')));
        if (run !== thumbnailRun) return;
      }
      const image = document.querySelector<HTMLImageElement>(`#colorway-list img[data-colorway-thumb="${colorway.id}"]`);
      if (image) image.src = thumbnails.get(look)!;
    }
  }

  function rangeMarkup(design: Product) {
    const plan = rangePlan(design), symbol = CURRENCY_SYMBOLS[plan.currency], m = (value: number) => `${symbol}${value.toFixed(2)}`;
    const head = ['Colorway', 'Units', 'Fabric', 'Trims', 'Print', 'Make', 'Unit cost', 'Retail', 'Margin', 'Total cost', 'Revenue'];
    const cells = (row: (string | number)[]) => row.map(cell => `<td>${escapeHtml(String(cell))}</td>`).join('');
    return `<h5>Range plan (${plan.currency})</h5><div class="table-scroll"><table><thead><tr>${head.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${plan.rows.map(r =>
      `<tr data-range-row="${r.id}">${cells([r.name, r.units, m(r.fabric), m(r.trims), m(r.print), m(r.make), m(r.unitCost), m(r.retail), r.margin === null ? '—' : `${r.margin}%`, m(r.totalCost), m(r.totalRevenue)])}</tr>`).join('')}
      <tr class="range-total">${cells(['Total', plan.totals.units, '', '', '', '', '', '', plan.totals.margin === null ? '—' : `${plan.totals.margin}%`, m(plan.totals.totalCost), m(plan.totals.totalRevenue)])}</tr></tbody></table></div>
      ${design.colorways?.length ? '' : '<p class="notes">Save colorways to plan several at once; until then the current design is shown with no planned units.</p>'}`;
  }
  function renderRange(design: Product) {
    // Keep draft inputs mounted across async image/drape redraws and styling edits.
    const details=JSON.stringify((design.colorways??[]).map(c=>[c.id,c.name,c.units]));
    if ($('colorway-list').dataset.details!==details) {
    $('colorway-list').dataset.details=details;
    $('colorway-list').innerHTML = (design.colorways ?? []).map(c => `<div role="listitem" class="colorway-card">
      <img data-colorway-thumb="${c.id}" alt="Front render of ${escapeHtml(c.name)}" width="160" height="140">
      <strong>${escapeHtml(c.name)}</strong>
      <label class="field">Saved name for ${escapeHtml(c.name)}<input id="range-name-${c.id}" maxlength="${LIMITS.colorwayName}" value="${escapeHtml(c.name)}" autocomplete="off"></label>
      <label class="field">Units for ${escapeHtml(c.name)}<input type="number" min="0" max="${LIMITS.units[1]}" step="1" value="${c.units}" id="range-units-${c.id}" data-colorway-units="${c.id}"></label>
      <div class="inline-actions"><button data-colorway-action="apply" data-colorway="${c.id}" aria-label="Show ${escapeHtml(c.name)} in the editor">Show in editor</button>
        <button class="quiet" data-colorway-action="replace" data-colorway="${c.id}" aria-label="Update ${escapeHtml(c.name)} from the current styling">Update</button>
        <button class="quiet" data-colorway-action="delete" data-colorway="${c.id}" aria-label="Delete ${escapeHtml(c.name)}">Delete</button></div></div>`).join('')
      || '<p class="fine-print">No colorways yet. Style the garment, name it above and save it; then restyle and save the next.</p>';
    }
    for (const c of design.colorways??[]) {
      for (const [id,value] of [[`range-name-${c.id}`,c.name],[`range-units-${c.id}`,String(c.units)]]) {
        if (!drafts.has(id!)) $<HTMLInputElement>(id!).value=value!;
      }
    }
    if (!hasDrafts('costing')) {
    const inputs = costing(design);
    ($('cost-currency') as HTMLSelectElement).value = inputs.currency;
    for (const [id, value] of [['cost-retail', inputs.retail], ['cost-make', inputs.make], ['cost-trims', inputs.trims], ['cost-print', inputs.printPerArtwork]] as const) ($(id) as HTMLInputElement).value = String(value);
    const used = [...new Set([design.parts, ...(design.colorways ?? []).map(c => c.parts)].flatMap(parts => partsOf(design).map(id => parts[id].material)))];
    $('fabric-prices').innerHTML = used.map(id => `<label class="field">${escapeHtml(material(id).name)} per m<input type="number" min="0" max="${LIMITS.price[1]}" step="0.01" value="${inputs.fabricPrices[id] ?? DEFAULT_COSTING.fabricPrices[id] ?? 0}" id="cost-price-${id}" data-fabric-price="${id}"></label>`).join('');
    }
    $('range-table').innerHTML = rangeMarkup(design);
    void refreshThumbnails(design);
  }

  let motifsShown = '';
  function renderMotifs(design: Product) {
    const motifs = design.motifs ?? [], signature = JSON.stringify(motifs.map(m => [m.id, m.name, m.dataUrl.length]));
    if (signature === motifsShown) return;
    motifsShown = signature;
    $('uploaded-motifs').innerHTML = motifs.map(m => `<div class="uploaded-motif"><button class="library-swatch" draggable="true" data-swatch='${JSON.stringify({ kind: 'print', motif: `upload:${m.id}` })}' aria-label="Apply ${escapeHtml(m.name)} print"><img src="${m.dataUrl}" alt="" width="44" height="44"><span>${escapeHtml(m.name)}<small>Your motif</small></span></button>
      <button class="quiet remove-motif" data-remove-motif="${m.id}" aria-label="Remove motif ${escapeHtml(m.name)}">×</button></div>`).join('');
    const select = $('part-print') as HTMLSelectElement;
    select.innerHTML = `<option value="">No print</option>${MOTIFS.map(m => `<option value="${m}">${MOTIF_NAMES[m]}</option>`).join('')}${motifs.map(m => `<option value="upload:${m.id}">${escapeHtml(m.name)} (your motif)</option>`).join('')}`;
  }

  // Direct pattern editing: front and back neckline handles plus front-piece handles move its shoulder point, neck point, neck drop, underarm and
  // hem corner. Each is a slider over one fit measurement; a drag or an arrow key is one undoable edit.
  type Handle = { part?: 'front' | 'back'; key: FitKey; axis: 'x' | 'y'; x: number; y: number; label: string; value: (x: number, y: number) => number; widens: boolean };
  let handlesShown: Handle[] = [];
  function fitHandles(design: Product): Handle[] {
    if (isBottoms(design)) return [];
    const d = teeDimensions(design), cx = flare(design) + d.half, armY = d.shoulderDrop + d.armDepth, full = d.length - armY;
    // The hem corner sits where the side seam meets the hem, or the hem band seam on banded bases.
    const hemY = d.band ? d.length - d.band : d.length, ratio = full / (hemY - armY), inset = (d.half - d.hemHalf) / ratio;
    return [
      { key: 'shoulderWidth', axis: 'x', x: cx - d.shoulderX, y: d.shoulderDrop, label: 'Shoulder point', value: x => 2 * (cx - x), widens: true },
      { key: 'shoulderDrop', axis: 'y', x: cx + d.shoulderX, y: d.shoulderDrop, label: 'Shoulder height', value: (_, y) => y, widens: false },
      { key: 'neckWidth', axis: 'x', x: cx - d.neckHalf, y: 0, label: 'Neck point', value: x => 2 * (cx - x), widens: true },
      { key: 'backNeckDrop', part: 'back', axis: 'y', x: cx, y: d.neckDepthBack, label: 'Back neck', value: (_, y) => y, widens: false },
      { key: 'frontNeckDrop', axis: 'y', x: cx, y: d.neckDepthFront, label: 'Front neck', value: (_, y) => y, widens: false },
      { key: 'armholeDepth', axis: 'y', x: cx - d.half, y: armY, label: 'Underarm', value: (_, y) => y - d.shoulderDrop, widens: false },
      { key: 'hemWidth', axis: 'x', x: cx - d.half + inset, y: hemY - (d.band ? 0 : d.hemCurve), label: 'Hem corner',
        value: x => 2 * (d.half - (x - cx + d.half) * ratio), widens: true },
    ];
  }
  const fitValue = (design: Product, key: FitKey) => fitValues(design)[key];
  function piecesSvg(design: Product): string {
    const pieces = patternPieces(design), gap = 6, scale = 3;
    let x = 0; const placed = pieces.map(piece => { const at = x; x += piece.width + gap; return { piece, at }; });
    handlesShown = fitHandles(design);
    const partAt = (part: 'front' | 'back') => placed.find(item => item.piece.part === part)?.at ?? 0;
    const frontAt = placed.find(item => item.piece.part === 'front')?.at ?? 0;
    const handles = handlesShown.map(h => `<circle data-fit-handle="${h.key}" data-fit-part="${h.part ?? 'front'}" cx="${(h.x + partAt(h.part ?? 'front') - frontAt).toFixed(2)}" cy="${h.y.toFixed(2)}" r="1.5" tabindex="0" role="slider" aria-label="${h.label}: ${FIT_NAMES[h.key]}"
      aria-valuemin="${LIMITS.fit[h.key][0]}" aria-valuemax="${LIMITS.fit[h.key][1]}" aria-valuenow="${(Math.round(fitValue(design, h.key) * 10) / 10)}" aria-valuetext="${(Math.round(fitValue(design, h.key) * 10) / 10)} cm" aria-orientation="${h.axis === 'x' ? 'horizontal' : 'vertical'}"><title>${h.label}: drag to change ${FIT_NAMES[h.key].toLowerCase()}</title></circle>`).join('');
    const handleLayer = handles ? `<g class="fit-handles" transform="translate(${frontAt} 0)">${handles}<text class="fit-readout" x="0" y="-0.5" font-size="3"></text></g>` : '';
    const height = Math.max(...pieces.map(p => p.height));
    const defs = partsOf(design).map(id => {
      const { canvas: tile, tileCm } = paintTile(design.parts[id], undefined, design.motifs);
      return `<pattern id="fill-${id}" patternUnits="userSpaceOnUse" width="${tileCm}" height="${tileCm}"><image href="${tile.toDataURL('image/png')}" width="${tileCm}" height="${tileCm}"/></pattern>`;
    }).join('');
    return `<svg viewBox="-2 -2 ${x + 4} ${height + 12}" width="${(x + 4) * scale}" role="group" aria-label="Pattern pieces: ${pieces.map(p => partName(design, p.part)).join(', ')}"><defs>${defs}</defs>${placed.map(({ piece, at }) => `<g transform="translate(${at} 0)" data-piece="${piece.part}" class="pattern-piece${piece.part === selected ? ' is-selected' : ''}" tabindex="0" role="button" aria-label="${partName(design, piece.part)}, ${piece.width.toFixed(1)} by ${piece.height.toFixed(1)} cm"><polygon points="${piece.outline.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}" fill="url(#fill-${piece.part})" stroke="#4b3b2f" stroke-width="0.4"/>${(piece.darts ?? []).map(dart => `<polyline class="dart-line" points="${dart.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}" fill="none" stroke="#4b3b2f" stroke-width="0.3"/>`).join('')}${(piece.pleats ?? []).map(line => `<line class="pleat-line" x1="${line.fold[0].x.toFixed(2)}" y1="${line.fold[0].y.toFixed(2)}" x2="${line.fold[1].x.toFixed(2)}" y2="${line.fold[1].y.toFixed(2)}" stroke="#4b3b2f" stroke-width="0.25"/><line class="pleat-line" x1="${line.placement[0].x.toFixed(2)}" y1="${line.placement[0].y.toFixed(2)}" x2="${line.placement[1].x.toFixed(2)}" y2="${line.placement[1].y.toFixed(2)}" stroke="#4b3b2f" stroke-width="0.25" stroke-dasharray="1 0.8"/>`).join('')}<text x="${piece.width / 2}" y="${height + 8}" text-anchor="middle" font-size="3.4">${partName(design, piece.part)} · ${piece.width.toFixed(0)}×${piece.height.toFixed(0)} cm</text></g>`).join('')}${handleLayer}</svg>`;
  }
  function commitFit(key: FitKey, value: number) {
    if (hasDrafts('fit')) { options.notice('Apply or discard pending fit edits before using fit handles. Your drafts are kept.', true); return; }
    const rounded = Math.round(value * 2) / 2;
    update(draft => { draft.fit = { ...(draft.fit ?? {}), [key]: rounded }; }, `${FIT_NAMES[key]} ${rounded} cm: the pattern, 3D garment and tech pack follow it.`);
    // A refused value snaps the handle back.
    shown = ''; render(options.current());
  }
  let drag: { handle: Handle; circle: SVGCircleElement; layer: SVGGElement; value: number; moved: boolean } | null = null;
  const toLayer = (layer: SVGGElement, event: PointerEvent) => new DOMPoint(event.clientX, event.clientY).matrixTransform(layer.getScreenCTM()!.inverse());
  $('product-pieces').addEventListener('pointerdown', event => {
    const circle = (event.target as Element).closest<SVGCircleElement>('[data-fit-handle]');
    const handle = circle && handlesShown.find(item => item.key === circle.dataset.fitHandle);
    if (!circle || !handle) return;
    if (hasDrafts('fit')) { options.notice('Apply or discard pending fit edits before using fit handles. Your drafts are kept.', true); return; }
    event.preventDefault();
    circle.setPointerCapture(event.pointerId);
    drag = { handle, circle, layer: circle.parentNode as SVGGElement, value: fitValue(product() ?? template('blank'), handle.key), moved: false };
  });
  $('product-pieces').addEventListener('pointermove', event => {
    if (!drag) return;
    const point = toLayer(drag.layer, event), [low, high] = LIMITS.fit[drag.handle.key];
    drag.value = Math.min(high, Math.max(low, drag.handle.value(point.x, point.y))); drag.moved = true;
    if (drag.handle.axis === 'x') drag.circle.setAttribute('cx', point.x.toFixed(2)); else drag.circle.setAttribute('cy', point.y.toFixed(2));
    const readout = drag.layer.querySelector('.fit-readout')!;
    readout.setAttribute('x', drag.circle.getAttribute('cx')!); readout.setAttribute('y', String(Number(drag.circle.getAttribute('cy')) - 3));
    readout.textContent = `${FIT_NAMES[drag.handle.key]} ${(Math.round(drag.value * 2) / 2).toFixed(1)} cm`;
  });
  const endDrag = () => { if (!drag) return; const { handle, value, moved } = drag; drag = null; if (moved) commitFit(handle.key, value); };
  $('product-pieces').addEventListener('pointerup', endDrag);
  $('product-pieces').addEventListener('pointercancel', () => { drag = null; shown = ''; render(options.current()); });
  $('product-pieces').addEventListener('click', event => {
    if ((event.target as Element).closest('[data-fit-handle]')) return;
    const piece = (event.target as Element).closest<SVGGElement>('[data-piece]'); if (!piece) return;
    selected = piece.dataset.piece as PartId; render(options.current());
  });
  $('product-pieces').addEventListener('keydown', event => {
    const circle = (event.target as Element).closest<SVGCircleElement>('[data-fit-handle]');
    const handle = circle && handlesShown.find(item => item.key === circle.dataset.fitHandle);
    if (handle) {
      // Arrow keys move the handle 0.5 cm; moving a left-side point outward widens the measurement.
      const step = { ArrowLeft: handle.widens ? 0.5 : 0, ArrowRight: handle.widens ? -0.5 : 0, ArrowDown: handle.widens ? 0 : 0.5, ArrowUp: handle.widens ? 0 : -0.5 }[event.key];
      if (step) { event.preventDefault(); const key = handle.key; commitFit(key, fitValue(product() ?? template('blank'), key) + step); ($('product-pieces').querySelector(`[data-fit-handle="${key}"]`) as SVGCircleElement | null)?.focus(); }
      return;
    }
    const piece = (event.target as Element).closest<SVGGElement>('[data-piece]');
    if (piece && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); selected = piece.dataset.piece as PartId; render(options.current()); }
  });

  function render(project: Project, sideOnly = false) {
    const bodyKey=JSON.stringify(project.topBody??null);
    if(bodyKey!==shownBody){
      shownBody=bodyKey;retireAssets();stopDrape();drape=null;failedDrapeKey='';
      bodyChest=project.topBody?.chest??null;bodyWaist=project.topBody?.waist??null;
      bodyHip=project.topBody?.hip??null;bodyDepth=project.topBody?.chestDepth??null;bodyHeight=project.topBody?.height??null;bodyHipDepth=project.topBody?.hipDepth??null;bodyArmGirth=project.topBody?.upperArmGirth??null;bodyNeckGirth=project.topBody?.neckGirth??null;bodyUnderbust=project.topBody?.underbust??null;
    }
    const active = document.activeElement instanceof HTMLInputElement ? document.activeElement : null;
    const selection = active && drafts.has(active.id) && active.selectionStart !== null ? [active.selectionStart, active.selectionEnd!, active.selectionDirection ?? 'none'] as const : null;
    const finishDrafts = () => { restoreDrafts(); if (active && selection && document.activeElement === active) active.setSelectionRange(...selection); };
    const design = project.product ?? template('blank');
    // Applied edits can invalidate a previously valid grade. Do not leave its label on a sample-sized fallback.
    if (!companionOf(design)) wholeOutfitSize = false;
    if (shownSize || wholeOutfitSize) try { if (wholeOutfitSize) outfitViewed(design); else gradedProduct(design, shownSize!); }
    catch (error) {
      if (wholeOutfitSize) {
        $('garment-size-status').textContent = `Size ${shownSize ?? sampleOf(design)} could not be shown for the whole outfit. ${error instanceof Error ? error.message : 'Check its measurements.'} Showing applied sample sizes. Your applied design is kept.`;
        wholeOutfitSize = false; shownSize = null;
      } else {
        $('garment-size-status').textContent = `Size ${shownSize} was outside the supported measurements. Showing the sample size ${sampleOf(design)}. Your applied design is kept.`;
        shownSize = null;
      }
    }
    if(pickOwner&&(pickOwner.design!==design||pickOwner.side!==($('artwork-side') as HTMLSelectElement).value))finishPicking('The design or artwork side changed. Pick again.');
    let compared: ReturnType<typeof comparisonBody> | null = null;
    try { compared = comparisonBody(design); } catch { compared = null; }
    fabricComparison.sync(project.product??null,compared);
    if (!partsOf(design).includes(selected)) selected = 'front';
    const style = design.parts[selected], side = ($('artwork-side') as HTMLSelectElement).value, art = design.artwork.find(item => item.part === side);
    ($('artwork-width') as HTMLInputElement).value = String(art?.widthCm ?? ''); ($('artwork-x') as HTMLInputElement).value = String(art?.xCm ?? ''); ($('artwork-y') as HTMLInputElement).value = String(art?.yCm ?? ''); ($('artwork-rotation') as HTMLInputElement).value = String(art ? art.rotation ?? 0 : '');
    $('remove-artwork').toggleAttribute('disabled', !art); $('apply-artwork').toggleAttribute('disabled', !art);
    $('pick-artwork').toggleAttribute('disabled', !art);
    if (sideOnly) { finishDrafts(); return; }
    $('inspector-heading').textContent = label(selected);
    const partList = partsOf(design).join();
    if ($('part-list').dataset.parts !== partList) {
      $('part-list').dataset.parts = partList;
      $('part-list').innerHTML = partsOf(design).map(id => `<label><input type="radio" name="product-part" value="${id}"> ${partName(design, id)}</label>`).join('');
    }
    for (const radio of document.querySelectorAll<HTMLInputElement>('input[name=product-part]')) radio.checked = radio.value === selected;
    // A hoodie has a hood instead of a V-neck.
    ($('product-neckline') as HTMLSelectElement).querySelector<HTMLOptionElement>('option[value=v]')!.disabled = design.base === 'hoodie';
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-sleeve-preset="0"]')) button.hidden = design.base !== 'tee';
    const modules = optionsOf(design), pocket = $('product-chest-pocket') as HTMLInputElement;
    ($('product-hem') as HTMLSelectElement).value = modules.hem;
    ($('product-hem') as HTMLSelectElement).querySelector<HTMLOptionElement>('option[value=curved]')!.disabled = !hemAllowed(design.base, 'curved');
    $('pocket-fit-fields').hidden = !modules.chestPocket;
    pocket.checked = modules.chestPocket; pocket.disabled = !chestPocketAllowed(design.base);
    const collar = $('product-collar') as HTMLInputElement;
    collar.checked = !!modules.collar; collar.disabled = !collarAllowed(design.base) || design.neckline !== 'crew'; collar.closest('label')!.hidden = !collarAllowed(design.base);
    $('product-collar-name').textContent = design.base === 'sweatshirt' ? 'Rib stand collar' : modules.buttons ? 'Shirt collar' : 'Polo collar and placket';
    const zip = $('product-zip') as HTMLInputElement;
    zip.checked = !!modules.zip; zip.disabled = !zipAllowed(design.base); zip.closest('label')!.hidden = !zipAllowed(design.base);
    const open = $('product-zip-open') as HTMLInputElement;
    open.checked = !!modules.zipOpen; open.disabled = !modules.zip && !modules.buttons; open.closest('label')!.hidden = !zipAllowed(design.base) && !buttonsAllowed(design.base);
    const buttons = $('product-buttons') as HTMLInputElement;
    buttons.checked = !!modules.buttons; buttons.disabled = !buttonsAllowed(design.base); buttons.closest('label')!.hidden = !buttonsAllowed(design.base);
    $('module-help').textContent = design.base === 'tee' || isBottoms(design) ? '' : design.base === 'hoodie' ? 'The hoodie’s rib hem band keeps the hem straight, and its kangaroo pocket replaces a chest pocket.'
      : 'The rib hem band keeps the hem straight.';
    ($('part-material') as HTMLSelectElement).value = style.material; ($('part-color') as HTMLInputElement).value = style.color;
    drapeTestPanel.sync();
    renderMotifs(design);
    const palette = design.palette ?? [], chips = palette.map(c => `<button class="color-chip" draggable="true" style="background:${c}" data-swatch='${JSON.stringify({ kind: 'color', value: c })}' aria-label="Apply photo color ${c}"></button>`).join('');
    if ($('photo-colours').dataset.palette !== palette.join()) { $('photo-colours').dataset.palette = palette.join(); $('photo-colours').innerHTML = chips; }
    $('photo-colour-actions').hidden = !palette.length;
    ($('part-print') as HTMLSelectElement).value = style.print?.motif ?? '';
    for (const id of ['print-color', 'print-layout', 'print-scale']) ($(id) as HTMLInputElement).disabled = !style.print;
    // Uploaded motifs are drawn in their own colors.
    ($('print-color') as HTMLInputElement).disabled = !style.print || style.print.motif.startsWith('upload:');
    ($('stripe-direction') as HTMLSelectElement).disabled = style.print?.motif !== 'stripe';
    ($('stripe-direction') as HTMLSelectElement).value = style.print?.direction ?? 'horizontal';
    ($('print-color') as HTMLInputElement).value = style.print?.color ?? '#1f2a4f'; ($('print-layout') as HTMLSelectElement).value = style.print?.layout ?? 'grid';
    ($('print-scale') as HTMLInputElement).value = String(style.print?.scaleCm ?? 6);
    ($('product-name') as HTMLInputElement).value = design.name;
    const bottoms = isBottoms(design);
    for (const [id, hidden] of [['top-measures', bottoms], ['leg-measures', design.base !== 'trousers'], ['skirt-measures', design.base !== 'skirt'], ['top-modules', bottoms], ['leg-modules', design.base !== 'trousers'],
      ['artwork-controls', bottoms], ['artwork-note', !bottoms], ['fit-panel', bottoms]] as const) $(id).hidden = hidden;
    if (design.base === 'skirt') { const m=skirtDraft(design); for(const [id,,key] of SKIRT_FIELDS) ($(id) as HTMLInputElement).value=String(m[key]); ($('product-skirt-band') as HTMLInputElement).value=String(skirtBandHeight(design)); ($('product-skirt-gather') as HTMLInputElement).value=String(skirtGather(design)); ($('product-skirt-hip') as HTMLInputElement).value=String(skirtFit(design)?.hip ?? ''); const pleats=skirtPleats(design); ($('product-skirt-pleats') as HTMLSelectElement).value=pleats?.style ?? ''; ($('product-skirt-pleat-count') as HTMLInputElement).value=pleats ? String(pleats.count) : ''; ($('product-skirt-pleat-depth') as HTMLInputElement).value=pleats ? String(pleats.depth) : ''; }
    else if (bottoms) { const m = legMeasurements(design); for (const [id, , key] of LEG_FIELDS) ($(id) as HTMLInputElement).value = String(m[key] ?? WAISTBAND_CM); ($('product-leg-cuff') as HTMLInputElement).value = String(m.cuffHeight ?? 0); }
    else {
      const m = topMeasurements(design);
      ($('product-chest') as HTMLInputElement).value = String(m.chest); ($('product-length') as HTMLInputElement).value = String(m.length); ($('product-sleeve') as HTMLInputElement).value = String(m.sleeve);
      for (const key of ['hoodHeight', 'hoodWidth']) { const input = $(`fit-${key}`) as HTMLInputElement; input.disabled = design.base !== 'hoodie'; input.closest('label')!.hidden = design.base !== 'hoodie'; }
      const ribInput = $('fit-neckRibHeight') as HTMLInputElement; ribInput.disabled = design.base === 'hoodie'; ribInput.closest('label')!.hidden = design.base === 'hoodie';
      for (const key of ['cuffHeight', 'hemBandHeight']) { const input = $(`fit-${key}`) as HTMLInputElement; input.disabled = design.base === 'tee'; input.closest('label')!.hidden = design.base === 'tee'; }
      const values = fitValues(design);
      for (const key of FIT_KEYS) ($(`fit-${key}`) as HTMLInputElement).value = String(Math.round(values[key] * 10) / 10);
      $('reset-fit').toggleAttribute('disabled', !design.fit);
    }
    ($('product-neckline') as HTMLSelectElement).value = design.neckline;
    ($('spec-style') as HTMLInputElement).value = design.spec?.styleNumber ?? ''; ($('spec-season') as HTMLInputElement).value = design.spec?.season ?? '';
    ($('spec-size') as HTMLSelectElement).value = design.spec?.sampleSize ?? 'M';
    const draped = currentDrape(design), chestInput = $('garment-drape-chest') as HTMLInputElement;
    // A skirt's or trousers' body is its waist and hip; the chest and chest depth belong to tops.
    const companion = companionOf(design), onTop = !bottoms || !!companion;
    renderWearWith(design); renderSizeSelect(design); renderPatternSize(design);
    const pieces = piecesOf(design);
    const editWorn = $('edit-worn-garment') as HTMLButtonElement;
    editWorn.hidden = !!pieces; editWorn.disabled = !companion || !!pieces;
    $('outfit-edit-picker').hidden = !pieces; editLayer.disabled = !pieces;
    if (pieces) {
      const rows = [['inner', 'Inner layer'], ['outer', 'Outer layer'], ['bottoms', 'Bottoms']] as const;
      currentLayer = rows.find(([role]) => pieces[role] === design)?.[0] ?? null;
      const html = rows.map(([role, label]) => `<option value="${role}">${label}: ${escapeHtml(pieces[role].name)}</option>`).join('');
      if (editLayer.dataset.html !== html) { editLayer.dataset.html = html; editLayer.innerHTML = html; }
      editLayer.value = currentLayer ?? '';
    } else { currentLayer = null; }
    const tuckBox = $('garment-tuck') as HTMLInputElement, top = outfitTop(design), layered = !!layersOf(design), tuckable = !!project.product && !!companion && !layered && !!top && canTuck(top);
    const alsoWorn = alsoOf(design);
    tuckBox.disabled = !tuckable; tuckBox.checked = tuckable && tuckedFor(design);
    $('garment-tuck-help').textContent = !companion ? 'Choose bottoms with Wear with to tuck a top in.' : alsoWorn ? 'A three-piece outfit is worn untucked.' : layered ? 'A top worn over another is not tucked in.' : !tuckable ? 'A dress cannot be tucked in; shorten it to a top to tuck it.'
      : 'The top drapes first, held close to the body below the waistband, and the bottoms drape over it. You can undo this.';
    ($('outfit-bundle') as HTMLButtonElement).disabled = !companionOf(design);
    const outfitExport = $('export-outfit') as HTMLInputElement;
    outfitExport.disabled = !companion; if (!companion) outfitExport.checked = false;
    chestInput.closest('label')!.hidden = !onTop; ($('garment-drape-depth') as HTMLInputElement).closest('label')!.hidden = !onTop; ($('garment-drape-arm-girth') as HTMLInputElement).closest('label')!.hidden = !onTop; $('arm-girth-help').hidden = !onTop; ($('garment-drape-neck-girth') as HTMLInputElement).closest('label')!.hidden = !onTop; $('neck-girth-help').hidden = !onTop;
    ($('garment-drape-underbust') as HTMLInputElement).closest('label')!.hidden = !onTop; $('underbust-help').hidden = !onTop;
    if (draped && drapeKey && drapeKey !== drapeKeyOf(design)) stopDrape();
    if (!hasDrafts('body')) {
      chestInput.value = String(chestFor(design));
      ($('garment-drape-waist') as HTMLInputElement).value=bodyWaist===null?'':String(bodyWaist);
      ($('garment-drape-hip') as HTMLInputElement).value=bodyHip===null?'':String(bodyHip);
      ($('garment-drape-depth') as HTMLInputElement).value=!onTop||bodyDepth===null?'':String(bodyDepth);
      ($('garment-drape-height') as HTMLInputElement).value=bodyHeight===null?'':String(bodyHeight);
      ($('garment-drape-hip-depth') as HTMLInputElement).value=bodyHipDepth===null?'':String(bodyHipDepth);
      ($('garment-drape-arm-girth') as HTMLInputElement).value=bodyArmGirth===null?'':String(bodyArmGirth);
      ($('garment-drape-neck-girth') as HTMLInputElement).value=bodyNeckGirth===null?'':String(bodyNeckGirth);
      ($('garment-drape-underbust') as HTMLInputElement).value=!onTop||bodyUnderbust===null?'':String(bodyUnderbust);
    }
    // A body with a bust has a narrower automatic waist.
    const proportional = () => { try { return validateTopBodyShape(chestFor(design), { underbust: bodyUnderbust ?? undefined }); } catch { return { waist: chestFor(design) * .86, hip: chestFor(design) * 1.02 }; } };
    let auto: { waist: number; hip: number } = design.base === 'trousers' ? legMeasurements(design) : proportional();
    const bottomsWorn = outfitBottoms(design);
    if (bottomsWorn) try { auto = outfitShape(bottomsWorn, chestFor(design)); } catch { /* The drape reports the problem. */ }
    ($('garment-drape-waist') as HTMLInputElement).placeholder=`Auto: ${Number(auto.waist.toFixed(2))}`;
    ($('garment-drape-hip') as HTMLInputElement).placeholder=`Auto: ${Number(auto.hip.toFixed(2))}`;
    drapeTime.value = String(drapeFrames);
    $('garment-drape-on').textContent = draping ? 'Drape again' : 'Drape on a body'; $('garment-drape-off').hidden = !draping;
    if (!draping) $('garment-drape-status').textContent = 'The garment is shown as a styling shell. Drape it on a body to see how it hangs.';
    else if (draped) $('garment-drape-status').textContent = drapeSummary(design, draped);
    else startDrape(design);
    const signature = JSON.stringify([design, companion, alsoWorn, shownSize, wholeOutfitSize, selected, !!project.product, draping, drape?.key ?? '', !!draped]);
    if (signature !== shown) {
      shown = signature;
      $('product-pieces').innerHTML = piecesSvg(design);
      $('techpack-preview').innerHTML = techPackSections(buildTechPack(design, today()), measurementDiagram(design), 5);
      renderRange(design);
      const preview = outfitViewed(design);
      scene?.setProduct(preview.product, selected, draped, true, draped?.companion ? preview.companion : null, draped?.also ? preview.also : null);
      $('product-status').textContent = project.product ? `Editing ${design.name}. Selected: ${label(selected)} — ${material(style.material).name}${style.print ? `, ${printName(style.print, design)} print` : ''}.`
        : 'Choose a template to start, or style the blank tee shown.';
    }
    finishDrafts();
  }
  return { render: (project: Project) => render(project), dirty: () => hasDrafts(), reset: () => { bodyProfiles.reset(); fabricComparison.reset(); stopDrape(); drapeFrames = GARMENT_FRAMES; draping = false; drape = null; shownSize = null; wholeOutfitSize = false; $('garment-size-status').textContent = ''; patternSize = null; ($('outfit-export-size') as HTMLSelectElement).value = ''; ($('export-outfit') as HTMLInputElement).checked = false; bodyChest = null; bodyWaist=null; bodyHip=null; bodyDepth=null; bodyHeight=null; bodyHipDepth=null; bodyArmGirth=null;bodyNeckGirth=null; shownBody=''; failedDrapeKey = ''; shown = ''; render(options.current()); } };
}
