# Game Studio (ARCHIMED) : lit le fichier .blend ouvert et écrit son résumé en JSON.
# Lancé par : blender --background --factory-startup <fichier.blend> --python-exit-code 1
#             --python inspect.py -- <sortie.json>
import json
import os
import sys

import bpy


def arguments():
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def rounded(values):
    return [round(float(v), 4) for v in values]


def main():
    out = arguments()[0]
    scene = bpy.context.scene
    depsgraph = bpy.context.evaluated_depsgraph_get()
    objects = []
    for obj in scene.objects:
        entry = {
            "name": obj.name,
            "type": obj.type,
            "parent": obj.parent.name if obj.parent else None,
            "dimensions": rounded(obj.dimensions),
            "scale": rounded(obj.scale),
            "materials": [s.material.name for s in obj.material_slots if s.material],
            "modifiers": [m.type for m in obj.modifiers],
            "vertices": 0,
            "triangles": 0,
        }
        if obj.type == "MESH":
            evaluated = obj.evaluated_get(depsgraph)
            mesh = evaluated.to_mesh()
            mesh.calc_loop_triangles()
            entry["vertices"] = len(mesh.vertices)
            entry["triangles"] = len(mesh.loop_triangles)
            evaluated.to_mesh_clear()
        objects.append(entry)

    images = []
    for image in bpy.data.images:
        if image.source not in {"FILE", "SEQUENCE", "TILED"}:
            continue
        path = bpy.path.abspath(image.filepath) if image.filepath else ""
        packed = image.packed_file is not None
        images.append(
            {
                "name": image.name,
                "path": image.filepath,
                "packed": packed,
                "found": packed or (bool(path) and os.path.exists(path)),
                "size": [int(v) for v in image.size],
            }
        )

    units = scene.unit_settings
    info = {
        "blender": bpy.app.version_string,
        "file": bpy.data.filepath,
        "unitSystem": units.system,
        "unitScale": round(float(units.scale_length), 6),
        "frameStart": scene.frame_start,
        "frameEnd": scene.frame_end,
        "fps": round(scene.render.fps / scene.render.fps_base, 3),
        "objects": objects,
        "materials": [m.name for m in bpy.data.materials if m.users > 0],
        "images": images,
        "actions": [
            {"name": a.name, "frames": rounded(a.frame_range)} for a in bpy.data.actions
        ],
    }
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(info, handle)
    print("ARCHIMED_BLENDER_OK")


main()
