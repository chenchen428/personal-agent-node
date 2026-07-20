import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export function makeFurniture(item, materials, wallMaterial, baseElevation) {
  const material = clone(materials, item.material, '#294f45'); const group = new THREE.Group();
  const makers = { sofa, bed, chair, cabinet, bench, plant, vanity, toilet, shower, curtain, lamp };
  (makers[item.kind] || table)(group, item, material, wallMaterial, materials);
  addContactShadow(group, item.size[0], item.size[1]);
  group.position.set(item.position[0], baseElevation + 0.045, item.position[1]); group.rotation.y = item.rotation; return group;
}

function sofa(group, item, material) {
  const [w, d, h] = item.size; const count = Math.max(2, Math.round(w / .75));
  group.add(rounded(w, h * .28, d * .82, material, [0, h * .2, 0]));
  for (let i = 0; i < count; i += 1) {
    const x = -w / 2 + w / count * (i + .5); group.add(rounded(w / count * .92, h * .18, d * .68, material.clone(), [x, h * .42, -d * .02]));
    const back = rounded(w / count * .9, h * .48, d * .16, material.clone(), [x, h * .68, d * .34]); back.rotation.x = -.08; group.add(back);
  }
  group.add(rounded(.16, h * .58, d * .8, material.clone(), [-w / 2 + .08, h * .48, 0]), rounded(.16, h * .58, d * .8, material.clone(), [w / 2 - .08, h * .48, 0]));
  addLegs(group, w * .84, d * .64, h * .14, '#5b4b3f');
}
function bed(group, item, material, wallMaterial) {
  const [w, d, h] = item.size; const wood = new THREE.MeshStandardMaterial({ color: '#705947', roughness: .72 });
  group.add(rounded(w * 1.04, h * .2, d * 1.04, wood, [0, h * .12, 0]));
  group.add(rounded(w, h * .36, d, material, [0, h * .38, 0]));
  group.add(rounded(w * 1.08, h * .9, .16, wood.clone(), [0, h * .64, -d * .49]));
  const pillow = wallMaterial.clone(); pillow.color.set('#f0ebe2');
  group.add(rounded(w * .38, .13, d * .22, pillow, [-w * .22, h * .62, -d * .27]), rounded(w * .38, .13, d * .22, pillow.clone(), [w * .22, h * .62, -d * .27]));
  const throwMat = material.clone(); throwMat.color.offsetHSL(.02, -.08, -.08); group.add(rounded(w * .9, .05, d * .42, throwMat, [0, h * .6, d * .17]));
}
function table(group, item, material) {
  const [w, d, h] = item.size; const dining = /餐|dining/i.test(item.name); const topH = Math.min(.12, h * .18);
  if (dining) { const top = new THREE.Mesh(new THREE.CylinderGeometry(d / 2, d / 2, topH, 40), material); top.scale.x = w / d; top.position.y = h; group.add(top); }
  else group.add(rounded(w, topH, d, material, [0, h, 0]));
  addLegs(group, w * .7, d * .62, h - topH / 2, '#765a45');
  if (dining) for (const [x, z, rotation] of [[-w*.34,-d*.78,0],[w*.34,-d*.78,0],[-w*.34,d*.78,Math.PI],[w*.34,d*.78,Math.PI],[-w*.62,0,Math.PI/2],[w*.62,0,-Math.PI/2]]) {
    const chairGroup = new THREE.Group(); chair(chairGroup, { size: [.48,.5,.78] }, material.clone()); chairGroup.position.set(x,0,z); chairGroup.rotation.y = rotation; group.add(chairGroup);
  }
}
function chair(group, item, material) {
  const [w, d, h] = item.size; group.add(rounded(w, .13, d, material, [0, h * .46, 0]), rounded(w, h * .42, .12, material.clone(), [0, h * .7, d * .42])); addLegs(group, w * .72, d * .7, h * .44, '#5b4b3f');
}
function cabinet(group, item, material) {
  const [w, d, h] = item.size; group.add(rounded(w, h, d, material, [0, h / 2, 0], .035));
  const doors = Math.max(1, Math.round(w / .6)); const panel = material.clone(); panel.color.offsetHSL(0, -.04, .04);
  for (let index = 0; index < doors; index += 1) {
    const x = -w / 2 + w / doors * (index + .5); group.add(rounded(w / doors * .92, h * .88, .025, panel.clone(), [x, h * .51, d / 2 + .018], .015));
    const handle = new THREE.Mesh(new THREE.CapsuleGeometry(.015, Math.min(.22, h * .14), 4, 8), new THREE.MeshStandardMaterial({ color: '#9c7a45', roughness: .38, metalness: .72 })); handle.position.set(x + w / doors * .28, h * .52, d / 2 + .05); group.add(handle);
  }
  if (/厨房|餐边|家政|洗烘/.test(item.name)) group.add(rounded(w * 1.03, .055, d * 1.05, new THREE.MeshStandardMaterial({ color: '#b2aaa1', roughness: .52 }), [0, h + .025, 0], .015));
}
function bench(group, item, material) { const [w,d,h] = item.size; group.add(rounded(w,.18,d,material,[0,h,0])); addLegs(group,w*.78,d*.58,h-.08,'#5b4b3f'); }
function plant(group, item, material) { const [w,,h] = item.size; const pot = new THREE.Mesh(new THREE.CylinderGeometry(w*.24,w*.34,h*.3,20),new THREE.MeshStandardMaterial({color:'#8c6650',roughness:.9})); pot.position.y=h*.15; group.add(pot); for(let i=0;i<7;i+=1){const leaf=new THREE.Mesh(new THREE.SphereGeometry(w*.3,14,10),material.clone()); leaf.scale.set(.55,1.25,.28); leaf.position.set(Math.sin(i)*w*.22,h*(.48+i*.04),Math.cos(i)*w*.2); leaf.rotation.z=(i-3)*.18; group.add(leaf);} }
function vanity(group, item, material) { cabinet(group,item,material); const [w,,h]=item.size; const basin=new THREE.Mesh(new THREE.CylinderGeometry(w*.2,w*.24,.1,24),new THREE.MeshStandardMaterial({color:'#eeeae2',roughness:.25})); basin.scale.z=.7; basin.position.y=h+.1; group.add(basin); }
function toilet(group, item) { const [w,d,h]=item.size; const ceramic=new THREE.MeshStandardMaterial({color:'#f4f1ea',roughness:.24}); group.add(rounded(w*.72,h*.42,d*.68,ceramic,[0,h*.22,d*.06])); const bowl=new THREE.Mesh(new THREE.TorusGeometry(w*.27,.06,12,28),ceramic.clone()); bowl.rotation.x=Math.PI/2; bowl.position.set(0,h*.48,d*.02); group.add(bowl); group.add(rounded(w*.65,h*.68,d*.22,ceramic.clone(),[0,h*.4,-d*.36])); }
function shower(group, item) { const [w,d,h]=item.size; const glass=new THREE.MeshPhysicalMaterial({color:'#b8d5d3',roughness:.08,transparent:true,opacity:.28,transmission:.45}); const pane=new THREE.Mesh(new THREE.BoxGeometry(w,h,.025),glass); pane.position.set(0,h/2,d/2); group.add(pane); }
function curtain(group, item, material) { const [w,,h]=item.size; for(let i=0;i<10;i+=1){const fold=new THREE.Mesh(new THREE.CapsuleGeometry(.035,h*.82,4,8),material.clone()); fold.position.set(-w/2+w/10*(i+.5),h*.48,0); group.add(fold);} }
function lamp(group, item) { const [w,,h]=item.size; const metal=new THREE.MeshStandardMaterial({color:'#9c7a45',roughness:.36,metalness:.78}); const shade=new THREE.Mesh(new THREE.CylinderGeometry(w*.2,w*.5,h*.3,24,1,true),new THREE.MeshStandardMaterial({color:'#d6c4aa',roughness:.72,side:THREE.DoubleSide})); shade.position.y=h*.3; group.add(shade); const stem=new THREE.Mesh(new THREE.CylinderGeometry(.015,.015,h*.7,12),metal); stem.position.y=h*.75; group.add(stem); }
function rounded(w,h,d,material,position,radius=.08) { const mesh=new THREE.Mesh(new RoundedBoxGeometry(w,h,d,3,Math.min(radius,w*.2,h*.2,d*.2)),material); mesh.position.set(...position); mesh.castShadow=mesh.receiveShadow=true; return mesh; }
function addLegs(group,w,d,h,color) { const material=new THREE.MeshStandardMaterial({color,roughness:.52,metalness:.18}); for(const x of [-w/2,w/2]) for(const z of [-d/2,d/2]){const leg=new THREE.Mesh(new THREE.CylinderGeometry(.025,.03,h,10),material); leg.position.set(x,h/2,z); group.add(leg);} }
function addContactShadow(group,w,d) { const shadow=new THREE.Mesh(new THREE.PlaneGeometry(w*1.08,d*1.08),new THREE.MeshBasicMaterial({color:'#2c2b27',transparent:true,opacity:.09,depthWrite:false})); shadow.rotation.x=-Math.PI/2; shadow.position.y=.004; group.add(shadow); }
function clone(materials,id,fallback) { return materials.get(id)?.clone() || new THREE.MeshStandardMaterial({color:fallback,roughness:.78}); }
