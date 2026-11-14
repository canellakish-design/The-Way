// finish.mjs — after Blender's export (build.py): each material gets the transparency it needs (the exporter marks
// them all see-through, which hides the face behind the hair cards), the skin gets its tan, the glasses their black.
//   node finish.mjs raw.glb out.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(process.argv[2]);
const TAN = [0.76, 0.58, 0.44, 1];                 // "tanner" (Harry, 14 Nov 2026): a multiply over the skin texture
const RULES = [
  [/body/i,               m => m.setAlphaMode('OPAQUE').setBaseColorFactor(TAN).setRoughnessFactor(0.55)],
  [/suit|shoes/i,         m => m.setAlphaMode('OPAQUE')],
  [/teeth|tongue/i,       m => m.setAlphaMode('OPAQUE')],
  [/glasses/i,            m => m.setAlphaMode('OPAQUE').setBaseColorTexture(null).setBaseColorFactor([0.015, 0.015, 0.018, 1]).setRoughnessFactor(0.35)],   // thick black frames
  [/high-poly|low-poly/i, m => m.setAlphaMode('MASK').setAlphaCutoff(0.5)],                                                                              // the eyes
  [/eyebrow|eyelash/i,    m => m.setAlphaMode('MASK').setAlphaCutoff(0.25).setBaseColorFactor([0.12, 0.10, 0.09, 1])],
  [/beard|moustache/i,    m => m.setAlphaMode('MASK').setAlphaCutoff(0.3)],
  [/short0|hair|bob|afro|long0|ponytail|braid/i, m => m.setAlphaMode('MASK').setAlphaCutoff(0.3).setBaseColorFactor([0.42, 0.40, 0.40, 1])]
];
for (const m of doc.getRoot().listMaterials()) {
  const r = RULES.find(([re]) => re.test(m.getName()));
  if (r) r[1](m); else m.setAlphaMode('OPAQUE');
  console.log(m.getName().padEnd(44), m.getAlphaMode());
}
await io.write(process.argv[3], doc);
