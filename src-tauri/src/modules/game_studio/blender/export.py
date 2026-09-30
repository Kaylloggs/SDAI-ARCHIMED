# Game Studio (ARCHIMED) : exporte le fichier .blend ouvert pour le moteur du jeu.
# Lancé par : blender --background --factory-startup <fichier.blend> --python-exit-code 1
#             --python export.py -- <sortie> <glb|fbx>
import os
import sys

import bpy


def arguments():
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def main():
    out, fmt = arguments()[:2]
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    if fmt == "glb":
        # Godot lit le glTF binaire : axe Y en haut, modificateurs appliqués.
        bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True, export_yup=True)
    elif fmt == "fbx":
        # Unity et Unreal : échelle appliquée, sans os de fin, textures intégrées.
        bpy.ops.export_scene.fbx(
            filepath=out,
            apply_scale_options="FBX_SCALE_ALL",
            add_leaf_bones=False,
            path_mode="COPY",
            embed_textures=True,
            object_types={"EMPTY", "ARMATURE", "MESH", "OTHER"},
            bake_anim=True,
        )
    else:
        raise SystemExit(f"Format inconnu : {fmt}")
    if not os.path.isfile(out):
        raise SystemExit(f"Blender n'a rien écrit dans {out}")
    print("ARCHIMED_BLENDER_OK", out)


main()
