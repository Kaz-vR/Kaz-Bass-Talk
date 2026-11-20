# DEV ONLY: the trailer's wide shots rebuilt in Blender (Cycles), to compare with our own engine (owner's test, 20 Nov).
#   blender -b -P tools/trailer/blender_wide.py -- <shot> <page base.png> <out.png> [samples] [width]
# The scene is the engine's: the synth a slab with the captured UI on its face (1 css px = 1 mm, real size), the same
# camera (target, offset, roll, fov) as the UISHOTS entry at frame 40; the UI's glowing parts emit light (they light
# the smoke), a big soft key light over the whole panel, a warm firelight fill from below in #f25d07, a faint haze in
# the air, a smoke volume thick at the edges and thin round the subject, spark streaks in the house colours, and a
# real depth of field.
import bpy, math, random, sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
SHOT, IMG, OUT = argv[0], argv[1], argv[2]
SAMPLES = int(argv[3]) if len(argv) > 3 else 96
WIDTH = int(argv[4]) if len(argv) > 4 else 1920
PW, PH, S = 1358, 750, 0.001
# the UISHOTS entries (tools/trailer/shots.js): target (css px), move over 3 s, camera offset, roll, fov
SHOTS = { 'wide': ((679, 380), (-60, 0), (-420, -900, 1450), 5, 26), 'ruin_wide': ((679, 300), (60, 0), (380, -760, 1150), -5, 26) }
(tx, ty), (mx, my), (ox, oy, oz), ROLL, FOV = SHOTS[SHOT]
t = 40 / 74
def P(px, py): return Vector((px - PW / 2, PH / 2 - py, 0))
def B(v): return Vector((v.x, -v.z, v.y)) * S                      # ours (x right, y up, z to the camera) -> Blender (z up)
target = P(tx + mx * t, ty + my * t); pos = target + Vector((ox, oy, oz))

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = SAMPLES; sc.cycles.use_denoising = True
sc.cycles.max_bounces = 4; sc.cycles.volume_bounces = 1; sc.cycles.volume_step_rate = 3
sc.render.resolution_x = WIDTH; sc.render.resolution_y = WIDTH * 9 // 16; sc.render.film_transparent = False
sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'; sc.view_settings.exposure = 0.0

def mat(name): m = bpy.data.materials.new(name); m.use_nodes = True; return m, m.node_tree.nodes, m.node_tree.links
def hexlin(h): return tuple(((int(h[i:i + 2], 16) / 255 + .055) / 1.055) ** 2.4 if int(h[i:i + 2], 16) / 255 > .04045 else int(h[i:i + 2], 16) / 255 / 12.92 for i in (1, 3, 5))

# ---- the synth: the face (the captured UI) and the slab behind it
m, n, l = mat('face'); bsdf = n['Principled BSDF']; out = n['Material Output']
img = n.new('ShaderNodeTexImage'); img.image = bpy.data.images.load(IMG); img.interpolation = 'Cubic'
uv = n.new('ShaderNodeTexCoord'); sep = n.new('ShaderNodeSeparateXYZ'); l.new(uv.outputs['UV'], sep.inputs[0])
keys = n.new('ShaderNodeMath'); keys.operation = 'LESS_THAN'; keys.inputs[1].default_value = .205; l.new(sep.outputs['Y'], keys.inputs[0])
kdim = n.new('ShaderNodeMapRange'); kdim.inputs[3].default_value = 1; kdim.inputs[4].default_value = .35; l.new(keys.outputs[0], kdim.inputs[0])   # the keys darker
col = n.new('ShaderNodeMixRGB'); col.blend_type = 'MULTIPLY'; col.inputs[0].default_value = 1; l.new(img.outputs['Color'], col.inputs[1]); l.new(kdim.outputs[0], col.inputs[2])
hsv = n.new('ShaderNodeSeparateColor'); hsv.mode = 'HSV'; l.new(img.outputs['Color'], hsv.inputs[0])
# what glows on its own: bright, or saturated and not dark (the waveforms, arcs, values)
sv = n.new('ShaderNodeMath'); sv.operation = 'MULTIPLY'; l.new(hsv.outputs[1], sv.inputs[0]); l.new(hsv.outputs[2], sv.inputs[1])
m1 = n.new('ShaderNodeMapRange'); m1.inputs[1].default_value = .12; m1.inputs[2].default_value = .45; l.new(sv.outputs[0], m1.inputs[0])
m2 = n.new('ShaderNodeMapRange'); m2.inputs[1].default_value = .35; m2.inputs[2].default_value = .8; l.new(hsv.outputs[2], m2.inputs[0])
gl = n.new('ShaderNodeMath'); gl.operation = 'MAXIMUM'; l.new(m1.outputs[0], gl.inputs[0]); l.new(m2.outputs[0], gl.inputs[1])
gk = n.new('ShaderNodeMath'); gk.operation = 'MULTIPLY'; l.new(gl.outputs[0], gk.inputs[0]); l.new(kdim.outputs[0], gk.inputs[1])
l.new(col.outputs[0], bsdf.inputs['Base Color']); bsdf.inputs['Roughness'].default_value = .38; bsdf.inputs['Specular IOR Level'].default_value = .35
l.new(col.outputs[0], bsdf.inputs['Emission Color']); es = n.new('ShaderNodeMath'); es.operation = 'MULTIPLY'; es.inputs[1].default_value = 2.6
l.new(gk.outputs[0], es.inputs[0]); l.new(es.outputs[0], bsdf.inputs['Emission Strength'])
bpy.ops.mesh.primitive_plane_add(size=1); face = bpy.context.object; face.data.materials.append(m)
face.scale = (PW * S, PH * S, 1); face.rotation_euler = (math.pi / 2, 0, 0); face.location = (0, 0, 0)
ms, ns, ls = mat('slab'); ns['Principled BSDF'].inputs['Base Color'].default_value = (.008, .007, .006, 1); ns['Principled BSDF'].inputs['Roughness'].default_value = .5
bpy.ops.mesh.primitive_cube_add(size=1); slab = bpy.context.object; slab.data.materials.append(ms)
slab.scale = (PW * S, 34 * S, PH * S); slab.location = (0, 17 * S + .0005, 0)

# ---- the camera: the engine's look(pos, target, roll), its fov (vertical), a real depth of field on the target
cam = bpy.data.cameras.new('cam'); cam.sensor_fit = 'VERTICAL'; cam.sensor_height = 24; cam.angle_y = math.radians(FOV)
co = bpy.data.objects.new('cam', cam); sc.collection.objects.link(co); sc.camera = co
p, tg = B(pos), B(target); f = (tg - p).normalized(); up0 = B(Vector((math.sin(math.radians(ROLL)), math.cos(math.radians(ROLL)), 0))).normalized()
r = f.cross(up0).normalized(); u = r.cross(f)
co.matrix_world = Matrix((r.to_4d(), u.to_4d(), (-f).to_4d(), (0, 0, 0, 1))).transposed(); co.location = p
cam.clip_start = .01; cam.clip_end = 100
cam.dof.use_dof = True; cam.dof.focus_distance = (tg - p).length; cam.dof.aperture_fstop = 1.4

# ---- light: a big soft key over the whole panel (above, in front), a warm firelight fill from below (#f25d07)
def area(name, loc, size, power, color, aim):
    ld = bpy.data.lights.new(name, 'AREA'); ld.size = size[0]; ld.shape = 'RECTANGLE'; ld.size_y = size[1]; ld.energy = power; ld.color = color
    o = bpy.data.objects.new(name, ld); sc.collection.objects.link(o); o.location = loc
    d = (Vector(aim) - Vector(loc)).normalized(); o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler(); return o
area('key', (-.25, -.9, .75), (1.6, .9), 9, (1, .93, .86), (0, 0, .05))
area('fire', (.1, -.7, -.9), (1.8, .4), 14, hexlin('#f25d07'), (0, 0, -.1))

# ---- the air: a faint haze everywhere, and the smoke: a volume in front of the panel, fractal, thick at the edges of
# the frame and thin round the subject (it frames the synth instead of veiling it)
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; wn = w.node_tree.nodes; wn['Background'].inputs['Color'].default_value = (0, 0, 0, 1)
hz = wn.new('ShaderNodeVolumePrincipled'); hz.inputs['Density'].default_value = .0025; hz.inputs['Anisotropy'].default_value = .35
w.node_tree.links.new(hz.outputs[0], wn['World Output'].inputs['Volume'])
mv, nv, lv = mat('smoke'); nv.remove(nv['Principled BSDF']); vol = nv.new('ShaderNodeVolumePrincipled'); vol.inputs['Color'].default_value = (.3, .28, .26, 1); vol.inputs['Anisotropy'].default_value = .3
tc = nv.new('ShaderNodeTexCoord'); nz = nv.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 2.2; nz.inputs['Detail'].default_value = 8; nz.inputs['Roughness'].default_value = .62; nz.inputs['Distortion'].default_value = .6
lv.new(tc.outputs['Object'], nz.inputs['Vector'])
cr = nv.new('ShaderNodeValToRGB'); cr.color_ramp.elements[0].position = .48; cr.color_ramp.elements[1].position = .78; lv.new(nz.outputs['Fac'], cr.inputs[0])
emp = bpy.data.objects.new('subject', None); sc.collection.objects.link(emp); emp.location = tg
tc2 = nv.new('ShaderNodeTexCoord'); tc2.object = emp; ln = nv.new('ShaderNodeVectorMath'); ln.operation = 'LENGTH'; lv.new(tc2.outputs['Object'], ln.inputs[0])
clr = nv.new('ShaderNodeMapRange'); clr.inputs[1].default_value = .18; clr.inputs[2].default_value = .65; clr.inputs[3].default_value = .12; clr.inputs[4].default_value = 1; lv.new(ln.outputs['Value'], clr.inputs[0])
d1 = nv.new('ShaderNodeMath'); d1.operation = 'MULTIPLY'; lv.new(cr.outputs['Color'], d1.inputs[0]); lv.new(clr.outputs[0], d1.inputs[1])
d2 = nv.new('ShaderNodeMath'); d2.operation = 'MULTIPLY'; d2.inputs[1].default_value = 1.0; lv.new(d1.outputs[0], d2.inputs[0]); lv.new(d2.outputs[0], vol.inputs['Density'])
lv.new(vol.outputs[0], nv['Material Output'].inputs['Volume'])
bpy.ops.mesh.primitive_cube_add(size=1); sm = bpy.context.object; sm.data.materials.append(mv)
sm.scale = (2.4, .5, 1.6); sm.location = (0, -.27, 0)

# ---- sparks: short glowing streaks drifting up and across, in the house colours (hot #f25d07, #f23005, cool #f20000)
random.seed(7)
cols = [hexlin('#f25d07'), hexlin('#f23005'), hexlin('#f20000')]
smats = []
for i, c in enumerate(cols):
    mm, nn, ll = mat(f'spark{i}'); nn.remove(nn['Principled BSDF']); em = nn.new('ShaderNodeEmission'); em.inputs['Color'].default_value = (*c, 1); em.inputs['Strength'].default_value = [14, 9, 6][i]
    ll.new(em.outputs[0], nn['Material Output'].inputs['Surface']); smats.append(mm)
bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=1, depth=1); proto = bpy.context.object; proto.data.materials.append(smats[0])
for k in range(120):
    o = proto.copy(); o.data = proto.data; sc.collection.objects.link(o)
    o.active_material_index = 0; o.material_slots[0].link = 'OBJECT'; o.material_slots[0].material = smats[min(2, int(random.random() ** .7 * 3))]
    dep = -random.random() ** 2.2 * .3 - .004                                             # in front of the face, denser close to it
    o.location = (random.uniform(-.85, .85), dep, random.uniform(-.55, .6))
    ln_ = random.uniform(.004, .014); o.scale = (.00035, .00035, ln_)
    o.rotation_euler = (random.uniform(-.15, .15), random.uniform(-.6, .6), 0)
proto.hide_render = True

# the orange wash (the engine's tint=0.22): the picture coloured towards #f25d07 at 22 %, its brightness kept
sc.use_nodes = True; ct = sc.node_tree; ct.nodes.clear()
rl = ct.nodes.new('CompositorNodeRLayers'); mx = ct.nodes.new('CompositorNodeMixRGB'); mx.blend_type = 'COLOR'; mx.inputs[0].default_value = .22
mx.inputs[2].default_value = (*hexlin('#f25d07'), 1); co_ = ct.nodes.new('CompositorNodeComposite')
ct.links.new(rl.outputs['Image'], mx.inputs[1]); ct.links.new(mx.outputs[0], co_.inputs['Image'])
sc.render.filepath = OUT; sc.render.image_settings.file_format = 'PNG'
bpy.ops.render.render(write_still=True)
print('rendered', OUT)
