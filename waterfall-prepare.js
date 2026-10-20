// Finish expensive first-use graphics work before takeoff, including textures
// used only in the later gorge. Keep native texture sizes and all scene detail.
export async function prepareWaterfallScene({renderer,scene,camera,target,ready,textures}) {
 await Promise.all(ready);
 for (const texture of new Set(textures())) renderer.initTexture(texture);
 const previous = renderer.getRenderTarget();
 let compiling;
 try {
  renderer.setRenderTarget(target);
  compiling = renderer.compileAsync(scene,camera);
 } finally {
  // compileAsync starts synchronously but resolves later. Do not leave the
  // start-screen frame loop pointing at the preparation render target.
  renderer.setRenderTarget(previous);
 }
 await compiling;
}
