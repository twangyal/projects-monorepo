"""Effective native density preserves captured browser inertia, not new fabric data."""
import copy,gzip,json,math
from garment_admission import require
from garment_native_inputs import load_inputs


def match_browser_inertia(original,prepared,root):
    require(original==load_inputs(root),'Require immutable captured source mapping.')
    require(set(prepared)==set(original),'Unexpected prepared metadata before mass mapping.')
    for key in original:
        if key!='initial':require(prepared[key]==original[key],'Prepared source correspondence changed: '+key)
    result=copy.deepcopy(prepared);densities=[];target=[]
    for face,source,gsm_density in zip(original['faces'],original['face_source'],original['face_density']):
        part=source['part'];require(part in ['front','back','sleeveLeft','sleeveRight','neckband'],'Unsupported captured area convention.')
        def cross(points):
            a,b,c=[points[i] for i in face];u=[b[i]-a[i] for i in range(3)];v=[c[i]-a[i] for i in range(3)]
            return [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
        reference=cross(original['initial']);physical_area=.5*(math.hypot(*reference) if part=='neckband' else abs(reference[2]))
        native_area=.5*math.hypot(*cross(prepared['initial']))
        require(math.isfinite(native_area) and native_area>1e-14 and math.isfinite(physical_area) and physical_area>1e-14,'Degenerate/nonfinite area cannot carry captured mass.')
        mass=physical_area*gsm_density;density=mass/native_area;require(math.isfinite(density) and density>0,'Invalid effective native density.')
        target.append(mass);densities.append(density)
    packet=json.loads(gzip.decompress((root/'garment-first.json.gz').read_bytes()))['packet']
    candidate=json.loads(gzip.decompress((root/'garment-rest-candidate.json.gz').read_bytes()))
    solved_source=[None]*len(original['initial'])
    for authored,solved in enumerate(original['authored_to_solved']):solved_source[solved]=candidate['source_particles'][authored]
    aggregate=[0.]*len(packet['particle_inverse_mass_per_kg'])
    for face,mass in zip(original['faces'],target):
        for v in face:aggregate[solved_source[v]]+=mass/3
    captured=[1/v for v in packet['particle_inverse_mass_per_kg']]
    error=max(abs(a/b-1.) for a,b in zip(aggregate,captured));require(error<1e-5,'Per-source particle inertia does not match captured convention.')
    result['captured_face_density']=copy.deepcopy(original['face_density']);result['face_density']=densities
    return result,{'method':'captured-physical-face-mass-to-native-initial-area-v1','source_artifact_sha256':copy.deepcopy(original['source_artifact_sha256']),'predicted_native_total_mass_kg':sum(target),'captured_browser_total_mass_kg':sum(captured),'maximum_source_particle_mass_relative_error':error,'source_particles':len(captured),'native_vertices':len(solved_source),'faces':len(densities),'effective_density_min_kg_m2':min(densities),'effective_density_max_kg_m2':max(densities),'matching_namespace':'Original2331-class seam quotient; native2353 DOFs are not dynamically equivalent.','scope':'Effective solver coefficients recover source-quotient lumped masses; captured_face_density retains source GSM. No calibrated fabric or sewn/fit acceptance.'}
