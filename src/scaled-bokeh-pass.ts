import {
  LinearFilter,
  ShaderMaterial,
  UniformsUtils,
  WebGLRenderTarget,
  type WebGLRenderer,
} from "three";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { CopyShader } from "three/addons/shaders/CopyShader.js";
import { auxiliaryResolutionScale } from "./render-quality";

/** Runs both depth and bokeh shading at a bounded size, then restores the full
 * composer target with a single linear upscale. The final canvas stays native
 * resolution; only the intentionally blurred depth-of-field effect is scaled. */
export class ScaledBokehPass extends BokehPass {
  private readonly scaledTarget = new WebGLRenderTarget(1, 1, {
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
  private readonly copyMaterial = new ShaderMaterial({
    uniforms: UniformsUtils.clone(CopyShader.uniforms),
    vertexShader: CopyShader.vertexShader,
    fragmentShader: CopyShader.fragmentShader,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly copyQuad = new FullScreenQuad(this.copyMaterial);

  get bufferWidth() { return this.scaledTarget.width; }
  get bufferHeight() { return this.scaledTarget.height; }

  override setSize(width: number, height: number) {
    const scale = auxiliaryResolutionScale(1, width, height);
    const scaledWidth = Math.max(1, Math.floor(width * scale));
    const scaledHeight = Math.max(1, Math.floor(height * scale));
    super.setSize(scaledWidth, scaledHeight);
    this.scaledTarget.setSize(scaledWidth, scaledHeight);
  }

  override render(
    renderer: WebGLRenderer,
    writeBuffer: WebGLRenderTarget,
    readBuffer: WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ) {
    const renderToScreen = this.renderToScreen;
    this.renderToScreen = false;
    try {
      super.render(renderer, this.scaledTarget, readBuffer, deltaTime, maskActive);
    } finally {
      this.renderToScreen = renderToScreen;
    }

    this.copyMaterial.uniforms.tDiffuse.value = this.scaledTarget.texture;
    renderer.setRenderTarget(renderToScreen ? null : writeBuffer);
    this.copyQuad.render(renderer);
  }

  override dispose() {
    super.dispose();
    this.scaledTarget.dispose();
    this.copyMaterial.dispose();
    this.copyQuad.dispose();
  }
}
