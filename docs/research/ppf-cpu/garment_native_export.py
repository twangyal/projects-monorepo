"""Raw native input admission; never unpickles frontend session state."""
import struct
import tomllib
from garment_admission import require
from garment_native_inputs import OBJECT,SESSION


def flat(rows):return [v for row in rows for v in row]


def verify_export(read,inputs,young,object_parameters=None,body_contact_offset=0.,session_parameters=None,half_step_study=False,gravity_study=None):
    object_parameters=OBJECT if object_parameters is None else object_parameters
    session_parameters=SESSION if session_parameters is None else session_parameters
    require(type(half_step_study) is bool,'Half-step admission must be explicit.')
    require(gravity_study is None or (gravity_study in ('reference','zero') and not half_step_study),'Gravity admission requires a distinct explicit reference or zero protocol.')
    admitted_session={**SESSION,**({'dt':1/240} if half_step_study else {}),**({'gravity':[0.,0.,0.]} if gravity_study=='zero' else {})}
    admitted_frames=[180] if half_step_study or gravity_study is not None else [18,60,180]
    require(set(session_parameters)==set(SESSION) and type(session_parameters["frames"]) is int and session_parameters["frames"] in admitted_frames and all(session_parameters[k]==v for k,v in admitted_session.items() if k!="frames"),"Undeclared session change.")
    def get(path):
        try:return read(path)
        except (KeyError,OSError) as error:raise ValueError('Missing native input: '+path) from error
    def exact(name,code,values):
        expected=struct.pack('<'+str(len(values))+code,*values)
        require(get('bin/'+name)==expected,'Native input differs from frozen mapping: '+name)
    counts=tomllib.loads(get('info.toml').decode())['count']
    expected={'vert':2353,'tri':4480,'static_vert':19574,'static_tri':39144,'stitch':22,'pin_block':0,'rod':0,'tet':0,'wall':0,'sphere':0,'display_pin_block':0,'rod_vert_start':0,'rod_vert_end':0,'shell_vert_start':0,'shell_vert_end':2353,'shell_count':4480,'rod_count':0,'has_rest_vert':True,'has_rest_vert_anim':False,'rest_vert_anim_frames':0,'has_bend_rest_vert':False}
    for key,value in expected.items():require(counts[key]==value,'Unexpected native scene metadata: '+key)
    for name,code,values in [('vert.bin','d',flat(inputs['initial'])),('rest_vert.bin','d',flat(inputs['rest'])),('rest_vert_mask.bin','B',[1]*2353),('vel.bin','f',[0.]*(2353*3)),('displacement.bin','d',[0.,0.,0.]*2),('static_vert_dmap.bin','I',[1]*19574),('vert_dmap.bin','I',[0]*2353),('object_vert.bin','I',[0]*2353),('tri.bin','Q',flat(inputs['faces'])),('uv.bin','f',flat(flat(inputs['uv']))),('stitch_ind.bin','Q',flat(inputs['stitch_indices'])),('stitch_w.bin','f',flat(inputs['stitch_weights'])),('stitch_stiffness.bin','f',[object_parameters['stitch-stiffness']]*22),('static_vert.bin','d',flat(inputs['body_vertices'])),('static_tri.bin','Q',flat(inputs['body_faces'])),('param/tri-density.bin','f',inputs['face_density'])]:exact(name,code,values)
    for key,value in {**object_parameters,'young-mod':young,'shrink-x':1.,'shrink-y':1.,'bend-warp':0.,'bend-weft':0.,'pressure':0.,'plasticity':0.,'bend-plasticity':0.}.items():
        if key=='stitch-stiffness':continue # Per-body scalar becomes stitch_stiffness.bin, never a face material.
        exact('param/tri-'+key+'.bin','B' if key=='model' else 'f',[2 if key=='model' else value]*4480)
    exact('param/static-contact-offset.bin','f',[body_contact_offset]*39144)
    exact('param/static-contact-gap.bin','f',[.001]*39144)
    for name in ['intersect_policy.bin','start_link.bin']:
        try:value=read('bin/'+name)
        except (KeyError,FileNotFoundError):continue
        require(not value,'Unexpected native intersection allowance: '+name)
    params=tomllib.loads(get('param.toml').decode())['param']
    for key,value in session_parameters.items():require(params[key.replace('-','_')]==value,'Unexpected effective session control: '+key)
    return {'solved_vertices':2353,'shell_triangles':4480,'static_vertices':19574,'static_triangles':39144,'stitch_rows':22,'native_export_bytes_verified':True}
