"""Replay complete actual native garment inputs/frames, never session pickles."""
import argparse,gzip,hashlib,io,json,math,struct,zipfile
from pathlib import Path
from bending_audit import verify_manifest
from garment_admission import require
from garment_native_inputs import load_inputs,REVISION,OBJECT,SESSION,CASES
from garment_native_initialization import CLOTH_OFFSET_M,BODY_OFFSET_M
from garment_native_export import verify_export
from garment_sewing_layout import sewing_layout
from garment_motion import measure

ARCHIVE_SHA256='c154742f1861730932924378df036ba9e6fd1374be1164a5cfd3731e6c38486d'
SOURCE_SHA256={'garment_native_probe.py':'127533b95e139e034e4f81b1bee4a16dd3c1ee77c1d91a3666e203c0b671b383','garment_native_inputs.py':'7fabcff5d5a36e5ab296d20f7078a1c686ed5ec1e9ae2deaf13406134c3d56d6','garment_native_export.py':'500910527f5083d80277a0ce8ec3d82e1d20e4932dff714ee20d50e395d951a5','garment_native_initialization.py':'4da3fc8f8af9d876f6cb887e84664e119da3f677a26a3115d324f8281fbc6e36','garment_sewing_layout.py':'8ee248b675dc46cb6c0c141147100f99a6170dddbc9620ce11b6178cec0bf8a2'}

def audit(path,verify_archive_hash=True):
    raw=path.read_bytes() if isinstance(path,Path) else path.read();digest=hashlib.sha256(raw).hexdigest()
    if verify_archive_hash:require(digest==ARCHIVE_SHA256,'Changed native garment archive.')
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        receipt=json.loads(z.read('receipt.json'));paths=verify_manifest(z,receipt)
        original=load_inputs(Path(__file__).with_name('results'));inputs,layout=sewing_layout(original)
        require(json.loads(gzip.decompress(z.read('native-blueprint-original.json.gz')))==original,'Changed original input blueprint.')
        require(json.loads(gzip.decompress(z.read('native-blueprint.json.gz')))==inputs,'Changed detached sewing blueprint.')
        controls={**OBJECT,'contact-offset':CLOTH_OFFSET_M}
        expected={'status':'passed_garment_motion_probe','stage':'completed','upstream_revision':REVISION,'source_sha256':SOURCE_SHA256,'source_artifact_sha256':inputs['source_artifact_sha256'],'object_parameters':controls,'body_contact_offset_m':BODY_OFFSET_M,'initialization':'sewing','initialization_parameters':layout,'session_parameters':SESSION,'case_normalized_young':CASES,'fixture_step_outcome':'success','fixture_exit_code':0,'frames_per_case':19,'case_names':list(CASES),'case_session_prefix':'cpu-garment-'}
        for key,value in expected.items():require(receipt.get(key)==value,'Unexpected native receipt '+key)
        require(set(receipt['cases'])==set(CASES),'Incomplete native material cases.')
        require(z.read('upstream-revision.txt').decode().strip()==REVISION and not z.read('upstream-initial-status.txt').strip(),'Changed/dirty upstream source.')
        require('Exit status: 0' in z.read('build-resources.txt').decode() and z.read('fixture-exit-code.txt').strip()==b'0','Failed native build/fixture.')
        require('cpu actual garment motion probe: PASS' in z.read('fixture.log').decode(),'Missing native completion log.')
        supervisor=json.loads(z.read('supervisor.json'));require(supervisor['status']=='completed' and supervisor['exit_code']==0 and supervisor['remaining_children']==0 and supervisor['wall_limit_seconds']==300,'Native supervisor did not finish cleanly.')
        predicted_mass=0.
        for face,density in zip(inputs['faces'],inputs['face_density']):
            a,b,c=[inputs['initial'][i] for i in face];u=[b[i]-a[i] for i in range(3)];v=[c[i]-a[i] for i in range(3)]
            predicted_mass+=.5*math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])*density
        packet=json.loads(gzip.decompress(Path(__file__).with_name('results').joinpath('garment-first.json.gz').read_bytes()))['packet']
        browser_mass=sum(1/v for v in packet['particle_inverse_mass_per_kg'])
        masses={}
        results={};frames={};bins={};prefixes={name:f'native-cache/sessions/cpu-garment-{name}/session/' for name in CASES}
        for name,young in CASES.items():
            prefix=prefixes[name]
            admitted=verify_export(lambda p:z.read(prefix+p),inputs,young,object_parameters=controls,body_contact_offset=BODY_OFFSET_M)
            require(receipt['native_input_admission'][name]==admitted,'Native byte admission differs from receipt.')
            require(not z.read(prefix+'error.log').strip() and b'simulation finished' in z.read(prefix+'stdout.log'),'Missing clean native completion.')
            required={prefix+f'output/vert_{i}.bin' for i in range(19)}
            require({p for p in paths if p.startswith(prefix+'output/vert_') and p.endswith('.bin')}==required,'Incomplete/extra native frames.')
            total_mass=[float(v) for v in z.read(prefix+'output/data/total_mass.out').decode().split()]
            require(len(total_mass)==3 and all(math.isfinite(v) for v in total_mass) and total_mass[0]==0 and total_mass[2]==0,'Unexpected native mass components.')
            masses[name]=total_mass[1]
            require(math.isclose(masses[name],predicted_mass,rel_tol=1e-5),'Native mass differs from density times initial area (float32 sum tolerance10ppm).')
            frames[name]=[]
            for i in range(19):
                data=z.read(prefix+f'output/vert_{i}.bin');require(len(data)==2353*3*4,'Wrong raw frame vertex namespace.')
                values=struct.unpack('<7059f',data);frames[name].append([list(values[j:j+3]) for j in range(0,len(values),3)])
            result=measure(inputs,frames[name]);results[name]=result
            reported=receipt['cases'][name];require(reported['frames']==19 and reported['vertices']==2353 and result['maximum_vertex_displacement_m']>1e-6,'Missing genuine bounded motion.')
            require(math.isclose(result['maximum_vertex_displacement_m'],reported['maximum_displacement_m'],rel_tol=1e-6),'Raw motion differs from float32 probe receipt.')
            bins[name]={p[len(prefix+'bin/'):]:z.read(p) for p in paths if p.startswith(prefix+'bin/')}
        require(set(bins['soft'])==set(bins['stiff']),'Material control native filename sets differ.')
        changed=sorted(p for p in bins['soft'] if bins['soft'][p]!=bins['stiff'][p]);require(changed==['param/tri-young-mod.bin'],'Native controls differ beyond Young coefficient.')
        for name in ['param.toml','info.toml']:require(z.read(prefixes['soft']+name)==z.read(prefixes['stiff']+name),'Control native metadata differs: '+name)
        require(masses['soft']==masses['stiff'],'Material control masses differ.')
        difference=math.sqrt(sum(math.dist(p,q)**2 for p,q in zip(frames['soft'][-1],frames['stiff'][-1]))/2353)
        return {'archive_sha256':digest,'archive_bytes':len(raw),'source_commit':'c9c43cfabd82e579ac1bfdc990c1d6ab26d25970','run_url':'https://github.com/twangyal/projects-monorepo/actions/runs/39134300810','result':'admitted_native_bounded_motion_only','native_files_verified':len(paths),'raw_frames':38,'finite_float32_coordinates':38*2353*3,'only_changed_native_bin':changed,'recomputed':results,'final_vertex_rms_difference_m':difference,'native_total_cloth_mass_kg':masses['soft'],'predicted_initial_area_mass_kg':predicted_mass,'captured_browser_cloth_mass_kg':browser_mass,'native_vs_browser_mass_difference_percent':100*(masses['soft']/browser_mass-1),'mass_convention':'Native mass is captured density times initial 3D face area, not alternate intrinsic rest area. Browser uses projected XY area except modeled rib; no cross-engine mass matching is claimed.','native_case_wall_seconds':{n:receipt['cases'][n]['native_wall_seconds'] for n in CASES},'receipt_wall_seconds_excluding_preparation':receipt['fixture_wall_seconds'],'supervisor':supervisor,'limits':['Detached collar assembly pose, not original dressed-pose acceptance.','0.3s is not settling, seam-quality, continuous-time contact or physical-material/fit acceptance.','Initial maximum edge strain exceeds430%; do not interpret this transient as calibrated fabric behavior.']}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('archive',type=Path);args=parser.parse_args();print(json.dumps(audit(args.archive),indent=2,allow_nan=False))
