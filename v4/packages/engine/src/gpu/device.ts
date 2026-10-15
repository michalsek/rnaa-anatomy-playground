// Adapted from BoneTideOSS (MIT, Konrad Reczko): device init with the Dawn feature.
import tgpu, { type TgpuRoot } from 'typegpu';

/**
 * Create the TypeGPU root. On react-native-webgpu (Dawn) a device is not thread-safe unless
 * 'implicit-device-synchronization' is enabled, so it is requested when the adapter has it.
 * Browsers don't list it; `optionalFeatures` skips features the adapter lacks.
 */
export function initGpu(): Promise<TgpuRoot> {
  return tgpu.init({
    device: {
      optionalFeatures: ['implicit-device-synchronization' as GPUFeatureName],
    },
  });
}
