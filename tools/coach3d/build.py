# Builds the coach: a man in a suit, tanned, thick black glasses, a beard (Harry, 14 Nov 2026), from MakeHuman CC0
# assets with MPFB, on the TalkingHead rig, with ARKit and Oculus face shapes; exports a GLB.
import bpy, sys, os, json, importlib.util, traceback
out = sys.argv[sys.argv.index('--') + 1]
opts = json.loads(sys.argv[sys.argv.index('--') + 2]) if len(sys.argv) > sys.argv.index('--') + 2 else {}
HERE = os.path.dirname(os.path.abspath(__file__))
import addon_utils; addon_utils.enable('bl_ext.user_default.mpfb', default_set=True)
from bl_ext.user_default.mpfb.services import HumanService, TargetService, LocationService, ObjectService, AssetService, ExportService, FaceService
D = LocationService.get_user_data()
bpy.ops.wm.read_factory_settings(use_empty=True); addon_utils.enable('bl_ext.user_default.mpfb', default_set=True)

macro = TargetService.get_default_macro_info_dict()
macro.update({'gender': 1.0, 'age': opts.get('age', 0.62), 'muscle': opts.get('muscle', 0.62), 'weight': opts.get('weight', 0.52), 'height': 0.6, 'proportions': 0.6})
macro['race'] = {'asian': 0.15, 'caucasian': 0.7, 'african': 0.15}
base = HumanService.create_human(mask_helpers=True, detailed_helpers=True, extra_vertex_groups=True, feet_on_ground=True, scale=0.1, macro_detail_dict=macro)
print('basemesh', base.name, len(base.data.vertices))

arm = HumanService.add_custom_rig(base, 'custom.talkinghead', import_weights=True)
print('rig', arm.name, len(arm.data.bones))

MT = 'GAMEENGINE'
skin = os.path.join(D, 'skins', opts.get('skin', 'middleage_caucasian_male'), opts.get('skin', 'middleage_caucasian_male') + '.mhmat')
HumanService.set_character_skin(skin, base, skin_type='GAMEENGINE', material_instances=False)

def add(kind, sub, name, mhclo=None):
    p = os.path.join(D, sub, name, (mhclo or name) + '.mhclo')
    if not os.path.isfile(p): raise RuntimeError('missing ' + p)
    before = set(bpy.data.objects)
    HumanService.add_mhclo_asset(p, base, asset_type=kind, subdiv_levels=0, material_type=MT)
    new = [o for o in bpy.data.objects if o not in before]
    print('added', kind, name, [o.name for o in new]); return new
add('Eyes', 'eyes', 'high-poly'); add('Eyebrows', 'eyebrows', opts.get('brows', 'eyebrow006')); add('Eyelashes', 'eyelashes', 'eyelashes01')
add('Teeth', 'teeth', 'teeth_base'); add('Tongue', 'tongue', 'tongue01'); add('Hair', 'hair', opts.get('hair', 'short04'))
for c in opts.get('clothes', ['male_elegantsuit01', 'shoes03', 'wdg_scruffy_beard', 'spamrakuen_tbm_glasses_frames_01']): add('Clothes', 'clothes', c)
# eye colour
try:
    from bl_ext.user_default.mpfb.services import MaterialService
except Exception: MaterialService = None

# ---- the export copy (MPFB.md): bake the modelling shape keys, load the Meta visemes and ARKit face units,
# interpolate them to the clothes and body parts, bake masks, delete helpers
copy = ExportService.create_character_copy(base, name_suffix='_export', place_in_collection=base.users_collection[0])
nb = ObjectService.find_object_of_type_amongst_nearest_relatives(copy)
TargetService.bake_targets(nb)
FaceService.load_targets(nb, load_microsoft_visemes=False, load_meta_visemes=True, load_arkit_faceunits=True)
FaceService.interpolate_targets(nb)
ExportService.bake_modifiers_remove_helpers(nb, bake_masks=True, bake_subdiv=False, remove_helpers=True, also_proxy=True)
rig = nb.parent if nb.parent and nb.parent.type == 'ARMATURE' else copy
print('export rig', rig.name, 'children', [c.name for c in rig.children])
# the originals go; only the export copy is kept
keep = set([rig] + list(rig.children_recursive))
for o in list(bpy.data.objects):
    if o not in keep: bpy.data.objects.remove(o, do_unlink=True)
rig.name = 'Armature'; rig.data.name = 'Armature'

# the TalkingHead add-on's own steps: scale to the hips height it expects, fix the bone axes (A-pose)
spec = importlib.util.spec_from_file_location('thaddon', os.path.join(HERE, 'avatar-src', 'talkinghead-addon.py')); th = importlib.util.module_from_spec(spec); spec.loader.exec_module(th)
bpy.ops.object.select_all(action='DESELECT'); rig.select_set(True); bpy.context.view_layer.objects.active = rig
try: th.scale_character([rig]); print('scaled')
except Exception: traceback.print_exc()
try: th.fix_bone_axes([rig], th.BONE_AXES_DATA_A); print('axes fixed')
except Exception: traceback.print_exc()
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='SELECT'); bpy.context.view_layer.objects.active = rig
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

for o in rig.children:
    if o.type == 'MESH':
        sk = o.data.shape_keys
        print(' mesh', o.name, 'verts', len(o.data.vertices), 'keys', len(sk.key_blocks) if sk else 0, 'mods', [m.type for m in o.modifiers], 'mats', [m.name for m in o.data.materials if m])
bpy.ops.wm.save_as_mainfile(filepath=os.path.splitext(out)[0] + '.blend')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_animations=False, export_morph=True, export_morph_normal=False, export_skins=True, export_apply=False, export_yup=True)
print('exported', out, os.path.getsize(out))
