"""Poses a rig in Blender and writes what Blender made of it, for the tests of the workbench's solver to compare against.

    blender -b rig.blend --python scripts/rig/oracle.py -- <armature object name> <out.json> [cases] [seed]

Each case sets sliders and the pose channels of some bones, and records the armature space matrix of every bone afterwards.
"""
import bpy
import json
import math
import random
import sys

argv = sys.argv[sys.argv.index("--") + 1:]
name, dest = argv[0], argv[1]
count = int(argv[2]) if len(argv) > 2 else 12
seed = int(argv[3]) if len(argv) > 3 else 7
rnd = random.Random(seed)
obj = bpy.data.objects[name]
pose = obj.pose
# the sliders as the file has them: every case starts from these
initial = {}
for _pb in pose.bones:
    for _key in _pb.keys():
        if isinstance(_pb[_key], (int, float)) and not _key.startswith("_"):
            initial.setdefault(_pb.name, {})[_key] = _pb[_key]


def matrix(m):
    return [round(float(m[r][c]), 6) for c in range(4) for r in range(4)]


def reset():
    for bone, props in initial.items():
        for key, value in props.items():
            pose.bones[bone][key] = value
    for pb in pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)


def record():
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    joints = {pb.name: [matrix(pb.bbone_segment_matrix(i, rest=False)) for i in range(pb.bone.bbone_segments + 1)] for pb in ev.pose.bones if pb.bone.bbone_segments > 1}
    return {pb.name: matrix(pb.matrix) for pb in ev.pose.bones}, {pb.name: pb.bone.hide for pb in ev.pose.bones}, joints


def apply(case):
    reset()
    for bone, props in case.get("props", {}).items():
        for key, value in props.items():
            pose.bones[bone][key] = value
    for bone, ch in case.get("channels", {}).items():
        pb = pose.bones[bone]
        if "loc" in ch:
            pb.location = ch["loc"]
        if "rot" in ch:
            if pb.rotation_mode == "QUATERNION":
                pb.rotation_quaternion = ch["rot"]
            else:
                pb.rotation_euler = ch["rot"]
        if "scale" in ch:
            pb.scale = ch["scale"]


def rand_rot(mode, amount, locks=(False, False, False)):
    e = [0.0 if locks[i] else rnd.uniform(-amount, amount) for i in range(3)]
    if mode == "QUATERNION":
        from mathutils import Euler
        q = Euler(e).to_quaternion()
        return [q.w, q.x, q.y, q.z]
    return e


# the sliders as they stand
sliders = {}
for pb in pose.bones:
    for key in pb.keys():
        if isinstance(pb[key], (int, float)) and not key.startswith("_"):
            sliders.setdefault(pb.name, {})[key] = pb[key]

controls = [pb for pb in pose.bones if any(c.name in ("TORSO", "L ARM FK", "R ARM FK", "L LEG FK", "R LEG FK", "L ARM IK", "R ARM IK", "L LEG IK", "R LEG IK", "L FINGERS", "R FINGERS",
                                                         "MISC BONES") for c in pb.bone.collections)]
cases = []


def add(label, props=None, channels=None):
    case = {"label": label, "props": props or {}, "channels": channels or {}}
    apply(case)
    mats, hide, joints = record()
    case["matrices"] = mats
    case["joints"] = joints
    case["hide"] = hide
    cases.append(case)


add("rest")
only = lambda names, amount, loc=0.0: {n: {"rot": rand_rot(pose.bones[n].rotation_mode, amount, tuple(pose.bones[n].lock_rotation)), **({"loc": [rnd.uniform(-loc, loc) for _ in range(3)]} if loc else {})} for n in names if n in pose.bones}
add("fk spine/head", channels=only(["CTRL_SPINE", "CTRL_HEAD", "CTRL_NECK", "CTRL_PELVIS", "CTRL_HIPS"], 0.35))
add("fk arms (FK mode)", props={"PROPERTIES": {"L ARM IK/FK": 0.0, "R ARM IK/FK": 0.0}}, channels=only(["FK_UPPERARM_L", "FK_LOWERARM_L", "FK_HAND_L", "FK_UPPERARM_R", "FK_LOWERARM_R", "FK_HAND_R", "CTRL_COLLAR_L", "CTRL_COLLAR_R"], 0.5))
add("fk legs (FK mode)", props={"PROPERTIES": {"L LEG IK/FK": 0.0, "R LEG IK/FK": 0.0}}, channels=only(["FK_HIP_L", "FK_KNEE_L", "FK_FOOT_L", "FK_TOE_L", "FK_HIP_R", "FK_KNEE_R", "FK_FOOT_R", "FK_TOE_R"], 0.5))
add("ik arms", channels={"IK_HAND_L": {"loc": [0, 6, 2]}, "IK_HAND_R": {"loc": [0, -5, 3], "rot": rand_rot(pose.bones["IK_HAND_R"].rotation_mode, 0.5)}})
add("ik legs", channels={"IK_FOOT_MASTER_L": {"loc": [0, 5, 3]}, "IK_FOOT_MASTER_R": {"loc": [2, -3, 4]}})
add("ik arms with poles", channels={"IK_HAND_L": {"loc": [4, 4, -3]}, "IK_ELBOW_L": {"loc": [3, 0, 4]}, "IK_HAND_R": {"loc": [-3, 5, 1]}, "IK_ELBOW_R": {"loc": [0, 5, -3]}})
add("fingers", channels=only([p.name for p in controls if p.name.startswith(("CTRL_INDEX", "CTRL_MIDDLE", "CTRL_THUMB", "CTRL_PINKY", "CTRL_RING"))], 0.5))
add("follow sliders", props={"PROPERTIES": {"L ARM FOLLOW COLLAR": 1.0, "R ARM FOLLOW BODY": 1.0, "NECK ROT FOLLOW": 1.0, "HEAD ROT FOLLOW": 1.0}},
    channels=only(["CTRL_SPINE", "CTRL_COLLAR_L", "CTRL_PELVIS"], 0.4))
add("ik parents", props={"PROPERTIES": {"L ARM IK PARENT": 1, "R ARM IK PARENT": 2}}, channels=only(["CTRL_SPINE", "CTRL_PELVIS"], 0.4))
add("half ik/fk", props={"PROPERTIES": {"L ARM IK/FK": 0.5, "R LEG IK/FK": 0.4}}, channels=only(["FK_UPPERARM_L", "FK_HIP_R"], 0.4))
for i in range(count):
    channels = {}
    for pb in controls:
        if rnd.random() < 0.5:
            channels[pb.name] = {"rot": rand_rot(pb.rotation_mode, 0.4)}
            if pb.name.startswith(("IK_HAND", "IK_FOOT_MASTER", "CTRL_PELVIS", "CTRL_SPINE")):
                channels[pb.name]["loc"] = [rnd.uniform(-3, 3) for _ in range(3)]
    add(f"random {i}", props={"PROPERTIES": {k: rnd.choice([0.0, 1.0]) for k in ("L ARM IK/FK", "R ARM IK/FK", "L LEG IK/FK", "R LEG IK/FK")}}, channels=channels)

fk_controls = [pb for pb in controls if pb.name.startswith(("FK_", "CTRL_COLLAR", "CTRL_NECK", "CTRL_HEAD", "CTRL_SPINE", "CTRL_HIPS", "CTRL_INDEX", "CTRL_MIDDLE", "CTRL_RING", "CTRL_PINKY", "CTRL_THUMB"))]
for i in range(4):
    channels = {pb.name: {"rot": rand_rot(pb.rotation_mode, 0.45, tuple(pb.lock_rotation))} for pb in fk_controls}
    add(f"fk all {i}", props={"PROPERTIES": {k: 0.0 for k in ("L ARM IK/FK", "R ARM IK/FK", "L LEG IK/FK", "R LEG IK/FK")}}, channels=channels)

with open(dest, "w") as fh:
    json.dump({"armature": name, "sliders": sliders, "cases": cases}, fh, separators=(",", ":"))
print("ORACLE", len(cases), "cases")
