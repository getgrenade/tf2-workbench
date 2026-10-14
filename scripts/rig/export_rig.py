"""Exports an armature from a .blend file as the JSON the workbench's rig solver reads.

    blender -b rig.blend --python scripts/rig/export_rig.py -- <armature object name | auto> <out.json>

`auto` takes the armature with the most bones among those that have the game's skeleton in them (twenty or more `bip_` bones): the rig, not the plain skeleton it drives.

Everything the solver needs is written: the rest pose of every bone (in armature space), the parent links, each bone's constraint stack, the
drivers that switch constraints on and off, the sliders (custom properties) with their ranges, and the shapes the controls are drawn with.
The workbench ships no rig: it reads the one you point it at, from a .blend of your own.
"""
import bpy
import json
import re
import sys

argv = sys.argv[sys.argv.index("--") + 1:]
name, dest = argv[0], argv[1]
if name == "auto":
    best, score = None, 0
    for candidate in bpy.data.objects:
        if candidate.type == "ARMATURE":
            game = sum(1 for b in candidate.data.bones if b.name.lower().startswith("bip_"))
            if game >= 20 and len(candidate.data.bones) > score:
                best, score = candidate, len(candidate.data.bones)
    if best is None:
        print("NO_TF2_SKELETON")
        sys.exit(3)
    name = best.name
obj = bpy.data.objects[name]
arm = obj.data


def num(v):
    return round(float(v), 6)


def matrix(m):
    """Column major 16 numbers."""
    return [num(m[r][c]) for c in range(4) for r in range(4)]


def plain(value):
    """A property value as JSON."""
    if isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        return num(value)
    if hasattr(value, "name") and hasattr(value, "bl_rna"):
        return {"id": value.name}
    try:
        return [plain(v) for v in value]
    except TypeError:
        return str(value)


SKIP = {"rna_type", "name", "type", "is_valid", "show_expanded", "error_location", "error_rotation", "active", "is_override_data", "use_sphere", "ik_type"}


def constraint(c):
    out = {"name": c.name, "type": c.type}
    for prop in c.bl_rna.properties:
        key = prop.identifier
        if key in SKIP or prop.type == "COLLECTION" or prop.type == "POINTER" and key not in ("target", "pole_target"):
            continue
        value = getattr(c, key)
        if key in ("target", "pole_target"):
            out[key] = value.name if value else None
            continue
        out[key] = plain(value)
    if c.type == "ARMATURE":
        out["targets"] = [{"target": t.target.name if t.target else None, "subtarget": t.subtarget, "weight": num(t.weight)} for t in c.targets]
    return out


def custom_props(pb):
    props = {}
    for key in pb.keys():
        if key.startswith("_"):
            continue
        value = pb[key]
        if not isinstance(value, (int, float)):
            continue
        entry = {"value": plain(value)}
        try:
            ui = pb.id_properties_ui(key).as_dict()
            for k in ("min", "max", "soft_min", "soft_max", "default", "step"):
                if k in ui:
                    entry[k] = plain(ui[k])
        except Exception:
            pass
        props[key] = entry
    return props


collections = []
for bc in arm.collections_all:
    collections.append({"name": bc.name, "visible": bc.is_visible, "parent": bc.parent.name if bc.parent else None})

shapes = {}


def shape(mesh_obj):
    if mesh_obj.name in shapes:
        return
    me = mesh_obj.data
    shapes[mesh_obj.name] = {"verts": [[num(v.co.x), num(v.co.y), num(v.co.z)] for v in me.vertices], "edges": [[e.vertices[0], e.vertices[1]] for e in me.edges],
                             "faces": [[v for v in p.vertices] for p in me.polygons][:200]}


bones = []
for pb in obj.pose.bones:
    b = pb.bone
    if pb.custom_shape:
        shape(pb.custom_shape)
    bones.append({
        "name": b.name,
        "parent": b.parent.name if b.parent else None,
        "rest": matrix(b.matrix_local),
        "length": num(b.length),
        "connect": b.use_connect,
        "inheritRotation": b.use_inherit_rotation,
        "inheritScale": b.inherit_scale,
        "localLocation": b.use_local_location,
        "relativeParent": b.use_relative_parent,
        "deform": b.use_deform,
        "hidden": b.hide,
        "collections": [c.name for c in b.collections],
        "rotationMode": pb.rotation_mode,
        "pose": {"loc": [num(v) for v in pb.location], "quat": [num(v) for v in pb.rotation_quaternion], "euler": [num(v) for v in pb.rotation_euler], "scale": [num(v) for v in pb.scale]},
        "lock": {"loc": list(pb.lock_location), "rot": list(pb.lock_rotation), "scale": list(pb.lock_scale), "rotW": pb.lock_rotation_w},
        "ik": {"stretch": num(pb.ik_stretch), "lock": [pb.lock_ik_x, pb.lock_ik_y, pb.lock_ik_z],
               "limit": [pb.use_ik_limit_x, pb.use_ik_limit_y, pb.use_ik_limit_z],
               "min": [num(pb.ik_min_x), num(pb.ik_min_y), num(pb.ik_min_z)], "max": [num(pb.ik_max_x), num(pb.ik_max_y), num(pb.ik_max_z)],
               "stiffness": [num(pb.ik_stiffness_x), num(pb.ik_stiffness_y), num(pb.ik_stiffness_z)]},
        "bbone": {
            "segments": b.bbone_segments,
            "prevType": b.bbone_handle_type_start, "nextType": b.bbone_handle_type_end,
            "prev": b.bbone_custom_handle_start.name if b.bbone_custom_handle_start else None,
            "next": b.bbone_custom_handle_end.name if b.bbone_custom_handle_end else None,
            "easeIn": num(b.bbone_easein), "easeOut": num(b.bbone_easeout), "rollIn": num(b.bbone_rollin), "rollOut": num(b.bbone_rollout),
            "scaleIn": [num(v) for v in b.bbone_scalein], "scaleOut": [num(v) for v in b.bbone_scaleout],
            "curveInX": num(b.bbone_curveinx), "curveInZ": num(b.bbone_curveinz), "curveOutX": num(b.bbone_curveoutx), "curveOutZ": num(b.bbone_curveoutz),
            "handleScaleStart": list(b.bbone_handle_use_scale_start), "handleScaleEnd": list(b.bbone_handle_use_scale_end),
            "handleEaseStart": b.bbone_handle_use_ease_start, "handleEaseEnd": b.bbone_handle_use_ease_end,
            "endRollAsInRoll": b.use_endroll_as_inroll, "scaleEasing": b.use_scale_easing,
            "pose": {"easeIn": num(pb.bbone_easein), "easeOut": num(pb.bbone_easeout), "rollIn": num(pb.bbone_rollin), "rollOut": num(pb.bbone_rollout),
                     "scaleIn": [num(v) for v in pb.bbone_scalein], "scaleOut": [num(v) for v in pb.bbone_scaleout],
                     "curveInX": num(pb.bbone_curveinx), "curveInZ": num(pb.bbone_curveinz), "curveOutX": num(pb.bbone_curveoutx), "curveOutZ": num(pb.bbone_curveoutz)},
        } if b.bbone_segments > 1 else {"segments": b.bbone_segments},
        "shape": ({"name": pb.custom_shape.name, "scale": [num(v) for v in pb.custom_shape_scale_xyz], "translation": [num(v) for v in pb.custom_shape_translation],
                   "rotation": [num(v) for v in pb.custom_shape_rotation_euler], "boneSize": pb.use_custom_shape_bone_size,
                   "transformBone": pb.custom_shape_transform.name if pb.custom_shape_transform else None, "wire": num(pb.custom_shape_wire_width)} if pb.custom_shape else None),
        "color": {"set": pb.color.palette, "normal": plain(pb.color.custom.normal) if pb.color.palette == "CUSTOM" else None, "select": plain(pb.color.custom.select) if pb.color.palette == "CUSTOM" else None},
        "props": custom_props(pb),
        "constraints": [constraint(c) for c in pb.constraints],
    })

drivers = []
if obj.animation_data:
    for f in obj.animation_data.drivers:
        d = f.driver
        variables = []
        for v in d.variables:
            targets = []
            for t in v.targets:
                targets.append({"id": t.id.name if t.id else None, "path": t.data_path, "bone": t.bone_target, "transform": t.transform_type, "space": t.transform_space})
            variables.append({"name": v.name, "type": v.type, "targets": targets})
        drivers.append({"path": f.data_path, "index": f.array_index, "type": d.type, "expression": d.expression, "variables": variables,
                        "extrapolation": f.extrapolation, "modifiers": [m.type for m in f.modifiers], "keyframes": [[num(k.co[0]), num(k.co[1])] for k in f.keyframe_points]})

out = {"armature": name, "blender": bpy.app.version_string, "bones": bones, "collections": collections, "drivers": drivers, "shapes": shapes,
       "objectProps": {k: plain(obj[k]) for k in obj.keys() if isinstance(obj[k], (int, float, str))}}
with open(dest, "w") as fh:
    json.dump(out, fh, separators=(",", ":"))
print("EXPORTED", len(bones), "bones", len(drivers), "drivers", len(shapes), "shapes")
