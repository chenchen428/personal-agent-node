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
    parser.add_argument("--controls-dir")
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
    obj["semantic_kind"] = item.get("kind", "object")
    obj.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material(f"mat-{item['kind']}-{item.get('color')}", item.get("color"), item["kind"]))
    if item["kind"] not in {"wall", "glass", "window-frame", "door-frame", "floor"}:
        bevel = obj.modifiers.new("soft-edges", "BEVEL")
        bevel.width = min(0.025, min(size) * 0.08)
        bevel.segments = 2
    return obj


def portal_box(portal, camera_position):
    delta_x = camera_position[0] - portal["center"][0]
    delta_y = camera_position[1] - portal["center"][1]
    distance = max(1.0, math.hypot(delta_x, delta_y))
    mask_offset = 80.0
    item = {
        "id": f"portal-control-{portal['id']}",
        "kind": "portal",
        "color": "#ffffff",
        "center": [
            portal["center"][0] + delta_x / distance * mask_offset,
            portal["center"][1] + delta_y / distance * mask_offset,
            max(0, portal["center"][2] - portal["height"] / 2),
        ],
        "size": [portal["width"], 18, portal["height"]],
        "rotationDeg": portal["wallRotationDeg"],
    }
    obj = box(item)
    obj["portal_id"] = portal["id"]
    obj.hide_render = True
    return obj


def emission_material(name, color):
    current = bpy.data.materials.get(name)
    if current:
        return current
    current = bpy.data.materials.new(name)
    current.use_nodes = True
    nodes = current.node_tree.nodes
    links = current.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = hex_color(color)
    emission.inputs["Strength"].default_value = 1.0
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return current


def depth_material():
    current = bpy.data.materials.get("control-depth")
    if current:
        return current
    current = bpy.data.materials.new("control-depth")
    current.use_nodes = True
    nodes = current.node_tree.nodes
    links = current.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    camera = nodes.new("ShaderNodeCameraData")
    mapping = nodes.new("ShaderNodeMapRange")
    mapping.inputs["From Min"].default_value = 0.2
    mapping.inputs["From Max"].default_value = 15.0
    mapping.inputs["To Min"].default_value = 1.0
    mapping.inputs["To Max"].default_value = 0.0
    mapping.clamp = True
    links.new(camera.outputs["View Distance"], mapping.inputs["Value"])
    links.new(mapping.outputs["Result"], emission.inputs["Color"])
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return current


def normal_material():
    current = bpy.data.materials.get("control-normal")
    if current:
        return current
    current = bpy.data.materials.new("control-normal")
    current.use_nodes = True
    nodes = current.node_tree.nodes
    links = current.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    geometry = nodes.new("ShaderNodeNewGeometry")
    transform = nodes.new("ShaderNodeVectorMath")
    transform.operation = "MULTIPLY_ADD"
    transform.inputs[1].default_value = (0.5, 0.5, 0.5)
    transform.inputs[2].default_value = (0.5, 0.5, 0.5)
    links.new(geometry.outputs["Normal"], transform.inputs[0])
    links.new(transform.outputs["Vector"], emission.inputs["Color"])
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return current


def replace_material(obj, current):
    if obj.type != "MESH":
        return
    obj.data.materials.clear()
    obj.data.materials.append(current)


def semantic_color(kind):
    if kind in {"wall", "door-frame", "window-frame", "window-sill"}:
        return "#f1f1f1"
    if kind == "floor":
        return "#3f7f4f"
    if kind == "glass":
        return "#3c92b8"
    if kind in {"door", "door-handle"}:
        return "#d48632"
    if kind in {"cabinet", "cabinet-front", "cabinet-plinth"}:
        return "#6e4b9e"
    if kind in {"light"}:
        return "#f2d447"
    return "#8a8379"


def configure_control_render(output):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    scene.cycles.use_denoising = False
    scene.render.resolution_x = 2048
    scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.filepath = output
    scene.view_settings.look = "None"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.exposure = 0.0
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0, 0, 0, 1)
    background.inputs["Strength"].default_value = 0.0


def render_controls(directory, portal_objects):
    os.makedirs(directory, exist_ok=True)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    regular = [obj for obj in meshes if obj not in portal_objects]
    for obj in portal_objects:
        obj.hide_render = True
    for name, current in (("depth", depth_material()), ("normal", normal_material())):
        for obj in regular:
            obj.hide_render = False
            replace_material(obj, current)
        output = os.path.join(directory, f"{name}.png")
        configure_control_render(output)
        bpy.ops.render.render(write_still=True)
    for obj in regular:
        obj.hide_render = False
        replace_material(obj, emission_material(f"control-semantic-{obj.get('semantic_kind', 'object')}", semantic_color(obj.get("semantic_kind", "object"))))
    output = os.path.join(directory, "semantic.png")
    configure_control_render(output)
    bpy.ops.render.render(write_still=True)
    black = emission_material("control-mask-black", "#000000")
    for obj in regular:
        obj.hide_render = False
        replace_material(obj, black)
    for obj in portal_objects:
        obj.hide_render = False
        replace_material(obj, emission_material("control-portal-white", "#ffffff"))
    output = os.path.join(directory, "portal-mask-raw.png")
    configure_control_render(output)
    bpy.context.scene.render.film_transparent = True
    bpy.context.scene.render.image_settings.color_mode = "RGBA"
    bpy.ops.render.render(write_still=True)
    for active in portal_objects:
        for obj in portal_objects:
            obj.hide_render = obj != active
        output = os.path.join(directory, f"portal-mask-{active['portal_id']}-raw.png")
        configure_control_render(output)
        bpy.context.scene.render.film_transparent = True
        bpy.context.scene.render.image_settings.color_mode = "RGBA"
        bpy.ops.render.render(write_still=True)


def polygon_surface(name, points, elevation, color, flip=False):
    vertices = [(point[0] / 1000, -point[1] / 1000, elevation / 1000) for point in points]
    mesh = bpy.data.meshes.new(f"{name}-mesh")
    mesh.from_pydata(vertices, [], [list(range(len(vertices)))])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj["semantic_kind"] = "ceiling" if flip else "floor"
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
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 8
    scene.cycles.use_denoising = True
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
    if args.controls_dir:
        portals = [portal_box(portal, scene["node"]["position"]) for portal in scene.get("portals", []) if portal.get("valid") and portal.get("traversable")]
        render_controls(args.controls_dir, portals)


if __name__ == "__main__":
    main()
