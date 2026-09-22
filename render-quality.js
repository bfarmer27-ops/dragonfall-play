// Match the display's pixel density, up to a 4K-sized drawing buffer.
// This avoids upscaling a low-resolution canvas on high-density phones.
export function renderPixelRatio(width,height,dpr,maxTextureSize=8192){
 const w=Math.max(1,width),h=Math.max(1,height);
 return Math.min(Math.max(1,dpr||1),Math.sqrt(3840*2160/(w*h)),maxTextureSize/Math.max(w,h));
}
