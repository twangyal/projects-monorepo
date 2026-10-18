import struct
from pathlib import Path
import unittest
from garment_native_export import verify_export
from garment_native_inputs import load_inputs,OBJECT,SESSION


def flat(rows):return [v for row in rows for v in row]

def buffers():
    data=load_inputs(Path(__file__).with_name('results'));files={}
    def put(name,code,values):files['bin/'+name]=struct.pack('<'+str(len(values))+code,*values)
    for name,code,values in [('vert.bin','d',flat(data['initial'])),('rest_vert.bin','d',flat(data['rest'])),('rest_vert_mask.bin','B',[1]*2353),('vel.bin','f',[0.]*(2353*3)),('displacement.bin','d',[0.,0.,0.]*2),('static_vert_dmap.bin','I',[1]*19574),('vert_dmap.bin','I',[0]*2353),('object_vert.bin','I',[0]*2353),('tri.bin','Q',flat(data['faces'])),('uv.bin','f',flat(flat(data['uv']))),('stitch_ind.bin','Q',flat(data['stitch_indices'])),('stitch_w.bin','f',flat(data['stitch_weights'])),('stitch_stiffness.bin','f',[1.]*22),('static_vert.bin','d',flat(data['body_vertices'])),('static_tri.bin','Q',flat(data['body_faces'])),('param/tri-density.bin','f',data['face_density'])]:put(name,code,values)
    for key,value in {**OBJECT,'young-mod':500.,'shrink-x':1.,'shrink-y':1.,'bend-warp':0.,'bend-weft':0.,'pressure':0.,'plasticity':0.,'bend-plasticity':0.}.items():put('param/tri-'+key+'.bin','B' if key=='model' else 'f',[2 if key=='model' else value]*4480)
    counts={'vert':2353,'tri':4480,'static_vert':19574,'static_tri':39144,'stitch':22,'pin_block':0,'rod':0,'tet':0,'wall':0,'sphere':0,'display_pin_block':0,'rod_vert_start':0,'rod_vert_end':0,'shell_vert_start':0,'shell_vert_end':2353,'shell_count':4480,'rod_count':0,'has_rest_vert':True,'has_rest_vert_anim':False,'rest_vert_anim_frames':0,'has_bend_rest_vert':False}
    files['info.toml']=('[count]\n'+'\n'.join(f'{k} = {str(v).lower()}' for k,v in counts.items())+'\n').encode()
    import json
    files['param.toml']=('[param]\n'+'\n'.join(f'{k.replace("-","_")} = {json.dumps(v)}' for k,v in SESSION.items())+'\n').encode()
    return data,files


class NativeExport(unittest.TestCase):
    def test_exported_payload_is_checked_before_execution(self):
        data,files=buffers();result=verify_export(files.__getitem__,data,500.)
        self.assertEqual(result['solved_vertices'],2353)
        self.assertEqual(result['static_triangles'],39144)
        self.assertEqual(result['stitch_rows'],22)
    def test_changes_to_actual_native_buffers_and_control_metadata_refuse(self):
        data,original=buffers()
        for name in ['bin/rest_vert.bin','bin/rest_vert_mask.bin','bin/uv.bin','bin/param/tri-density.bin','bin/stitch_ind.bin','bin/stitch_w.bin','bin/static_tri.bin','bin/static_vert.bin','bin/static_vert_dmap.bin','bin/tri.bin','bin/vel.bin']:
            with self.subTest(name=name):
                files=original.copy();raw=bytearray(files[name]);raw[0]^=1;files[name]=bytes(raw)
                with self.assertRaises(ValueError):verify_export(files.__getitem__,data,500.)
        for name,old,new in [('info.toml',b'has_rest_vert = true',b'has_rest_vert = false'),('info.toml',b'has_bend_rest_vert = false',b'has_bend_rest_vert = true'),('param.toml',b'disable_contact = false',b'disable_contact = true')]:
            files=original.copy();self.assertIn(old,files[name]);files[name]=files[name].replace(old,new)
            with self.assertRaises(ValueError):verify_export(files.__getitem__,data,500.)
if __name__=='__main__':unittest.main()
