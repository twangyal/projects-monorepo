import {validateProject,type Project} from './model.ts';
import {template} from './product.ts';

/** One-time copy: independent construction and product settings never silently synchronize. */
export function productFromConstruction(value:Project):Project {
  const project=validateProject(value);
  if(!project.construction)throw new Error('Apply a measured pattern before copying it to the 3D product.');
  const {waist,hem,slant}=project.construction;
  const product=template('flared-skirt');
  product.name='Measured skirt';product.measurements={waist,hem,slant};
  return validateProject({...project,product});
}
