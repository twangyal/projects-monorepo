"""Raw native input admission; never unpickles frontend session state."""
import struct
import tomllib
from garment_admission import require
from garment_native_inputs import OBJECT,SESSION


def flat(rows):return [v for row in rows for v in row]


def verify_export(read,inputs,young):
    def get(path):
        try:return read(path)
        except (KeyError,OSError) as error:raise ValueError('Missing native input: '+path) from error
    def exact(name,code,values):
        expected=struct.pack('<'+str(len(values))+code,*values)
        require(get('bin/'+name)==expected,'Native input differs from frozen mapping: '+name)
    counts=tomllib.loads(get('info.toml').decode())['count']
    expected={'vert':2353,'tri':4480,'static_vert':19574,'static_tri':39144,'stitch':22,'pin_block':0,'rod':0,'tet':0,'wall':0,'sphere':0,'display_pin_block':0,'rod_vert_start':0,'rod_vert_end':0,'shell_vert_start':0,'shell_vert_end':2353,'shell_count':4480,'rod_count':0,'has_rest_vert':True,'has_rest_vert_anim':False,'rest_vert_anim_frames':0,'has_bend_rest_vert':False}
    for key,value in expected.items():require(counts[key]==value,'Unexpected native scene metadata: '+key)
    for name,code,values in [('vert.bin','d',flat(inputs['initial'])),('rest_vert.bin','d',flat(inputs['rest'])),('rest_vert_mask.bin','B',[1]*2353),('vel.bin','f',[0.]*(2353*3)),('displacement.bin','d',[0.,0.,0.]*2),('static_vert_dmap.bin','I',[1]*19574),('vert_dmap.bin','I',[0]*2353),('object_vert.bin','I',[0]*2353),('tri.bin','Q',flat(inputs['faces'])),('uv.bin','f',flat(flat(inputs['uv']))),('stitch_ind.bin','Q',flat(inputs['stitch_indices'])),('stitch_w.bin','f',flat(inputs['stitch_weights'])),('stitch_stiffness.bin','f',[1.]*22),('static_vert.bin','d',flat(inputs['body_vertices'])),('static_tri.bin','Q',flat(inputs['body_faces'])),('param/tri-density.bin','f',inputs['face_density'])]:exact(name,code,values)
    for key,value in {**OBJECT,'young-mod':young,'shrink-x':1.,'shrink-y':1.,'bend-warp':0.,'bend-weft':0.,'pressure':0.,'plasticity':0.,'bend-plasticity':0.}.items():
        if key=='stitch-stiffness':continue # Per-body scalar becomes stitch_stiffness.bin, never a face material.
        exact('param/tri-'+key+'.bin','B' if key=='model' else 'f',[2 if key=='model' else value]*4480)
    for name in ['intersect_policy.bin','start_link.bin']:
        try:value=read('bin/'+name)
        except (KeyError,FileNotFoundError):continue
        require(not value,'Unexpected native intersection allowance: '+name)
    params=tomllib.loads(get('param.toml').decode())['param']
    for key,value in SESSION.items():require(params[key.replace('-','_')]==value,'Unexpected effective session control: '+key)
    return {'solved_vertices':2353,'shell_triangles':4480,'static_vertices':19574,'static_triangles':39144,'stitch_rows':22,'native_export_bytes_verified':True}
