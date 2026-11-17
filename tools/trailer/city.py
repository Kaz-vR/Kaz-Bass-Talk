# DEV ONLY: the title cards' city (references/trailers/RUIN-1.md), built and rendered in Blender (Cycles), headless:
#   blender -b --factory-startup --python tools/trailer/city.py -- <out.png> [width=960] [samples=32]
# Brutalist megastructures in a warm haze, placed to the owner's picture: a tall stacked complex on the right, lower
# blocks and a thin tower on the left, a walkway across the middle, faint towers far off. The camera is the trailer
# engine's title camera (tools/trailer/shots.js: at z 1000 looking at the origin, 30 degrees vertical, 16:9), so the
# engine's smoke and sparks can be laid over the still in the same 3D space. Engine units x 0.1 = metres.
import bpy, math, random, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '/tmp/city.png'
WIDTH = int(argv[1]) if len(argv) > 1 else 960
SAMPLES = int(argv[2]) if len(argv) > 2 else 32
random.seed(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
S, CAM_Z, TAN, AR = .1, 1000., math.tan(math.radians(15)), 16 / 9

def P(x, y, z):                       # engine (x right, y up, z towards the camera) -> Blender (z up)
    return Vector((x * S, -z * S, y * S))

def at(fx, fy, dist):                 # a point in the frame (0..1 from the left / top) at a distance -> engine x, y, z
    return (fx * 2 - 1) * dist * TAN * AR, (1 - fy * 2) * dist * TAN, CAM_Z - dist

# ---------- materials ----------
def concrete(name, tone=1.):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; n = nt.nodes; L = nt.links
    bsdf = n['Principled BSDF']; bsdf.inputs['Roughness'].default_value = .92
    tc = n.new('ShaderNodeTexCoord')
    big = n.new('ShaderNodeTexNoise'); big.inputs['Scale'].default_value = .08; big.inputs['Detail'].default_value = 6
    fine = n.new('ShaderNodeTexNoise'); fine.inputs['Scale'].default_value = 2.5; fine.inputs['Detail'].default_value = 10
    stain = n.new('ShaderNodeTexNoise'); stain.inputs['Scale'].default_value = .6   # rain streaks: stretched up and down
    mp = n.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (4, 4, .15)
    L.new(tc.outputs['Object'], mp.inputs['Vector']); L.new(mp.outputs['Vector'], stain.inputs['Vector'])
    L.new(tc.outputs['Object'], big.inputs['Vector']); L.new(tc.outputs['Object'], fine.inputs['Vector'])
    ramp = n.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].color = (.045 * tone, .042 * tone, .039 * tone, 1); ramp.color_ramp.elements[1].color = (.15 * tone, .14 * tone, .128 * tone, 1)
    mix = n.new('ShaderNodeMath'); mix.operation = 'MULTIPLY'
    add = n.new('ShaderNodeMath'); add.operation = 'ADD'
    L.new(big.outputs['Fac'], add.inputs[0]); L.new(fine.outputs['Fac'], mix.inputs[0]); mix.inputs[1].default_value = .35; L.new(mix.outputs[0], add.inputs[1])
    st = n.new('ShaderNodeMath'); st.operation = 'MULTIPLY'; L.new(stain.outputs['Fac'], st.inputs[0]); st.inputs[1].default_value = .5
    sub = n.new('ShaderNodeMath'); sub.operation = 'SUBTRACT'; L.new(add.outputs[0], sub.inputs[0]); L.new(st.outputs[0], sub.inputs[1])
    L.new(sub.outputs[0], ramp.inputs['Fac']); L.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    bump = n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = .25; L.new(fine.outputs['Fac'], bump.inputs['Height']); L.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return m

def emissive(name, rgb, strength):
    m = bpy.data.materials.new(name); m.use_nodes = True; n = m.node_tree.nodes
    for k in list(n): n.remove(k)
    e = n.new('ShaderNodeEmission'); e.inputs['Color'].default_value = (*rgb, 1); e.inputs['Strength'].default_value = strength
    o = n.new('ShaderNodeOutputMaterial'); m.node_tree.links.new(e.outputs[0], o.inputs[0]); return m

def srgb(h):                          # house colours, as linear for Cycles
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in c)

CONC, CORE = concrete('concrete'), concrete('core', .45)
WIN = [emissive('win_hot', srgb('#f25d07'), 3), emissive('win_red', srgb('#f23005'), 2.5)]

# ---------- geometry ----------
def box(x0, x1, y0, y1, zc, d, mat=CONC, arr=None):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.object; o.location = P((x0 + x1) / 2, (y0 + y1) / 2, zc); o.scale = ((x1 - x0) * S, d * S, (y1 - y0) * S)
    o.data.materials.append(mat)
    if arr:                            # (axis, count, gap in engine units): a row of copies
        ax, cnt, gap = arr; md = o.modifiers.new('a', 'ARRAY'); md.count = cnt; md.use_relative_offset = False; md.use_constant_offset = True
        md.constant_offset_displace = [(gap * S) / o.scale[i] if i == ax else 0 for i in range(3)]
        bpy.ops.object.modifier_apply(modifier='a')
    return o

def mono(x0, x1, ytop, zc, d, ybot=-4000, bands=3, win=.5):
    # a monolith: a blank concrete mass with a few deep horizontal window bands cut across it
    zf = zc + d / 2; h = ytop - max(ybot, -900)
    box(x0, x1, ybot, ytop, zc, d)
    for k in range(bands):
        yb = ytop - h * (k + 1) / (bands + 1)
        box(x0 + 10, x1 - 10, yb - 9, yb + 9, zf + 1, 4, CORE)                   # the dark slot of a band (drawn just proud, as a recess)
        box(x0 - 4, x1 + 4, yb + 9, yb + 15, zf + 6, 14)                           # its concrete lip
        for _ in range(int((x1 - x0) / 60 * win)):
            wx = random.uniform(x0 + 20, x1 - 20); box(wx - 7, wx + 7, yb - 6, yb + 4, zf + 3.5, 1, random.choice(WIN))

def block(x0, x1, ytop, zc, d, floor=42., bay=70., ybot=None, win=.06, crown=True):
    # a brutalist block: a dark recessed core, and in front of it a grid of deep piers and floor slabs (the recesses)
    ybot = -4000 if ybot is None else ybot
    zf = zc + d / 2
    box(x0 + 6, x1 - 6, ybot, ytop - 4, zc - 6, d - 12, CORE)                     # the core, set back
    nb = max(1, int((x1 - x0) / bay)); bw = (x1 - x0) / nb
    pw = max(12., bw * .22)
    box(x0, x0 + pw, ybot, ytop, zf - 15, 30, arr=(0, nb + 1, (x1 - x0 - pw) / nb))  # thick piers
    vis = max(ybot, -(CAM_Z - zf) * TAN * 1.1)                                     # slabs only where they can be seen
    nf = int((ytop - vis) / floor)
    if nf > 0: box(x0 - 4, x1 + 4, ytop - nf * floor, ytop - nf * floor + 11, zf - 12, 34, arr=(2, nf, floor))   # deep floor slabs
    box(x0 - 6, x1 + 6, ytop - 14, ytop + 8, zc, d + 14)                            # the parapet
    if crown and x1 - x0 > 120:                                                     # a stepped crown, set back, sometimes off-centre
        w = (x1 - x0) * random.uniform(.35, .6); c = random.uniform(x0 + w / 2, x1 - w / 2); h = random.uniform(40, 110)
        box(c - w / 2, c + w / 2, ytop, ytop + h, zc - d * .15, d * .6)
        if random.random() < .6: box(c - w * .3, c + w * .1, ytop + h, ytop + h + random.uniform(25, 60), zc - d * .2, d * .35)
    if random.random() < .5 and x1 - x0 > 150:                                      # a cantilevered wing high up
        side = random.choice([-1, 1]); w = (x1 - x0) * .35; yb = ytop - random.uniform(.15, .35) * (ytop - max(ybot, -900))
        xa = x0 - w * .5 if side < 0 else x1 - w * .5
        box(xa, xa + w, yb - 80, yb, zc + d * .1, d * .7)
    for _ in range(int(nb * nf * win)):                                             # a few lit windows deep in the recesses
        i, j = random.randrange(nb), random.randrange(max(1, nf))
        wx = x0 + (i + .5) * bw; wy = ytop - (j + .5) * floor
        box(wx - bw * .3, wx + bw * .3, wy - floor * .18, wy + floor * .12, zf - 14, 2, random.choice(WIN))

def F(fx0, fx1, ftop, dist):           # frame fractions -> x0, x1, ytop, z centre at that distance
    x0, yt, z = at(fx0, ftop, dist); x1, _, _ = at(fx1, ftop, dist); return x0, x1, yt, z

# the right complex (~250 m): a tall twin slab, a stacked mass jutting left, a wide base, a low block and a bridge
x0, x1, yt, z = F(.765, .865, .10, 2500); block(x0, x1, yt, z, 260, bay=40)
x0, x1, yt, z = F(.725, .77, .17, 2550); mono(x0, x1, yt, z, 240, bands=5)
x0, x1, yt, z = F(.68, .81, .29, 2350); mono(x0, x1, yt, z, 320, ybot=yt - 200, bands=2)
x0, x1, yt, z = F(.6, .93, .43, 2450); block(x0, x1, yt, z, 380, bay=80)
x0, x1, yt, z = F(.57, .64, .53, 2300); mono(x0, x1, yt, z, 260, bands=3)
x0, x1, yt, z = F(.92, 1.08, .50, 2600); block(x0, x1, yt, z, 300)
x0, _, yb, z = F(.92, 1.0, .40, 2550); box(x0, x0 + 900, yb - 28, yb, z, 70)          # the bridge off to the right
# the left complex (~350 m)
x0, x1, yt, z = F(.165, .19, .30, 6500); block(x0, x1, yt, z, 150, bay=40)
x0, x1, yt, z = F(.05, .245, .45, 6400); mono(x0, x1, yt, z, 450, bands=4)
x0, x1, yt, z = F(.11, .2, .385, 6450); block(x0, x1, yt, z, 300, ybot=yt - 400, bay=70)
x0, x1, yt, z = F(-.08, .06, .55, 6000); block(x0, x1, yt, z, 400)
x0, x1, yt, z = F(.28, .38, .50, 8000); block(x0, x1, yt, z, 450, bay=110)
# the walkway across the middle (~300 m) and a far tower in the middle (~600 m)
x0, x1, yb, z = F(.24, .6, .575, 3000); box(x0, x1, yb - 30, yb, z, 60)
x0, x1, yt, z = F(.485, .51, .33, 11000); mono(x0, x1, yt, z, 400, bands=6, win=.2)
# far off: a ridge of blocks for depth
for k in range(9):
    fx = .02 + k * .11 + random.uniform(-.03, .03); dist = random.uniform(7000, 10000)
    x0, x1, yt, z = F(fx, fx + random.uniform(.03, .06), random.uniform(.44, .56), dist); block(x0, x1, yt, z, 500, bay=90, win=.02)

# ---------- light and air ----------
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs['Color'].default_value = (.0015, .0012, .001, 1)
# the haze: a volume over everything, a little warm, thicker low down
bpy.ops.mesh.primitive_cube_add(size=1); fog = bpy.context.object; fog.location = (0, 600, 20); fog.scale = (3000, 1500, 600)
fm = bpy.data.materials.new('fog'); fm.use_nodes = True; n = fm.node_tree.nodes
for k in list(n): n.remove(k)
tcf = n.new('ShaderNodeTexCoord'); sxf = n.new('ShaderNodeSeparateXYZ'); fm.node_tree.links.new(tcf.outputs['Object'], sxf.inputs[0])
hf = n.new('ShaderNodeMath'); hf.operation = 'MULTIPLY'; fm.node_tree.links.new(sxf.outputs['Z'], hf.inputs[0]); hf.inputs[1].default_value = -2.5   # (object z: -.5..+.5 over 600 m)
he = n.new('ShaderNodeMath'); he.operation = 'EXPONENT'; fm.node_tree.links.new(hf.outputs[0], he.inputs[0])
hd = n.new('ShaderNodeMath'); hd.operation = 'MULTIPLY'; fm.node_tree.links.new(he.outputs[0], hd.inputs[0]); hd.inputs[1].default_value = .0011
he2 = n.new('ShaderNodeMath'); he2.operation = 'MULTIPLY'; fm.node_tree.links.new(he.outputs[0], he2.inputs[0]); he2.inputs[1].default_value = .000007
pv = n.new('ShaderNodeVolumePrincipled'); fm.node_tree.links.new(hd.outputs[0], pv.inputs['Density']); fm.node_tree.links.new(he2.outputs[0], pv.inputs['Emission Strength']); pv.inputs['Color'].default_value = (.85, .8, .74, 1); pv.inputs['Anisotropy'].default_value = .35
# the air glows faintly warm itself (light from the fires all round), so the farther a thing is, the lighter and warmer it gets
pv.inputs['Emission Color'].default_value = (.55, .36, .24, 1); pass
o = n.new('ShaderNodeOutputMaterial'); fm.node_tree.links.new(pv.outputs[0], o.inputs['Volume']); fog.data.materials.append(fm)
# a low ground fog: the lower half of the city dissolves into murk
bpy.ops.mesh.primitive_cube_add(size=1); gf = bpy.context.object; gf.location = (0, 600, -200); gf.scale = (3000, 1500, 260)
gfm = bpy.data.materials.new('groundfog'); gfm.use_nodes = True; gn = gfm.node_tree.nodes
for k in list(gn): gn.remove(k)
gv = gn.new('ShaderNodeVolumePrincipled'); gv.inputs['Density'].default_value = .004; gv.inputs['Color'].default_value = (.6, .55, .5, 1)
gv.inputs['Emission Color'].default_value = (.55, .36, .24, 1); gv.inputs['Emission Strength'].default_value = .000004
go = gn.new('ShaderNodeOutputMaterial'); gfm.node_tree.links.new(gv.outputs[0], go.inputs['Volume']); gf.data.materials.append(gfm)
# the glow behind the city: a wide, low band of fire light far behind it (the brightest part of the haze, behind the middle)
bpy.ops.mesh.primitive_plane_add(size=1); gl = bpy.context.object; gl.location = (0, 1400, 20); gl.rotation_euler = (math.radians(90), 0, 0); gl.scale = (9000, 4000, 1)
gm = emissive('glow', srgb('#f25d07'), 1); nn = gm.node_tree.nodes; LL = gm.node_tree.links
tc = nn.new('ShaderNodeTexCoord'); sx = nn.new('ShaderNodeSeparateXYZ'); LL.new(tc.outputs['Object'], sx.inputs[0])
m1 = nn.new('ShaderNodeMath'); m1.operation = 'SUBTRACT'; LL.new(sx.outputs['Y'], m1.inputs[0]); m1.inputs[1].default_value = -.01   # a band just above the horizon
m2 = nn.new('ShaderNodeMath'); m2.operation = 'DIVIDE'; LL.new(m1.outputs[0], m2.inputs[0]); m2.inputs[1].default_value = .06
m3 = nn.new('ShaderNodeMath'); m3.operation = 'MULTIPLY'; LL.new(m2.outputs[0], m3.inputs[0]); LL.new(m2.outputs[0], m3.inputs[1])
m4 = nn.new('ShaderNodeMath'); m4.operation = 'MULTIPLY'; LL.new(m3.outputs[0], m4.inputs[0]); m4.inputs[1].default_value = -1
m5 = nn.new('ShaderNodeMath'); m5.operation = 'EXPONENT'; LL.new(m4.outputs[0], m5.inputs[0])
m6 = nn.new('ShaderNodeMath'); m6.operation = 'MULTIPLY'; LL.new(m5.outputs[0], m6.inputs[0]); m6.inputs[1].default_value = .3
LL.new(m6.outputs[0], nn['Emission'].inputs['Strength']); gl.data.materials.append(gm)
# a soft warm key from high left, and a faint fill from the camera's side so the facades read
k = bpy.data.lights.new('key', 'SUN'); k.energy = .45; k.color = (1, .62, .38); k.angle = math.radians(8)
ko = bpy.data.objects.new('key', k); sc.collection.objects.link(ko); ko.rotation_euler = (math.radians(60), math.radians(-35), math.radians(-20))
f = bpy.data.lights.new('fill', 'SUN'); f.energy = .12; f.color = (1, .85, .7)
fo = bpy.data.objects.new('fill', f); sc.collection.objects.link(fo); fo.rotation_euler = (math.radians(80), 0, 0)

# ---------- camera and render ----------
cd = bpy.data.cameras.new('cam'); cd.sensor_fit = 'VERTICAL'; cd.angle_y = math.radians(30); cd.clip_end = 5000
co = bpy.data.objects.new('cam', cd); sc.collection.objects.link(co); co.location = P(0, 0, CAM_Z); co.rotation_euler = (math.radians(90), 0, 0); sc.camera = co
r = sc.render; r.engine = 'CYCLES'; r.resolution_x = WIDTH; r.resolution_y = round(WIDTH * 9 / 16); r.filepath = OUT
sc.cycles.samples = SAMPLES; sc.cycles.use_denoising = True; sc.cycles.volume_step_rate = 4; sc.cycles.max_bounces = 4; sc.cycles.volume_bounces = 1
sc.view_settings.view_transform = 'Standard'; sc.view_settings.exposure = 0
sc.view_layers[0].use_pass_z = True
bpy.ops.render.render(write_still=True)
print('city: wrote', OUT)
