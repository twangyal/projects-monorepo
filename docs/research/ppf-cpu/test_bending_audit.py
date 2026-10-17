import hashlib
import io
import json
import struct
import unittest
import zipfile
from bending_audit import native_case,verify_manifest,verify_controls
from bending_metrics import strip,CASES,PARAMETERS,SESSION

class NativeAudit(unittest.TestCase):
    def fixture(self):
        vertices,faces=strip();prefix='native-cache/sessions/cpu-bending-soft/session/';files={}
        def put(name,code,values):files[prefix+'bin/'+name]=struct.pack('<'+str(len(values))+code,*values)
        put('uv.bin','f',[0.]*360);put('vel.bin','f',[0.]*132);put('pin-ind-0.bin','Q',list(range(8)));put('vert.bin','d',[c for v in vertices for c in v]);put('tri.bin','Q',[i for f in faces for i in f]);put('vert_dmap.bin','I',[0]*44);put('displacement.bin','d',[0]*3)
        for key,value in {**PARAMETERS,**CASES['soft'],'shrink-x':1.,'shrink-y':1.,'bend-warp':0.,'bend-weft':0.,'pressure':0.,'plasticity':0.,'bend-plasticity':0.}.items():put('param/tri-'+key+'.bin','B' if key=='model' else 'f',[2 if key=='model' else value]*60)
        def toml(value):return json.dumps(value)
        files[prefix+'param.toml']=('[param]\n'+'\n'.join(k.replace('-','_')+' = '+toml(v) for k,v in SESSION.items())).encode()
        files[prefix+'info.toml']=b'[count]\nvert=44\ntri=60\nstatic_vert=0\nstatic_tri=0\npin_block=1\nrod=0\ntet=0\nwall=0\nsphere=0\nstitch=0\ndisplay_pin_block=0\nrod_vert_start=0\nrod_vert_end=0\nshell_vert_start=0\nrod_count=0\nhas_rest_vert=false\nhas_rest_vert_anim=false\nrest_vert_anim_frames=0\nhas_bend_rest_vert=false\nshell_vert_end=44\nshell_count=60\n[pin-0]\noperation_count=0\npin=8\npull=0.0\npin_group_id="strip:pin_0"\n'
        files[prefix+'stdout.log']=b'complete';files[prefix+'error.log']=b''
        files['soft-geometry.json']=json.dumps({'authored_to_solved':list(range(44))}).encode()
        for i in range(401):
            v=vertices if i==0 else [[x,-.001*(max(0,x-.01)/.09)**2,z] for x,y,z in vertices]
            files[prefix+f'output/vert_{i}.bin']=struct.pack('<132f',*[c for p in v for c in p])
        return files
    def run_case(self,files):
        stream=io.BytesIO()
        with zipfile.ZipFile(stream,'w') as z:
            for p,data in files.items():z.writestr(p,data)
        with zipfile.ZipFile(stream) as z:return native_case(z,set(files),'soft')
    def test_valid_synthetic_fixture_replays(self):self.assertAlmostEqual(self.run_case(self.fixture())[0]['tip_descent_m'],.001,places=6)
    def test_missing_input_wrong_map_wrong_material_refused(self):
        for mutation in ['missing','map','material','topology','frames']:
            files=self.fixture();base='native-cache/sessions/cpu-bending-soft/session/'
            if mutation=='missing':del files[base+'bin/vert.bin']
            if mutation=='map':files['soft-geometry.json']=json.dumps({'authored_to_solved':[0]*44}).encode()
            if mutation=='material':files[base+'bin/param/tri-young-mod.bin']=struct.pack('<120f',*[2000.]*120)
            if mutation=='topology':files[base+'bin/tri.bin']=struct.pack('<180Q',*[0]*180)
            if mutation=='frames':del files[base+'output/vert_50.bin']
            with self.subTest(mutation=mutation),self.assertRaises(ValueError):self.run_case(files)
    def test_manifest_covers_every_native_byte(self):
        stream=io.BytesIO()
        with zipfile.ZipFile(stream,'w') as z:z.writestr('native-cache/foo',b'actual')
        with zipfile.ZipFile(stream) as z:
            for manifest in [[],[{'path':'native-cache/foo','bytes':6,'sha256':hashlib.sha256(b'forged').hexdigest()}]]:
                with self.assertRaises(ValueError):verify_manifest(z,{'retained_native_files':manifest})

    def test_undeclared_static_body_refused(self):
        files=self.fixture();p='native-cache/sessions/cpu-bending-soft/session/info.toml';files[p]=files[p].replace(b'static_vert=0',b'static_vert=100')
        with self.assertRaises(ValueError):self.run_case(files)

    def test_changed_first_edge_order_refused(self):
        files=self.fixture();p='native-cache/sessions/cpu-bending-soft/session/bin/tri.bin'
        indices=struct.unpack('<180Q',files[p]);rotated=[j for i in range(0,180,3) for j in [indices[i+1],indices[i+2],indices[i]]];files[p]=struct.pack('<180Q',*rotated)
        with self.assertRaises(ValueError):self.run_case(files)
    def test_missing_pin_and_initial_velocity_refused(self):
        for key in ['pin-ind-0.bin','vel.bin']:
            files=self.fixture();del files['native-cache/sessions/cpu-bending-soft/session/bin/'+key]
            with self.subTest(key=key),self.assertRaises(ValueError):self.run_case(files)

    def test_changed_pin_membership_pull_operations_and_velocity_refused(self):
        base='native-cache/sessions/cpu-bending-soft/session/'
        for mutation in ['membership','pull','operation','override','velocity']:
            files=self.fixture()
            if mutation=='membership':files[base+'bin/pin-ind-0.bin']=struct.pack('<8Q',8,9,10,11,12,13,14,15)
            if mutation=='pull':files[base+'info.toml']=files[base+'info.toml'].replace(b'pull=0.0',b'pull=0.1')
            if mutation=='operation':files[base+'info.toml']+=b'\n[pin-0-op-0]\ntype="move_by"\n'
            if mutation=='override':files[base+'bin/pin-pullw-0.bin']=struct.pack('<4f',1,1,1,1)
            if mutation=='velocity':files[base+'bin/vel.bin']=struct.pack('<132f',1,*([0.]*131))
            with self.subTest(mutation=mutation),self.assertRaises(ValueError):self.run_case(files)

    def test_authored_material_uv_change_refused(self):
        files=self.fixture();files['native-cache/sessions/cpu-bending-soft/session/bin/uv.bin']=struct.pack('<360f',1,*([0.]*359))
        with self.assertRaises(ValueError):self.run_case(files)

    def test_control_refuses_extra_changed_native_input(self):
        stream=io.BytesIO();paths=set()
        with zipfile.ZipFile(stream,'w') as z:
            for case in ['soft','stiff']:
                prefix=f'native-cache/sessions/cpu-bending-{case}/session/'
                for name,data in [('info.toml',b'[pin-0]\npin_group_id="strip:pin_0"\n'),('param.toml',b'fixed'),('bin/param/tri-bend.bin',case.encode()),('bin/vel.bin',case.encode())]:
                    z.writestr(prefix+name,data);paths.add(prefix+name)
        with zipfile.ZipFile(stream) as z:
            with self.assertRaises(ValueError):verify_controls(z,paths)

    def test_alternate_rest_and_shell_ranges_refused(self):
        for entry in [b'has_bend_rest_vert=true',b'has_rest_vert_anim=true',b'rest_vert_anim_frames=17',b'shell_vert_start=5',b'shell_vert_end=40',b'shell_count=12']:
            files=self.fixture();key='native-cache/sessions/cpu-bending-soft/session/info.toml';field=entry.split(b'=')[0];files[key]=b'\n'.join(entry if line.startswith(field+b'=') else line for line in files[key].split(b'\n'))
            with self.subTest(entry=entry),self.assertRaises(ValueError):self.run_case(files)
