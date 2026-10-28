import {validateProject,type Project} from './model.ts';
import {template,withSkirtWaistband} from './product.ts';
import {defaultBodyChest} from './garment-drape.ts';

/** One-time copy: independent construction and product settings never silently synchronize. */
export function productFromConstruction(value:Project):Project {
  const project=validateProject(value);
  if(!project.construction)throw new Error('Apply a measured pattern before copying it to the 3D product.');
  const {waist,hem,slant,waistband}=project.construction;
  let product=template('flared-skirt');
  product.name='Measured skirt';product.measurements={waist,hem,slant};
  if(waistband)product=withSkirtWaistband(product,waistband.height);
  const body=project.bodyMeasurements;
  const copiedBody=body?{topBody:{...(project.topBody??{chest:defaultBodyChest(product),waist:null,hip:null,chestDepth:null}),...body}}:{};
  return validateProject({...project,product,...copiedBody});
}
