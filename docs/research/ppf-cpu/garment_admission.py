"""Independent actual-garment preflight. This is NOT a native simulation."""
import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path


def triangle_area(lengths):
    """Area of the intrinsic triangle; refuse impossible or collapsed rest metrics."""
    a,b,c=sorted(lengths)
    if not all(math.isfinite(x) and x>0 for x in (a,b,c)) or a+b<=c:
        raise ValueError('Invalid intrinsic rest triangle.')
    return math.sqrt((a+b+c)*(-a+b+c)*(a-b+c)*(a+b-c))/4


def compare_edge(initial, flat, rest):
    return abs(math.dist(*initial)-rest), abs(math.dist(*flat)-rest)


def require(condition,message):
    if not condition:raise ValueError(message)


def finite(values,size=None,positive=False):
    require(isinstance(values,list) and (size is None or len(values)==size),'Wrong numeric buffer size.')
    require(all(type(n) in (float,int) and math.isfinite(n) and (not positive or n>0) for n in values),'Nonfinite/invalid numeric buffer.')


def index(n,count):
    require(type(n) is int and 0<=n<count,'Invalid vertex/particle index.')


def body_gap(v,body):
    x,y,z=v;sections=body['torso_m'];best=math.inf
    if y<=sections[0]['y']:
        i=1
        while i<len(sections)-1 and sections[i]['y']>y:i+=1
        upper,lower=sections[i-1],sections[i]
        t=min(1,max(0,(upper['y']-y)/(upper['y']-lower['y'])))
        w=upper['halfWidth']+(lower['halfWidth']-upper['halfWidth'])*t
        d=upper['halfDepth']+(lower['halfDepth']-upper['halfDepth'])*t
        best=math.hypot(max(abs(x)-(w-d),0),z)-d
    for c in body['capsules_m']:
        axis=[b-a for a,b in zip(c['a'],c['b'])];span=sum(n*n for n in axis)
        t=min(1,max(0,sum((v[i]-c['a'][i])*axis[i] for i in range(3))/span)) if span else 0
        best=min(best,math.dist(v,[c['a'][i]+axis[i]*t for i in range(3)])-c['radius']-(c['end']-c['radius'])*t)
    return best


def audit(envelope, app=None):
    require(isinstance(envelope,dict) and set(envelope)=={'fixture','source_sha256','packet'},'Invalid envelope.')
    require(envelope['fixture']=='blank-tee-94cm-body-v1','Unknown frozen garment fixture.')
    sources=envelope['source_sha256']
    expected={'src/product.ts','src/media.ts','src/garment-drape.ts','src/native-garment-snapshot.ts','scripts/export-native-garment.ts','package-lock.json'}
    require(set(sources)==expected and all(isinstance(h,str) and len(h)==64 and all(c in '0123456789abcdef' for c in h) for h in sources.values()),'Invalid source provenance.')
    if app is not None:
        for name,digest in sources.items():require(hashlib.sha256((app/name).read_bytes()).hexdigest()==digest,'Source hash mismatch: '+name)
    p=envelope['packet']
    require(p['schema']=='clothing-native-garment-v1','Unknown schema.')
    require(p['units']=={'length':'m','mass':'kg','time':'s','authored_uv':'m','browser_compliance':'s^2/g'},'Wrong units.')
    require(p['native_material_parameters'] is None,'Browser compliance must not become native coefficients.')
    require(p['design']=={'base':'tee','name':'Blank tee','measurements_cm':{'chest':104,'length':72,'sleeve':21},'neckline':'crew'},'Not the frozen default tee.')
    positions=p['positions_m'];finite(positions);require(len(positions)%3==0,'Wrong position width.')
    n=len(positions)//3;require(n==2331,'Changed frozen particle count.')
    points=[positions[i:i+3] for i in range(0,len(positions),3)]
    finite(p['particle_inverse_mass_per_kg'],n,True)
    finite(p['body_clearance_m'],n,True)
    constraints=p['constraints'];edges={};all_constraints=set()
    require(len(constraints)==13440,'Changed frozen constraint count.')
    for c in constraints:
        require(set(c)=={'particles','rest_m','kind','browser_compliance'},'Invalid constraint fields.')
        require(isinstance(c['particles'],list) and len(c['particles'])==2,'Invalid constraint width.')
        a,b=c['particles'];index(a,n);index(b,n);require(a!=b,'Collapsed constraint.')
        finite([c['rest_m'],c['browser_compliance']],2,True)
        require(c['kind'] in ('structural','bending-distance'),'Unknown constraint kind.')
        key=tuple(sorted((a,b)));identity=(c['kind'],key)
        if c['kind']=='structural':
            require(identity not in all_constraints,'Duplicate structural constraint.')
            edges[key]=c['rest_m']
        all_constraints.add(identity)
    require([part['part'] for part in p['parts']]==['front','back','sleeveLeft','sleeveRight','neckband'],'Missing/extra/reordered garment parts.')
    membership={};incidence={};referenced=set();report={};total_faces=0;collapsed=0
    direct_bad=set();flat_bad=set();direct_max=0;flat_max=0;rest_area=0;native_area=0
    for part in p['parts']:
        name=part['part'];ids=part['particles'];local=len(ids)
        require(local>0,'Empty part.');finite(part['shell_positions_m'],local*3);finite(part['authored_uv_m'],local*2)
        fabric=part['material'];density=part['areal_density_kg_m2']
        finite([density,fabric['gsm']],2,True)
        require(abs(density-fabric['gsm']/1000)<1e-12 and .05<=density<=1,'Wrong areal mass conversion.')
        require(part['material_source']=='application-library-label-unmeasured','Unproven material provenance.')
        require(part['rest_convention']==('wrapped-neckline-and-modelled-width' if name=='neckband' else 'flat-silhouette-xy'),'Changed rest convention.')
        for v,particle in enumerate(ids):
            index(particle,n);membership.setdefault(particle,[]).append({'part':name,'vertex':v})
            require(math.dist(part['shell_positions_m'][v*3:v*3+3],points[particle])<2e-6,'Part-to-cloth shell mapping mismatch.')
        triangles=part['triangles'];require(len(triangles)%3==0,'Wrong triangle width.')
        local_faces=set();part_direct=0;part_flat=0;part_area=0;part_shell_area=0;part_collapsed=0
        for j in range(0,len(triangles),3):
            face=triangles[j:j+3]
            for i in face:index(i,local)
            key=tuple(sorted(face));require(key not in local_faces,'Duplicate render triangle.');local_faces.add(key)
            tri=[ids[i] for i in face];total_faces+=1
            if len(set(tri))<3:
                require(name=='neckband','Unexpected collapsed non-rib triangle.')
                part_collapsed+=1;collapsed+=1;continue
            lengths=[];shell_lengths=[]
            for k in range(3):
                a,b=tri[k],tri[(k+1)%3];edge=tuple(sorted((a,b)))
                require(edge in edges,'Triangle edge missing from structural constraints.')
                incidence[edge]=incidence.get(edge,0)+1;referenced.add(edge)
                rest=edges[edge];lengths.append(rest);initial=[points[a],points[b]]
                flat=[[v[0],v[1],0] for v in initial]
                d,f=compare_edge(initial,flat,rest);shell_lengths.append(math.dist(*initial))
                if name!='neckband':require(f<=2e-6,'Flat pattern/rest length mismatch.')
                if d>2e-6:direct_bad.add(edge)
                if f>2e-6:flat_bad.add(edge)
                part_direct=max(part_direct,d);part_flat=max(part_flat,f)
            part_area+=triangle_area(lengths);part_shell_area+=triangle_area(shell_lengths)
        report[name]={'render_triangles':len(triangles)//3,'weld_collapsed_triangles':part_collapsed,'intrinsic_rest_area_m2':part_area,'initial_shell_area_m2':part_shell_area,'direct_shell_max_rest_error_m':part_direct,'flattened_xy_max_rest_error_m':part_flat}
        direct_max=max(direct_max,part_direct);flat_max=max(flat_max,part_flat);rest_area+=part_area;native_area+=part_shell_area
    require(referenced==set(edges),'Unreferenced structural constraints.')
    require(len(membership)==n,'Unreferenced cloth particles.')
    seams=[{'particle':particle,'members':members} for particle,members in membership.items() if len(members)>1]
    require(p['seam_groups']==seams,'Seam membership mismatch.')
    body=p['body'];require(body['measurements_cm']=={'chest':94,'waist':94*.86,'hip':94*1.02,'chestDepth':body['measurements_cm']['chestDepth']},'Changed frozen body girths.')
    finite(list(body['measurements_cm'].values()),4,True)
    sections=body['torso_m'];require(len(sections)==5 and len(body['capsules_m'])==8,'Wrong body primitives.')
    require(body['convention']=='analytic-union-of-stadium-sections-and-tapered-capsules-not-a-closed-native-triangle-collider','Unknown body convention.')
    for s in sections:
        finite([s['y'],s['halfWidth'],s['halfDepth']],3)
        require(s['halfWidth']>=s['halfDepth']>0,'Invalid stadium section.')
    require(all(sections[i]['y']>sections[i+1]['y'] for i in range(4)),'Body sections out of order.')
    for c in body['capsules_m']:
        finite(c['a'],3);finite(c['b'],3);finite([c['radius'],c['end']],2,True)
        require(type(c['limb']) is bool,'Invalid limb marker.')
    gaps=[body_gap(v,body) for v in points]
    # This is a source-semantics admission gate, not native or physical acceptance.
    return {'schema':1,'status':'blocked_native_mapping','native_solver_executed':False,'source_files_verified':app is not None,'source_sha256':sources,'particles':n,'authored_triangles':total_faces,'weld_collapsed_triangles':collapsed,'structural_edges':len(edges),'bending_distance_constraints':len(constraints)-len(edges),'seam_groups':len(seams),'nonmanifold_edges':sum(k>2 for k in incidence.values()),'boundary_edges':sum(k==1 for k in incidence.values()),'intrinsic_rest_area_m2':rest_area,'initial_shell_area_m2':native_area,'direct_shell':{'mismatched_edges':len(direct_bad),'max_rest_error_m':direct_max},'flattened_xy':{'mismatched_edges':len(flat_bad),'max_rest_error_m':flat_max},'parts':report,'body':{'initial_inside_vertex_count':sum(g< -1e-6 for g in gaps),'minimum_full_body_gap_m':min(gaps),'triangle_interior_contact_checked':False,'native_static_collider_prepared':False},'blockers':['Direct-shell native rest lengths differ from the browser structural rest metric.','Flattened XY also changes wrapped neck-rib rest lengths.','Four render rib faces collapse after seam welding and need explicit native face/export mapping.','Body proxy is an analytic union, not an admitted closed native triangle collider; initial triangle-interior clearance and controlled initialization remain unverified.','Browser distance bending and approximate compliance/mass conventions are not native shell constitutive coefficients.'],'scope':'Actual application geometry preflight only; no native response, garment performance, physical fabric or fit validation.'}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('packet',type=Path);parser.add_argument('--app',type=Path)
    args=parser.parse_args()
    raw=args.packet.read_bytes();envelope=json.loads(gzip.decompress(raw))
    result=audit(envelope,args.app)
    result['packet_bytes']=len(raw);result['packet_sha256']=hashlib.sha256(raw).hexdigest()
    print(json.dumps(result,indent=2,allow_nan=False))
if __name__=='__main__':main()
