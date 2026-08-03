import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Vector


def parse_args():
    values = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--scene", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args(values)


def hex_color(value):
    safe = value if isinstance(value, str) and len(value) == 7 and value.startswith("#") else "#9c7f62"
    rgb = tuple(int(safe[index:index + 2], 16) / 255 for index in (1, 3, 5))
    return tuple(pow(channel, 2.2) for channel in rgb) + (1.0,)


def material(name, color, kind):
    current = bpy.data.materials.get(name)
    if current:
        return current
    current = bpy.data.materials.new(name)
    current.diffuse_color = hex_color(color)
    current.use_nodes = True
    shader = current.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = hex_color(color)
    shader.inputs["Roughness"].default_value = 0.9 if kind == "wall" else 0.56
    if kind == "glass":
        shader.inputs["Transmission Weight"].default_value = 0.82
        shader.inputs["Roughness"].default_value = 0.08
        shader.inputs["Alpha"].default_value = 0.32
        current.diffuse_color = (*hex_color(color)[:3], 0.32)
        try:
            current.surface_render_method = "DITHERED"
        except Exception:
            pass
    if kind == "light":
        shader.inputs["Emission Color"].default_value = hex_color(color)
        shader.inputs["Emission Strength"].default_value = 3.0
    return current


def box(item):
    size = [max(1, float(value)) / 1000 for value in item["size"]]
    center = item["center"]
    bpy.ops.mesh.primitive_cube_add(
        location=(center[0] / 1000, -center[1] / 1000, (center[2] + item["size"][2] / 2) / 1000),
        rotation=(0, 0, -math.radians(float(item.get("rotationDeg", 0)))),
    )
    obj = bpy.context.object
    obj.name = item["id"]
    obj.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material(f"mat-{item['kind']}-{item.get('color')}", item.get("color"), item["kind"]))
    if item["kind"] not in {"wall", "glass", "window-frame", "door-frame", "floor"}:
        bevel = obj.modifiers.new("soft-edges", "BEVEL")
        bevel.width = min(0.025, min(size) * 0.08)
        bevel.segments = 2
    return obj


def polygon_surface(name, points, elevation, color, flip=False):
    vertices = [(point[0] / 1000, -point[1] / 1000, elevation / 1000) for point in points]
    mesh = bpy.data.meshes.new(f"{name}-mesh")
    mesh.from_pydata(vertices, [], [list(range(len(vertices)))])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    if flip:
        for polygon in mesh.polygons:
            polygon.flip()
    obj.data.materials.append(material(f"mat-{name}", color, "floor" if not flip else "ceiling"))
    return obj


def add_lights(scene):
    bpy.ops.object.light_add(type="SUN", location=(4, -6, 10))
    sun = bpy.context.object
    sun.name = "daylight"
    sun.data.energy = 2.1
    sun.rotation_euler = (math.radians(28), math.radians(-18), math.radians(135))
    for index, point in enumerate(scene.get("points", [])):
        if point.get("type") != "light":
            continue
        data = bpy.data.lights.new(f"light-{index}", type="AREA")
        data.energy = 300
        data.color = (1.0, 0.84, 0.67)
        data.shape = "DISK"
        data.size = 1.25
        obj = bpy.data.objects.new(f"light-{index}", data)
        obj.location = (point["position"][0] / 1000, -point["position"][1] / 1000, min(2.65, point.get("mountHeight", 2600) / 1000))
        bpy.context.collection.objects.link(obj)

    # The semantic model is a closed interior, so the world background cannot
    # provide usable fill light. Add a broad ceiling source per room to keep
    # walls, openings, and furniture legible as an image-generation control.
    for index, room in enumerate(scene.get("rooms", [])):
        points = room.get("polygon", [])
        if not points:
            continue
        center_x = sum(point[0] for point in points) / len(points)
        center_y = sum(point[1] for point in points) / len(points)
        xs = [point[0] for point in points]
        ys = [point[1] for point in points]
        span = max(max(xs) - min(xs), max(ys) - min(ys)) / 1000
        data = bpy.data.lights.new(f"room-fill-{index}", type="AREA")
        data.energy = max(160, min(450, span * 50))
        data.color = (1.0, 0.91, 0.79)
        data.shape = "DISK"
        data.size = max(1.2, min(3.0, span * 0.42))
        obj = bpy.data.objects.new(f"room-fill-{index}", data)
        obj.location = (center_x / 1000, -center_y / 1000, 2.52)
        bpy.context.collection.objects.link(obj)

    # A soft omni-directional fill at the panorama origin prevents the side of
    # an object facing away from ceiling fixtures from collapsing to black.
    node = scene.get("node", {})
    position = node.get("position", [0, 0, 1550])
    data = bpy.data.lights.new("camera-fill", type="POINT")
    data.energy = 12
    data.color = (1.0, 0.93, 0.84)
    data.shadow_soft_size = 1.5
    obj = bpy.data.objects.new("camera-fill", data)
    obj.location = (position[0] / 1000, -position[1] / 1000, position[2] / 1000)
    bpy.context.collection.objects.link(obj)


def add_camera(node):
    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.name = f"panorama-{node['id']}"
    position = Vector((node["position"][0] / 1000, -node["position"][1] / 1000, node["position"][2] / 1000))
    target = Vector((node["lookAt"][0] / 1000, -node["lookAt"][1] / 1000, node["lookAt"][2] / 1000))
    camera.location = position
    camera.rotation_euler = (target - position).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "PANO"
    camera.data.panorama_type = "EQUIRECTANGULAR"
    bpy.context.scene.camera = camera


def configure_render(output):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 4096
    scene.render.resolution_y = 2048
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.filepath = output
    scene.render.film_transparent = False
    scene.render.image_settings.color_depth = "8"
    scene.world.color = (0.06, 0.07, 0.08)
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.16, 0.19, 0.23, 1)
    background.inputs["Strength"].default_value = 0.42
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = 0.0


def main():
    args = parse_args()
    with open(args.scene, "r", encoding="utf-8") as handle:
        scene = json.load(handle)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for room in scene.get("rooms", []):
        polygon_surface(f"floor-{room['id']}", room["polygon"], 0, room.get("color", "#d7c7ae"))
    for zone in scene.get("ceilingZones", []):
        polygon_surface(f"ceiling-{zone['id']}", zone["polygon"], zone.get("elevation", 2700), "#f2f0e9", True)
    for item in scene.get("primitives", []):
        if item.get("kind") != "floor":
            box(item)
    add_lights(scene)
    add_camera(scene["node"])
    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    configure_render(args.output)
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
