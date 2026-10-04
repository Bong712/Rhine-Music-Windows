/** Vendor-neutral GPU capability probe. WebView2 and ordinary browsers use the
 * same WebGL 2 API. `powerPreference` is a selection hint, not a guarantee that
 * a runtime will choose a particular adapter; report the actual GL renderer. */
export interface GpuCapability {
  api: "WebGL 2" | "unavailable";
  renderer: string;
  mode: "hardware" | "software" | "unknown";
  maxTextureSize: number;
}

export function probeGpuCapability(): GpuCapability {
  const canvas = document.createElement("canvas");
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl2", { powerPreference: "high-performance", failIfMajorPerformanceCaveat: false });
    if (!gl) return { api: "unavailable", renderer: "", mode: "unknown", maxTextureSize: 0 };
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : "";
    const mode = /swiftshader|llvmpipe|softpipe|software|microsoft basic render|\bwarp\b/i.test(renderer)
      ? "software" : renderer ? "hardware" : "unknown";
    return { api: "WebGL 2", renderer, mode, maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) };
  } catch {
    return { api: "unavailable", renderer: "", mode: "unknown", maxTextureSize: 0 };
  } finally {
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
