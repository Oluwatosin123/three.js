/**
 * @author Emmett Lalish / elalish
 *
 * This class generates custom mipmaps for a roughness map by encoding the lost variation in the
 * normal map mip levels as increased roughness in the corresponding roughness mip levels. This
 * helps with rendering accuracy for MeshStandardMaterial, and also helps with anti-aliasing when
 * using PMREM. If the normal map is larger than the roughness map, the roughness map will be
 * enlarged to match the dimensions of the normal map.
 */

import {
	LinearMipMapLinearFilter,
	Math as _Math,
	Mesh,
	NoBlending,
	OrthographicCamera,
	PlaneBufferGeometry,
	RawShaderMaterial,
	Scene,
	Vector2,
	WebGLRenderTarget
} from "../../../build/three.module.js";

var RoughnessMipmapper = ( function () {

	var _mipmapMaterial = _getMipmapMaterial();
	var _scene = new Scene();
	_scene.add( new Mesh( new PlaneBufferGeometry( 2, 2 ), _mipmapMaterial ) );

	var _flatCamera = new OrthographicCamera( 0, 1, 0, 1, 0, 1 );
	var _tempTarget = null;
	var _renderer = null;

	// constructor
	var RoughnessMipmapper = function ( renderer ) {

		_renderer = renderer;
		_renderer.compile( _scene, _flatCamera );

	};

	RoughnessMipmapper.prototype = {

		constructor: RoughnessMipmapper,

		generateMipmaps: function ( material ) {

			var { roughnessMap, normalMap } = material;
			if ( roughnessMap == null || normalMap == null || ! roughnessMap.generateMipmaps ||
                material.userData.roughnessUpdated ) return;

			material.userData.roughnessUpdated = true;

			var width = Math.max( roughnessMap.image.width, normalMap.image.width );
			var height = Math.max( roughnessMap.image.height, normalMap.image.height );
			if ( ! _Math.isPowerOfTwo( width ) || ! _Math.isPowerOfTwo( height ) ) return;

			var autoClear = _renderer.autoClear;
			_renderer.autoClear = false;

			if ( _tempTarget == null || _tempTarget.width !== width || _tempTarget.height !== height ) {

				if ( _tempTarget != null ) _tempTarget.dispose();

				_tempTarget = new WebGLRenderTarget( width, height, { depthBuffer: false, stencilBuffer: false } );

			}

			if ( width !== roughnessMap.image.width || height !== roughnessMap.image.height ) {

				var newRoughnessTarget = new WebGLRenderTarget( width, height, {
					minFilter: LinearMipMapLinearFilter,
					depthBuffer: false,
					stencilBuffer: false
				} );
				newRoughnessTarget.texture.generateMipmaps = true;
				// Setting the render target causes the memory to be allocated.
				_renderer.setRenderTarget( newRoughnessTarget );
				material.roughnessMap = newRoughnessTarget.texture;
				if ( material.metalnessMap == roughnessMap ) material.metalnessMap = material.roughnessMap;
				if ( material.aoMap == roughnessMap ) material.aoMap = material.roughnessMap;

			}

			_renderer.setRenderTarget( _tempTarget );
			_mipmapMaterial.uniforms.roughnessMap.value = roughnessMap;
			_mipmapMaterial.uniforms.normalMap.value = normalMap;

			var dpr = _renderer.getPixelRatio();
			var position = new Vector2( 0, 0 );
			var texelSize = _mipmapMaterial.uniforms.texelSize.value;
			for ( var mip = 0; width >= 1 && height >= 1;
				++ mip, width /= 2, height /= 2 ) {

				// Rendering to a mip level is not allowed in webGL1. Instead we must set
				// up a secondary texture to write the result to, then copy it back to the
				// proper mipmap level.
				texelSize.set( 1.0 / width, 1.0 / height );
				if ( mip == 0 ) texelSize.set( 0.0, 0.0 );

				_renderer.setViewport( position.x, position.y, width / dpr, height / dpr );
				_renderer.render( _scene, _flatCamera );
				_renderer.copyFramebufferToTexture( position, material.roughnessMap, mip );
				_mipmapMaterial.uniforms.roughnessMap.value = material.roughnessMap;

			}

			if ( roughnessMap !== material.roughnessMap ) roughnessMap.dispose();

			_renderer.autoClear = autoClear;
			_renderer.setRenderTarget( null );
			var size = _renderer.getSize( new Vector2() );
			_renderer.setViewport( 0, 0, size.x, size.y );

		},

		dispose: function ( ) {

			_mipmapMaterial.dispose();
			_scene.children[ 0 ].geometry.dispose();
			if ( _tempTarget != null ) _tempTarget.dispose();

		}

	};

	function _getMipmapMaterial() {

		var shaderMaterial = new RawShaderMaterial( {

			uniforms: {
				roughnessMap: { value: null },
				normalMap: { value: null },
				texelSize: { value: new Vector2( 1, 1 ) }
			},

			vertexShader: `
precision mediump float;
precision mediump int;
attribute vec3 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4( position, 1.0 );
}
              `,

			fragmentShader: `
precision mediump float;
precision mediump int;
varying vec2 vUv;
uniform sampler2D roughnessMap;
uniform sampler2D normalMap;
uniform vec2 texelSize;

#define ENVMAP_TYPE_CUBE_UV
vec4 envMapTexelToLinear(vec4 a){return a;}
#include <cube_uv_reflection_fragment>

void main() {
    gl_FragColor = texture2D(roughnessMap, vUv, -1.0);
    if (texelSize.x == 0.0) return;
    float roughness = gl_FragColor.g;
    float variance = roughnessToVariance(roughness);
    vec3 avgNormal;
    for (float x = -1.0; x < 2.0; x += 2.0) {
    for (float y = -1.0; y < 2.0; y += 2.0) {
        vec2 uv = vUv + vec2(x, y) * 0.25 * texelSize;
        avgNormal += normalize(texture2D(normalMap, uv, -1.0).xyz - 0.5);
    }
    }
    variance += 1.0 - 0.25 * length(avgNormal);
    gl_FragColor.g = varianceToRoughness(variance);
}
              `,

			blending: NoBlending,
			depthTest: false,
			depthWrite: false

		} );

		shaderMaterial.type = 'RoughnessMipmapper';

		return shaderMaterial;

	}

	return RoughnessMipmapper;

} )();

export { RoughnessMipmapper };
